const { Pool } = require("pg");
const {
  connectGateway,
  scanRegistersAndSaveByClient,
  scanRegistersAndSave,
  updateGatewayStatusIfChanged
} = require("../modbusReader");
// sửa path nếu hàm này đang nằm file khác

const pool = new Pool({
  user: "postgres",
  host: "171.244.141.14",
  database: "Recloser app",
  password: "1122",
  port: 5432,
});

/* =========================================================
   GLOBAL RUNTIME
========================================================= */
/**
 * gatewayRuntime = {
 *   gateways: Map<
 *     gateway_id,
 *     {
 *       gateway_id,
 *       gateway_name,
 *       protocol_code,
 *       connection_config,
 *       client,
 *       devices: [{ device_id, device_name, slave_id }]
 *     }
 *   >,
 *   ethernetDevices: [
 *     { device_id, name, ip_address, port, slave_id }
 *   ],
 *   lastRefreshAt: Date | null
 * }
 */
const gatewayRuntime = {
  gateways: new Map(),
  ethernetDevices: [],
  lastRefreshAt: null,
};

/* =========================================================
   HELPERS
========================================================= */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeGatewayProtocol(protocolCode) {
  if (protocolCode === "MODBUS_TCP") return "modbus_tcp";
  if (protocolCode === "MODBUS_RTU") return "modbus_rtu";
  return null;
}

function parseConnectionConfig(rawConfig) {
  if (!rawConfig) return {};
  if (typeof rawConfig === "string") {
    try {
      return JSON.parse(rawConfig);
    } catch {
      return {};
    }
  }
  return rawConfig;
}

async function closeGatewayClientSafe(client, gatewayId) {
  if (!client) return;

  try {
    if (typeof client.close === "function") {
      await client.close();
    } else if (typeof client.destroy === "function") {
      await client.destroy();
    }
  } catch (err) {
    console.warn(
      `⚠️ Close gateway client fail ${gatewayId || ""}: ${err.message}`
    );
  }
}

async function refreshGatewayRuntime() {
  console.log("\n================ REFRESH GATEWAY RUNTIME ================");

  // giữ runtime cũ để close connection cũ sau khi build runtime mới
  const oldRuntime = gatewayRuntime.gateways;

  const newGatewayMap = new Map();
  const connectedGatewayIds = [];

  try {
    /* -----------------------------------------------------
       1) LOAD ALL ACTIVE GATEWAYS + DEVICES
    ----------------------------------------------------- */
    const { rows: gatewayRows } = await pool.query(`
      SELECT
        g.gateway_id,
        g.name AS gateway_name,
        g.protocol_code,
        g.connection_config,
        d.device_id,
        d.name AS device_name,
        d.slave_id
      FROM gateways g
      LEFT JOIN devices d
        ON d.gateway_id = g.gateway_id
       AND COALESCE(d.active, 1) = 1
      WHERE COALESCE(g.active, 1) = 1
      ORDER BY g.gateway_id, d.device_id
    `);

    if (!gatewayRows.length) {
      console.log("⚠️ No active gateways found");
    }

    // group rows theo gateway
    const gatewayMapRaw = new Map();

    for (const row of gatewayRows) {
      if (!gatewayMapRaw.has(row.gateway_id)) {
        gatewayMapRaw.set(row.gateway_id, {
          gateway_id: row.gateway_id,
          gateway_name: row.gateway_name,
          protocol_code: row.protocol_code,
          connection_config: row.connection_config,
          devices: [],
        });
      }

      if (row.device_id) {
        gatewayMapRaw.get(row.gateway_id).devices.push({
          device_id: row.device_id,
          device_name: row.device_name,
          slave_id: row.slave_id,
        });
      }
    }

    /* -----------------------------------------------------
       2) TRY CONNECT ALL GATEWAYS
    ----------------------------------------------------- */
    for (const gateway of gatewayMapRaw.values()) {
      const gatewayId = gateway.gateway_id;

      try {
        const rawConfig = parseConnectionConfig(gateway.connection_config);
        const protocol = normalizeGatewayProtocol(gateway.protocol_code);

        if (!protocol) {
          console.warn(
            `⚠️ Gateway ${gateway.gateway_name || gatewayId} unsupported protocol: ${gateway.protocol_code}`
          );
          await updateGatewayStatusIfChanged(gatewayId, 0);
          continue;
        }

        const gatewayConfig = {
          protocol,
          ...rawConfig,
        };

        const client = await connectGateway(gatewayConfig);

        newGatewayMap.set(gatewayId, {
          gateway_id: gateway.gateway_id,
          gateway_name: gateway.gateway_name,
          protocol_code: gateway.protocol_code,
          connection_config: gateway.connection_config,
          client,
          devices: gateway.devices || [],
        });

        connectedGatewayIds.push(gatewayId);

        await updateGatewayStatusIfChanged(gatewayId, 1);

        console.log(
          `✅ Gateway connected: ${gateway.gateway_name || gatewayId} | devices=${gateway.devices.length}`
        );
      } catch (err) {
        console.error(
          `❌ Gateway connect fail ${gateway.gateway_name || gatewayId}: ${err.message}`
        );

        await updateGatewayStatusIfChanged(gatewayId, 0);
      }
    }

    /* -----------------------------------------------------
       3) LOAD ALL ACTIVE ETHERNET DEVICES
    ----------------------------------------------------- */
    const { rows: ethernetRows } = await pool.query(`
      SELECT
        d.device_id,
        d.name,
        d.ip_address,
        d.port,
        d.slave_id,
        d.connection_type,
        d.active
      FROM devices d
      WHERE d.connection_type = 'ethernet'
        AND COALESCE(d.active, 1) = 1
      ORDER BY d.created_at DESC
    `);

    gatewayRuntime.ethernetDevices = ethernetRows.map((r) => ({
      device_id: r.device_id,
      name: r.name,
      ip_address: r.ip_address,
      port: r.port,
      slave_id: r.slave_id,
      connection_type: r.connection_type,
      active: r.active,
    }));

    /* -----------------------------------------------------
       4) REPLACE GLOBAL RUNTIME
    ----------------------------------------------------- */
    gatewayRuntime.gateways = newGatewayMap;
    gatewayRuntime.lastRefreshAt = new Date();

    console.log(
      `🌐 Connected gateways: ${connectedGatewayIds.length}`
    );
    console.log(
      `🖧 Active ethernet devices: ${gatewayRuntime.ethernetDevices.length}`
    );

  } catch (err) {
    console.error("❌ refreshGatewayRuntime fail:", err.message);
  } finally {
    /* -----------------------------------------------------
       5) CLOSE OLD CLIENTS NOT USED ANYMORE
    ----------------------------------------------------- */
    for (const [oldGatewayId, oldGateway] of oldRuntime.entries()) {
      const stillExists = gatewayRuntime.gateways.has(oldGatewayId);

      if (!stillExists) {
        await closeGatewayClientSafe(oldGateway.client, oldGatewayId);
      } else {
        // nếu gateway vẫn còn nhưng client object đã bị thay mới
        const newGateway = gatewayRuntime.gateways.get(oldGatewayId);
        if (newGateway.client !== oldGateway.client) {
          await closeGatewayClientSafe(oldGateway.client, oldGatewayId);
        }
      }
    }
  }

  console.log("========================================================\n");
}

/* =========================================================
   STEP 2A:
   SCAN ALL DEVICES OF CONNECTED GATEWAYS
========================================================= */
/**
 * Scan tất cả device thuộc gateway đang online trong gatewayRuntime
 * Không connect lại gateway ở đây, chỉ dùng client đang giữ trong runtime
 */
async function scanConnectedGatewayDevices(source = "cron") {
  console.log("\n================ SCAN CONNECTED GATEWAY DEVICES ================");

  const gateways = Array.from(gatewayRuntime.gateways.values());

  if (!gateways.length) {
    console.log("⚠️ No connected gateways in runtime");
    return;
  }

  for (const gateway of gateways) {
    const gatewayId = gateway.gateway_id;
    const client = gateway.client;
    const devices = gateway.devices || [];

    if (!client) {
      console.warn(`⚠️ Gateway ${gatewayId} has no client`);
      continue;
    }

    if (!devices.length) {
      console.log(
        `⚠️ Gateway ${gateway.gateway_name || gatewayId} has no active devices`
      );
      continue;
    }

    console.log(
      `\n🌐 Scan gateway ${gateway.gateway_name || gatewayId} | devices=${devices.length}`
    );

    let gatewayHasSuccess = false;

    for (const device of devices) {
      try {
        console.log(
          `📟 Scan device ${device.device_name || device.device_id} | slave_id=${device.slave_id}`
        );

        if (device.slave_id !== null && device.slave_id !== undefined) {
          client.setID(device.slave_id);
        }

        await scanRegistersAndSaveByClient(
          client,
          device.device_id,
          source
        );

        gatewayHasSuccess = true;
      } catch (err) {
        console.error(
          `❌ Gateway device scan fail | gateway=${gatewayId} device=${device.device_id}: ${err.message}`
        );
      }

      // nghỉ nhẹ giữa các device cùng gateway
      await sleep(50);
    }

    // nếu scan qua hết device mà không device nào thành công thì đánh gateway offline
    if (!gatewayHasSuccess) {
      await updateGatewayStatusIfChanged(gatewayId, 0);
      console.warn(`⚠️ Gateway ${gatewayId} no successful device scan`);
    } else {
      await updateGatewayStatusIfChanged(gatewayId, 1);
    }
  }

  console.log("================================================================\n");
}

/* =========================================================
   STEP 2B:
   SCAN ALL ACTIVE ETHERNET DEVICES
========================================================= */
/**
 * Scan device kiểu ethernet:
 * - mỗi device tự connect riêng qua scanRegistersAndSave(deviceId)
 * - scanRegistersAndSave phải tự đọc connection_type/ip/port/slave_id từ DB
 */
async function scanEthernetDevices(source = "cron") {
  console.log("\n================ SCAN ETHERNET DEVICES ================");

  const devices = gatewayRuntime.ethernetDevices || [];

  if (!devices.length) {
    console.log("⚠️ No ethernet devices in runtime");
    return;
  }

  for (const device of devices) {
    try {
      console.log(
        `🖧 Scan ethernet device ${device.name || device.device_id} | ip=${device.ip_address || "-"} port=${device.port || "-"}`
      );

      // hàm này là luồng scan độc lập cho ethernet
      await scanRegistersAndSave(device.device_id, source);
    } catch (err) {
      console.error(
        `❌ Ethernet device scan fail ${device.device_id}: ${err.message}`
      );
    }

    // nghỉ nhẹ tránh dồn connect TCP
    await sleep(50);
  }

  console.log("=======================================================\n");
}

/* =========================================================
   OPTIONAL HELPERS
========================================================= */
function getGatewayRuntimeSnapshot() {
  return {
    connectedGateways: Array.from(gatewayRuntime.gateways.values()).map((g) => ({
      gateway_id: g.gateway_id,
      gateway_name: g.gateway_name,
      protocol_code: g.protocol_code,
      device_count: g.devices?.length || 0,
    })),
    ethernetDevices: gatewayRuntime.ethernetDevices,
    lastRefreshAt: gatewayRuntime.lastRefreshAt,
  };
}

async function closeAllGatewayRuntimeClients() {
  for (const [gatewayId, gateway] of gatewayRuntime.gateways.entries()) {
    await closeGatewayClientSafe(gateway.client, gatewayId);
  }

  gatewayRuntime.gateways = new Map();
}

/* =========================================================
   EXPORTS
========================================================= */
module.exports = {
  gatewayRuntime,
  refreshGatewayRuntime,
  scanConnectedGatewayDevices,
  scanEthernetDevices,
  getGatewayRuntimeSnapshot,
  closeAllGatewayRuntimeClients,
};