// backend/modbusReader/modbusReader.js
const { sendPush } = require("../backend/services/pushService");
const { getTokensByDevice,getAllTokens } = require("../backend/services/tokenService");
const ModbusRTU = require("modbus-serial");
const { Pool } = require("pg");
const modbusCache = require("./modbus/modbusCache");
const deviceClientFactory =
  require("./modbus/DeviceClientFactory");
const {normalizeDataType,
  decodeModbusValue,
  getRegisterCountByType,
} = require("./modbus/modbusDataDecoder");
const connectionManager =
  require("./modbus/ModbusConnectionManager");
  const processTOU =require("../backend/services/touService");
const PQueue = require("p-queue").default;
const pool = new Pool({
  user: "postgres",
  host: "171.244.141.14",
  database: "Recloser app",
 password: '1122',
  port: 5432,
});

// ===== TEST CONFIG =====

const gatewayClients = new Map();   // host -> client
const gatewayQueues = new Map();    // gatewayId -> queue

const SAVE_INTERVAL_MS = 15 * 60 * 1000;

const alarmStateMap = new Map();
const lastSavedAt = new Map();
const deviceStatusMap = new Map();
function setGatewayClient(gatewayId, client) {
  gatewayClientCache.set(gatewayId, client);
}

function getGatewayClient(gatewayId) {
  return gatewayClientCache.get(gatewayId);
}

function clearGatewayClient(gatewayId) {
  gatewayClientCache.delete(gatewayId);
}
// =================================================
// 🔐 DB advisory lock
// =================================================
const locks = new Set();

function acquireLock(deviceId) {
    if (locks.has(deviceId))
        return false;

    locks.add(deviceId);
    return true;
}

function releaseLock(deviceId) {
    locks.delete(deviceId);
}
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("TIMEOUT")), ms)
    ),
  ]);
}
function getQueue(gatewayId) {
  if (!gatewayQueues.has(gatewayId)) {
    gatewayQueues.set(
      gatewayId,
      new PQueue({ concurrency: 2 }) // chỉ 1 request / gateway
    );
  }
  return gatewayQueues.get(gatewayId);
}
async function updateGatewayStatusIfChanged(gatewayId, newStatus) {
  const result = await pool.query(
    `
    UPDATE gateways
    SET status = $1,
        updated_at = NOW()
    WHERE gateway_id = $2
      AND status IS DISTINCT FROM $1
    `,
    [newStatus, gatewayId]
  );

  if (result.rowCount > 0) {
    console.log("🔄 Gateway status changed →", newStatus);
  }
}
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function retry(fn, retries = 2) {
  let delay = 300;

  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries) throw err;
      await sleep(delay);
      delay *= 2;
    }
  }
}
async function getClient(conn) {
  let client = gatewayClients.get(conn.host);

  if (client && client.isOpen) {
    return client;
  }

  client = new ModbusRTU();

  await retry(() =>
    withTimeout(
      client.connectTCP(conn.host, { port: conn.port }),
      3000
    )
  );

  client.setTimeout(2000);

  gatewayClients.set(conn.host, client);

  console.log("✅ Connected gateway", conn.host);

  return client;
}
async function getDeviceConnection(deviceId) {
  const sql = `
    SELECT
      d.device_id,
      d.name,
      d.slave_id,
      d.connection_type,
      d.ip_address,
      d.port,
      d.gateway_id,

      g.name AS gateway_name,
      g.connection_config,
      g.protocol_code

    FROM devices d
    LEFT JOIN gateways g
      ON g.gateway_id = d.gateway_id
    WHERE d.device_id = $1
    LIMIT 1
  `;

  const { rows } = await pool.query(sql, [deviceId]);

  if (!rows.length) return null;

  const row = rows[0];

  // =====================================
  // 1) DEVICE QUA GATEWAY
  // =====================================
  if (row.connection_type === "gateway") {
    if (!row.gateway_id || !row.connection_config) {
      return null;
    }

    let config = row.connection_config;

    if (typeof config === "string") {
      config = JSON.parse(config);
    }

    // map protocol_code -> protocol
    let protocol = config.protocol;
    if (!protocol && row.protocol_code) {
      if (row.protocol_code === "MODBUS_TCP") {
        protocol = "modbus_tcp";
      } else if (row.protocol_code === "MODBUS_RTU") {
        protocol = "modbus_rtu";
      }
    }

    return {
      mode: "gateway",
      device_id: row.device_id,
      name: row.name,
      slave_id: row.slave_id,
      gateway_id: row.gateway_id,
      gateway_name: row.gateway_name,
      protocol,
      connection_config: {
        ...config,
        protocol,
      },
    };
  }

  // =====================================
  // 2) DEVICE ETHERNET TRỰC TIẾP
  // =====================================
  if (row.connection_type === "ethernet") {
    if (!row.ip_address) {
      return null;
    }

    return {
      mode: "ethernet",
      device_id: row.device_id,
      name: row.name,
      slave_id: row.slave_id || 1,
      protocol: "modbus_tcp",
      connection_config: {
        protocol: "modbus_tcp",
        ip: row.ip_address,
        port: row.port || 502,
      },
    };
  }

  // =====================================
  // 3) DEVICE NHÁP / NONE
  // =====================================
  return null;
}
module.exports = {
  getDeviceConnection,
};
const deviceStatusCache = new Map();
async function insertDeviceStatusIfChanged(deviceId,newStatus){

  const prevStatus =
    deviceStatusCache.get(deviceId);


  if(prevStatus === newStatus){
    return false;
  }


  deviceStatusCache.set(
    deviceId,
    newStatus
  );


  await pool.query(`
    INSERT INTO device_status
    (device_id,status,created_at)
    VALUES($1,$2,NOW())
  `,
  [
    deviceId,
    newStatus
  ]);

}
async function scanAlarmOnly(deviceId) {

  const conn = await getDeviceConnection(deviceId);
  if (!conn) return;

  const queue = getQueue(conn.gateway_id);

  return queue.add(async () => {

    try {

      const client = await getClient(conn);
      client.setID(conn.slave_id);

      // 🔥 chỉ lấy register có alarm
      const { rows: alarmRows } = await pool.query(`
        SELECT measurement_id, threshold_high, threshold_low, plm.modbus_address
        FROM alarms a
        JOIN devices d ON d.device_id = a.device_id
        JOIN product_lines_modbus plm 
          ON plm.device_type_measurement_id = a.measurement_id
          AND plm.product_line_id = d.product_line_id
        WHERE a.device_id = $1
      `, [deviceId]);

      if (!alarmRows.length) return;

      let failCount = 0;

      for (const alarm of alarmRows) {

        try {

          const res = await retry(() =>
            withTimeout(
              client.readHoldingRegisters(alarm.modbus_address, 1),
              1500
            )
          );

          const value = res.data[0];

          const key = `${deviceId}_${alarm.measurement_id}`;
          const prevState =
            alarmStateMap.get(key) || { inAlarm: false };

          const isHigh =
            alarm.threshold_high !== null &&
            value > alarm.threshold_high;

          const isLow =
            alarm.threshold_low !== null &&
            value < alarm.threshold_low;

          const inAlarm = isHigh || isLow;

          // 🚨 ENTER
          if (!prevState.inAlarm && inAlarm) {

            console.log(`🚨 FAST ENTER ${alarm.measurement_id}`);

            alarmStateMap.set(key, { inAlarm: true });

            const tokens = await getTokensByDevice(deviceId);

            sendPush(
              tokens,
              "🚨 Alarm",
              `Device ${deviceId} alarm triggered`
            );
          }

          // ✅ EXIT
          if (prevState.inAlarm && !inAlarm) {

            console.log(`✅ FAST EXIT ${alarm.measurement_id}`);

            alarmStateMap.set(key, { inAlarm: false });
          }

        } catch (err) {
          failCount++;
        }

      }

      // ❗ nếu lỗi nhiều → reset connection
      if (failCount > 2) {
        gatewayClients.delete(conn.host);
      }

    } catch (err) {
      console.log("❌ Alarm scan error:", err.message);
    }

  });

}
async function scanRegisters(deviceId) {
  const conn = await getDeviceConnection(deviceId);
  if (!conn) {
    return {
      success: false,
      reason: "NO_CONNECTION",
    };
  }

  const queueKey =
    conn.mode === "gateway"
      ? `gw_${conn.gateway_id}`
      : `eth_${deviceId}`;

  const queue = getQueue(queueKey);

  return queue.add(async () => {
    try {
      const { client, slaveId } =
        await deviceClientFactory.getDeviceClient(deviceId);

      client.setID(slaveId);

      const { rows: mappings } = await pool.query(
        `
        SELECT
          plm.modbus_address,
          plm.data_type,
          dtm.measurement_id,
          m.name AS measurement_name
        FROM devices d
        JOIN product_lines_modbus plm
          ON plm.product_line_id = d.product_line_id
        JOIN device_types_measurements dtm
          ON dtm.id = plm.device_type_measurement_id
        JOIN measurements m
          ON m.measurement_id = dtm.measurement_id
        WHERE d.device_id = $1
          AND plm.modbus_address IS NOT NULL
          AND plm.data_type IS NOT NULL
        ORDER BY plm.modbus_address
        `,
        [deviceId]
      );

      if (!mappings.length) {
        return {
          success: true,
          data: [],
        };
      }

      const deviceCache = {};
      const results = [];
      let failCount = 0;

      for (const map of mappings) {
        const address = Number(map.modbus_address);
        const dataType = normalizeDataType(map.data_type);

        if (!dataType) {
          console.log(
            `⏭️ Skip device=${deviceId} reg=${address} measurement=${map.measurement_name} because data_type invalid`
          );
          continue;
        }

        const registerCount = getRegisterCountByType(dataType);

        try {
          const res = await retry(() =>
            withTimeout(
              client.readHoldingRegisters(address, registerCount),
              2000
            )
          );

          const raw = res?.data || [];

          if (!raw.length) {
            throw new Error("NO_DATA");
          }

          const value = decodeModbusValue(raw, {
            dataType,
            registerCount,
            byteOrder: "BE",
            wordOrder: "BE",
          });

          deviceCache[map.measurement_id] = {
            value,
            timestamp: new Date(),
          };

          results.push({
            measurementId: map.measurement_id,
            value,
          });

          console.log(
            `📥 device=${deviceId} slave=${slaveId} reg=${address} type=${dataType} => ${value}`
          );
        } catch (err) {
          failCount++;

          console.warn(
            `⚠️ Read fail device=${deviceId} reg=${address} measurement=${map.measurement_name}: ${err.message}`
          );
        }
      }

      if (failCount > 2 && results.length === 0) {
        return {
          success: false,
          reason: "READ_FAIL",
        };
      }

      modbusCache.set(deviceId, deviceCache);

      return {
        success: true,
        data: results,
      };
    } catch (err) {
      console.log("❌ Connect fail:", err.message);

      try {
        await connectionManager.disconnect(conn.connection_config);
      } catch (e) {
        console.log("Disconnect error:", e.message);
      }

      return {
        success: false,
        reason:
          err.message === "TIMEOUT"
            ? "TIMEOUT"
            : "CONNECT_FAIL",
      };
    }
  });
}
async function processAndSave(deviceId, scanResults) {

    const { rows: historyRows } = await pool.query(`
        SELECT measurement_id
        FROM history_config
        WHERE device_id = $1
          AND enabled = true
    `, [deviceId]);

    const historySet =
        new Set(historyRows.map(r => r.measurement_id));

    const { rows: alarmRows } = await pool.query(`
        SELECT measurement_id, threshold_high, threshold_low
        FROM alarms
        WHERE device_id = $1
    `, [deviceId]);

    const alarmMap =
        new Map(
            alarmRows.map(a => [a.measurement_id, a])
        );

    const insertValues = [];

    const now = Date.now();

    for (const item of scanResults) {

        const measurementId = item.measurementId;
        const value = item.value;

        const key =
            `${deviceId}_${measurementId}`;

        let shouldSave = false;

        // ==========================================
        // HISTORY
        // ==========================================

        if (historySet.has(measurementId)) {

            const lastSaved =
                lastSavedAt.get(key) || 0;

            if (
                now - lastSaved >=
                SAVE_INTERVAL_MS
            ) {

                shouldSave = true;

                lastSavedAt.set(
                    key,
                    now
                );

            }

        }

        // ==========================================
        // ALARM
        // ==========================================

        const alarm =
            alarmMap.get(measurementId);

        if (alarm) {

            const isHigh =
                alarm.threshold_high !== null &&
                value > alarm.threshold_high;

            const isLow =
                alarm.threshold_low !== null &&
                value < alarm.threshold_low;

            const currentInAlarm =
                isHigh || isLow;

            const prevState =
                alarmStateMap.get(key) ||
                { inAlarm: false };

            if (
                !prevState.inAlarm &&
                currentInAlarm
            ) {

                console.log(
                    `🚨 ENTER alarm ${measurementId}`
                );

                shouldSave = true;

                alarmStateMap.set(
                    key,
                    { inAlarm: true }
                );

            }

            if (
                prevState.inAlarm &&
                !currentInAlarm
            ) {

                console.log(
                    `✅ EXIT alarm ${measurementId}`
                );

                shouldSave = true;

                alarmStateMap.set(
                    key,
                    { inAlarm: false }
                );

            }

        }

        // ==========================================
        // NORMAL MEASUREMENT LOG
        // ==========================================

        if (shouldSave) {

            insertValues.push([
                deviceId,
                measurementId,
                value
            ]);

        }

    }

    // ==========================================
    // TOU
    // ==========================================

    await processTOU(
        deviceId,
        scanResults,
        insertValues,
        new Date(now)
    );

    // ==========================================
    // SAVE
    // ==========================================

    if (insertValues.length) {

        const params =
            insertValues
                .map(
                    (_, i) =>
                        `($${i * 3 + 1},
                          $${i * 3 + 2},
                          $${i * 3 + 3},
                          NOW())`
                )
                .join(",");

        await pool.query(`
            INSERT INTO device_logs
            (
                device_id,
                measurement_id,
                value,
                timestamp_ms
            )
            VALUES ${params}
        `, insertValues.flat());

    }

}
async function connectGateway(connectionConfig) {
  const client = new ModbusRTU();

  const config =
    typeof connectionConfig === "string"
      ? JSON.parse(connectionConfig)
      : connectionConfig;

  if (!config || !config.protocol) {
    throw new Error("Gateway connection_config invalid");
  }

  if (config.protocol === "modbus_tcp") {

    await Promise.race([
      client.connectTCP(config.host, {
        port: config.port || 502,
      }),

      new Promise((_, reject) =>
        setTimeout(() => {
          reject(new Error("TCP_CONNECT_TIMEOUT"));
        }, 2000)
      )
    ]);

  } else if (config.protocol === "modbus_rtu") {

    await client.connectRTUBuffered(config.comPort, {
      baudRate: config.baudRate || 9600,
      parity: config.parity || "none",
      dataBits: config.dataBits || 8,
      stopBits: config.stopBits || 1,
    });

  } else {
    throw new Error(`Unsupported protocol: ${config.protocol}`);
  }


  client.setTimeout(2000);

  return client;
}
async function scanGatewayDevices(gatewayId, source = "cron") {
  let client;

  try {
    // 1) Lấy gateway + toàn bộ device thuộc gateway đó
    const { rows } = await pool.query(
      `
      SELECT
        g.gateway_id,
        g.name AS gateway_name,
        g.connection_config,
        g.protocol_code,
        d.device_id,
        d.name AS device_name,
        d.slave_id
      FROM gateways g
      JOIN devices d
        ON d.gateway_id = g.gateway_id
      WHERE g.gateway_id = $1
      ORDER BY d.device_id
      `,
      [gatewayId]
    );

    if (!rows.length) {
      console.log(`⚠️ Gateway ${gatewayId} has no devices`);
      await updateGatewayStatusIfChanged(gatewayId, 0);
      return;
    }

    const gateway = rows[0];
    const devices = rows.map((r) => ({
      device_id: r.device_id,
      device_name: r.device_name,
      slave_id: r.slave_id,
    }));

    console.log(`\n🌐 Gateway: ${gateway.gateway_name || gateway.gateway_id}`);

    // 2) Parse config
    let rawConfig = gateway.connection_config;

    if (typeof rawConfig === "string") {
      rawConfig = JSON.parse(rawConfig);
    }

    const protocolCode = gateway.protocol_code;

    let protocol;
    if (protocolCode === "MODBUS_TCP") {
      protocol = "modbus_tcp";
    } else if (protocolCode === "MODBUS_RTU") {
      protocol = "modbus_rtu";
    } else {
      throw new Error(`Unsupported protocol_code: ${protocolCode}`);
    }

    const gatewayConfig = {
      protocol,
      ...rawConfig,
    };

    // 3) Connect gateway
    client = await connectGateway(gatewayConfig);

    console.log("✅ Gateway connected");

    // 🔥 QUAN TRỌNG: connect được gateway => gateway ONLINE
    await updateGatewayStatusIfChanged(gatewayId, 1);

    // 4) Scan từng device
    for (const device of devices) {
      try {
        console.log(
          `📟 Scan device ${device.device_name} | slave_id=${device.slave_id}`
        );

        client.setID(device.slave_id);

        await scanRegistersAndSaveByClient(
          client,
          device.device_id,
          source
        );

      } catch (err) {
        console.error(
          `❌ Device scan error ${device.device_id}:`,
          err.message
        );
      }
    }

  } catch (err) {
    console.error(`❌ Gateway scan fail ${gatewayId}:`, err.message);

    // 🔥 QUAN TRỌNG: connect gateway fail => gateway OFFLINE
    try {
      await updateGatewayStatusIfChanged(gatewayId, 0);
    } catch (e) {
      console.error("❌ updateGatewayStatusIfChanged fail:", e.message);
    }

  } finally {
    if (client && client.isOpen) {
      try {
    await client.close();
} catch (e) {
    if (e.code !== "ECONNRESET") {
        throw e;
    }
}
    }
  }
}
// =================================================
// 🔥 CORE SCAN FUNCTION
// =================================================
async function scanRegistersAndSave(deviceId){

  const locked = acquireLock(deviceId);
  if (!locked) return;

  try {

    const res = await scanRegisters(deviceId);
    if (!res.success) {

      // ❌ tất cả case fail → disconnected
      await insertDeviceStatusIfChanged(deviceId, 0);

      if (res.reason === "NO_GATEWAY") {
        console.log(`⚠️ Device ${deviceId} has no gateway`);
      } else {
        console.log(`⚠️ Device ${deviceId} disconnected`);
      }

      return;
    }

    // ✅ connected
    // 🔥 FIX: không có data = coi như OFFLINE
if (!res.data || res.data.length === 0) {

  await insertDeviceStatusIfChanged(deviceId, 0);
  console.log(`⚠️ Device ${deviceId} no data`);

  return;
}

// ✅ connected (chỉ khi có data)
await insertDeviceStatusIfChanged(deviceId, 1);

await processAndSave(deviceId, res.data);

  } finally {

    await releaseLock(deviceId);

  }

}

async function scanRegistersAndSaveByClient(client, deviceId, source = "cron") {
  const { rows } = await pool.query(
    `
    SELECT
      plm.modbus_address,
      plm.data_type,
      dtm.measurement_id,
      m.name AS measurement_name
    FROM devices d
    JOIN product_lines_modbus plm
      ON plm.product_line_id = d.product_line_id
    JOIN device_types_measurements dtm
      ON dtm.id = plm.device_type_measurement_id
    JOIN measurements m
      ON m.measurement_id = dtm.measurement_id
    WHERE d.device_id = $1
      AND plm.modbus_address IS NOT NULL
      AND plm.data_type IS NOT NULL
    ORDER BY plm.modbus_address
    `,
    [deviceId]
  );
console.log
  console.log(`📌 Mapping count = ${rows.length}`);

  if (!rows.length) {
    console.log(`⚠️ No valid modbus mappings for device ${deviceId}`);
    return;
  }

  //--------------------------------------------------------
  // Chuẩn hóa mapping
  //--------------------------------------------------------

  const mappings = [];

  for (const row of rows) {
    const dataType = normalizeDataType(row.data_type);

    if (!dataType) continue;

    mappings.push({
      ...row,
      dataType,
      address: Number(row.modbus_address),
      registerCount: getRegisterCountByType(dataType)
    });
  }

  //--------------------------------------------------------
  // Gom block
  //--------------------------------------------------------

  const MAX_BLOCK_SIZE = 120;

  const blocks = [];

  let current = null;

  for (const map of mappings) {

    const start = map.address;
    const end = map.address + map.registerCount - 1;

    if (!current) {
      current = {
        start,
        end,
        maps: [map]
      };
      continue;
    }

    const newEnd = Math.max(current.end, end);

    if (
      start <= current.end + 1 &&
      (newEnd - current.start + 1) <= MAX_BLOCK_SIZE
    ) {
      current.end = newEnd;
      current.maps.push(map);
    } else {
      blocks.push(current);

      current = {
        start,
        end,
        maps: [map]
      };
    }
  }

  if (current) blocks.push(current);

  console.log(`📦 Block count = ${blocks.length}`);

  //--------------------------------------------------------
  // Read block
  //--------------------------------------------------------

  const deviceCache = {};
  const results = [];

  for (const block of blocks) {

    const count = block.end - block.start + 1;

    let raw;

    try {

      console.log(
        `📖 Read block ${block.start} -> ${block.end} (${count} regs)`
      );

      const res = await client.readHoldingRegisters(
        block.start,
        count
      );

      raw = res?.data;

      if (!raw || raw.length < count)
        throw new Error("NO_DATA");

    } catch (err) {

      const fatal =
        err.code === "ETIMEDOUT" ||
        err.code === "ECONNRESET" ||
        err.code === "EPIPE" ||
        err.code === "ECONNABORTED" ||
        err.message.includes("Timed out") ||
        err.message.includes("Port Not Open");

      if (fatal) {
        console.error(`❌ Block timeout ${block.start}`);
        throw err;
      }

      console.error(
        `❌ Read block fail ${block.start}-${block.end}:`,
        err.message
      );

      continue;
    }

    //------------------------------------------------------
    // Decode từng measurement trong block
    //------------------------------------------------------

    for (const map of block.maps) {

      try {

        const offset = map.address - block.start;

        const registers = raw.slice(
          offset,
          offset + map.registerCount
        );

        if (registers.length < map.registerCount)
          throw new Error("NOT_ENOUGH_REGISTERS");

        const value = decodeModbusValue(registers, {
          dataType: map.dataType,
          registerCount: map.registerCount,
          byteOrder: "BE",
          wordOrder: "BE"
        });

        deviceCache[map.measurement_id] = {
          value,
          timestamp: new Date()
        };

        results.push({
          measurementId: map.measurement_id,
          value
        });

      } catch (err) {

        console.error(
          `❌ Decode fail device=${deviceId} reg=${map.address} measurement=${map.measurement_name}: ${err.message}`
        );

      }

    }

  }

  modbusCache.set(deviceId, deviceCache);

  if (results.length) {

    await insertDeviceStatusIfChanged(deviceId, 1);

    await processAndSave(deviceId, results);

  } else {

    await insertDeviceStatusIfChanged(deviceId, 0);

  }

  console.log(
    `================ DEVICE SCAN END =================`
  );
}
// =================================================
// 🔎 RAW RANGE READ (NO DB SAVE)
// =================================================
async function readDeviceRawRange(deviceId, start, end) {
  if (start < 0 || end < start) {
    throw new Error("Invalid register range");
  }

  const {
    client,
    slaveId,
    connectionConfig,
  } = await deviceClientFactory.getDeviceClient(deviceId);

  try {
    client.setID(slaveId);

    const STEP = 50;

    const registers = [];
    const bits = [];

    for (let addr = start; addr <= end; addr += STEP) {
      const count = Math.min(STEP, end - addr + 1);

      console.log(`📡 Reading ${addr} -> ${addr + count - 1}`);

      try {
        const res = await retry(() =>
          withTimeout(
            client.readHoldingRegisters(addr, count),
            2000
          )
        );

        const raw = res?.data || [];

        for (let i = 0; i < raw.length; i++) {
          const register = addr + i;
          const value = raw[i];

          registers.push({
            register,
            value,
          });

          const bitList = [];

          for (let bit = 0; bit < 16; bit++) {
            const bitValue = (value >> bit) & 1;

            const obj = {
              register: `${register}.${bit}`,
              value: bitValue,
            };

            bitList.push(obj);
            bits.push(obj);
          }

          console.log(
            `Reg ${register} = ${value}`,
            bitList
          );
        }

      } catch (err) {
        console.error(
          `Read ${addr} fail:`,
          err.message
        );
      }
    }

    return {
      registers,
      bits,
    };

  } finally {
    try {
    } catch {}
  }
}

module.exports = {
  scanRegistersAndSave,
  readDeviceRawRange,
  scanRegisters,
  scanAlarmOnly,
   scanGatewayDevices,
};
