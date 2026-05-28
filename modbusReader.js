// backend/modbusReader/modbusReader.js
const { sendPush } = require("../backend/services/pushService");
const { getTokensByDevice,getAllTokens } = require("../backend/services/tokenService");
const ModbusRTU = require("modbus-serial");
const { Pool } = require("pg");
const modbusCache = require("./modbus/modbusCache");
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

// =================================================
// 🔐 DB advisory lock
// =================================================
async function acquireLock(deviceId) {
  const { rows } = await pool.query(
    "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
    [`modbus_scan_${deviceId}`]
  );
  return rows[0].locked;
}

async function releaseLock(deviceId) {
  await pool.query(
    "SELECT pg_advisory_unlock(hashtext($1))",
    [`modbus_scan_${deviceId}`]
  );
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
  const { rows } = await pool.query(`
  SELECT 
    d.slave_id,
    g.host,
    g.port,
    g.gateway_id
  FROM devices d
  JOIN gateways g
    ON d.gateway_id = g.gateway_id
  WHERE d.device_id = $1
`, [deviceId]);

  if (!rows.length) {
  return null;
}

  return rows[0];
}
async function insertDeviceStatusIfChanged(deviceId, newStatus) {

  // 🔍 lấy trạng thái gần nhất
  const res = await pool.query(`
    SELECT status
    FROM device_status
    WHERE device_id = $1
    ORDER BY created_at DESC
    LIMIT 1
  `, [deviceId]);

  const prevStatus = res.rows[0]?.status;

  // ❌ không đổi → stop
  if (prevStatus === newStatus) return false;

  // ✅ insert vào device_status
  await pool.query(`
    INSERT INTO device_status (device_id, status, created_at)
    VALUES ($1, $2, NOW())
  `, [deviceId, newStatus]);

  const eventType = newStatus === 1
    ? "CONNECTED"
    : "DISCONNECTED";
// 🔥 LẤY DEVICE NAME
  const deviceRes = await pool.query(`
    SELECT name
    FROM devices
    WHERE device_id = $1
    LIMIT 1
  `, [deviceId]);

  const deviceName = deviceRes.rows[0]?.name || deviceId;

  // ✅ insert event log (luôn RESOLVED)
  await pool.query(`
    INSERT INTO alarm_logs (
      device_id,
      event_type,
      status,
      category,
      triggered_at,
      resolved_at
    )
 VALUES ($1, $2, 'RESOLVED', 2, NOW(), NOW())
  `, [
    deviceId,
    eventType
  ]);

  console.log("📌 Event:", eventType);
const tokens = await getTokensByDevice(deviceId);

sendPush(
  tokens,
  "📡 Event",
  `${eventType} - Device ${deviceName}`
);
  return true;
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

  // ❌ Không có gateway
  if (!conn) {
    return {
      success: false,
      reason: "NO_GATEWAY"
    };
  }

  const queue = getQueue(conn.gateway_id);

  return queue.add(async () => {

    try {

      // 🔥 dùng connection pool (KHÔNG new mỗi lần)
      const client = await getClient(conn);

      await updateGatewayStatusIfChanged(conn.gateway_id, 1);

      client.setID(conn.slave_id);

      const { rows: mappings } = await pool.query(`
        SELECT
          plm.modbus_address,
          dtm.measurement_id
        FROM devices d
        JOIN product_lines_modbus plm
          ON plm.product_line_id = d.product_line_id
        JOIN device_types_measurements dtm
          ON dtm.id = plm.device_type_measurement_id
        WHERE d.device_id = $1
          AND plm.modbus_address IS NOT NULL
      `,[deviceId]);

      // ⚠️ Không có mapping → vẫn coi là connected
      if (!mappings.length) {
        return {
          success: true,
          data: []
        };
      }

      const regMap = new Map();
      mappings.forEach(r => regMap.set(r.modbus_address, r.measurement_id));

      const registers = [...regMap.keys()].sort((a,b)=>a-b);
      const MAX_BLOCK = 50;

      const deviceCache = {};
      const results = [];

      let failCount = 0; // 🔥 đếm block fail

      for (let i = 0; i < registers.length;) {

        const start = registers[i];
        let count = 1;

        while (
          i + count < registers.length &&
          registers[i + count] === start + count &&
          count < MAX_BLOCK
        ) {
          count++;
        }

        try {

          // 🔥 retry + timeout cho read
          const res = await retry(() =>
            withTimeout(
              client.readHoldingRegisters(start, count),
              2000
            )
          );

          for (let offset = 0; offset < count; offset++) {

            const reg = start + offset;
            if (!regMap.has(reg)) continue;

            const measurementId = regMap.get(reg);
            const value = res.data[offset];

            deviceCache[measurementId] = {
              value,
              timestamp: new Date()
            };

            results.push({
              measurementId,
              value
            });

          }

        } catch (err) {

          failCount++;
          console.warn(`⚠️ Read block fail ${start}`, err.message);

        }

        i += count;

      }

      // 🔥 nếu fail quá nhiều → coi là mất kết nối
      if (failCount > 2) {
        return {
          success: false,
          reason: "READ_FAIL"
        };
      }

      modbusCache.set(deviceId, deviceCache);

      return {
        success: true,
        data: results
      };

    } catch (err) {

      console.log("❌ Connect fail:", err.message);

      await updateGatewayStatusIfChanged(conn.gateway_id, 0);

      // 🔥 nếu lỗi TCP → reset connection
      if (err.message.includes("ECONN")) {
        gatewayClients.delete(conn.host);
      }

      return {
        success: false,
        reason: err.message === "TIMEOUT"
          ? "TIMEOUT"
          : "CONNECT_FAIL"
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
  `,[deviceId]);

  const historySet = new Set(historyRows.map(r=>r.measurement_id));

  const { rows: alarmRows } = await pool.query(`
    SELECT measurement_id, threshold_high, threshold_low
    FROM alarms
    WHERE device_id = $1
  `,[deviceId]);

  const alarmMap = new Map(
    alarmRows.map(a => [a.measurement_id,a])
  );

  const insertValues=[];
  const now = Date.now();

  for(const item of scanResults){

    const measurementId = item.measurementId;
    const value = item.value;

    const key = `${deviceId}_${measurementId}`;
    let shouldSave=false;

    if(historySet.has(measurementId)){

      const lastSaved = lastSavedAt.get(key) || 0;

      if(now - lastSaved >= SAVE_INTERVAL_MS){

        shouldSave=true;
        lastSavedAt.set(key,now);

      }

    }

    const alarm = alarmMap.get(measurementId);

    if(alarm){

      const isHigh =
        alarm.threshold_high !== null &&
        value > alarm.threshold_high;

      const isLow =
        alarm.threshold_low !== null &&
        value < alarm.threshold_low;

      const currentInAlarm = isHigh || isLow;

      const prevState =
        alarmStateMap.get(key) || { inAlarm:false };

      if(!prevState.inAlarm && currentInAlarm){

        console.log(`🚨 ENTER alarm ${measurementId}`);
        shouldSave=true;
        alarmStateMap.set(key,{inAlarm:true});

      }

      if(prevState.inAlarm && !currentInAlarm){

        console.log(`✅ EXIT alarm ${measurementId}`);
        shouldSave=true;
        alarmStateMap.set(key,{inAlarm:false});

      }

    }

    if(shouldSave){

      insertValues.push([
        deviceId,
        measurementId,
        value
      ]);

    }

  }

  if(insertValues.length){

    const params = insertValues
      .map((_,i)=>`($${i*3+1},$${i*3+2},$${i*3+3},NOW())`)
      .join(",");

    await pool.query(`
      INSERT INTO device_logs
      (device_id,measurement_id,value,timestamp_ms)
      VALUES ${params}
    `,insertValues.flat());

  }

}

// =================================================
// 🔥 CORE SCAN FUNCTION
// =================================================
async function scanRegistersAndSave(deviceId){

  const locked = await acquireLock(deviceId);
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

// =================================================
// 🔎 RAW RANGE READ (NO DB SAVE)
// =================================================
async function readDeviceRawRange(deviceId, start, end) {
  if (start < 0 || end < start) {
    throw new Error("Invalid register range");
  }

  const client = new ModbusRTU();

  try {
    const conn = await getDeviceConnection(deviceId);

    if (!conn) {
      throw new Error("NO_GATEWAY");
    }

    console.log("🔌 Connecting:", conn.host, "port:", conn.port);

    await withTimeout(
      client.connectTCP(conn.host, { port: conn.port }),
      3000
    );

    client.setID(conn.slave_id);
    console.log("🆔 Slave ID:", conn.slave_id);

    const STEP = 50;

    // 👉 OUTPUT CHUẨN
    const registers = []; // giá trị gốc
    const bits = [];      // danh sách bit

    for (let addr = start; addr <= end; addr += STEP) {
      const count = Math.min(STEP, end - addr + 1);

      console.log(`📡 Reading: ${addr} → ${addr + count - 1}`);

      try {
        const res = await client.readHoldingRegisters(addr, count);

        if (!res || !res.data) {
          console.log("❌ NO DATA:", addr);
          continue;
        }

        console.log("📦 RAW:", res.data);

        for (let i = 0; i < res.data.length; i++) {
          const raw = res.data[i];
          const register = addr + i;

          // ===== 1. LOG REGISTER =====
          console.log(`➡️ Register ${register} = ${raw}`);

          registers.push({
            register,
            value: raw
          });

          // ===== 2. LOG BITS =====
          const bitList = [];

          for (let bit = 0; bit < 16; bit++) {
            const bitVal = (raw >> bit) & 1;

            const bitObj = {
              register: `${register}.${bit}`,
              value: bitVal
            };

            bitList.push(bitObj);
            bits.push(bitObj);
          }

          console.log(`   ↳ Bits ${register}:`, bitList);
        }

      } catch (err) {
        console.error("❌ READ ERROR:", err.message);
      }
    }

    // ===== FINAL LOG =====
    console.log("✅ REGISTERS:", registers);
    console.log("✅ BITS:", bits);

    return {
      registers, // giá trị gốc
      bits       // tất cả bit 0/1
    };

  } catch (err) {
    console.error("❌ ERROR:", err.message);
    throw err;

  } finally {
    if (client.isOpen) {
      console.log("🔌 Closing");
      client.close();
    }
  }
}

module.exports = {
  scanRegistersAndSave,
  readDeviceRawRange,
  scanRegisters,
  scanAlarmOnly,
};
