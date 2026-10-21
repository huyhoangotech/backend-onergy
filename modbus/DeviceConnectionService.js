// backend/modbus/DeviceConnectionService.js

const { Pool } = require("pg");

const pool = new Pool({
  user: "postgres",
  host: "171.244.141.14",
  database: "Recloser app",
  password: "1122",
  port: 5432,
});

async function getDeviceConnection(deviceId) {
  const { rows } = await pool.query(
    `
    SELECT
      d.device_id,
      d.slave_id,
      d.gateway_id,
      d.connection_type,
      d.ip_address,
      d.port,
      g.connection_config
    FROM devices d
    LEFT JOIN gateways g
      ON g.gateway_id = d.gateway_id
    WHERE d.device_id = $1
    LIMIT 1
    `,
    [deviceId]
  );

  if (!rows.length) {
    return null;
  }

  const device = rows[0];

  // ===========================
  // Ethernet trực tiếp
  // ===========================
  if (device.connection_type === "ethernet") {
    return {
      device_id: device.device_id,
      slave_id: device.slave_id,
      gateway_id: null,
      mode: "ethernet",
      connection_config: {
        protocol: "modbus_tcp",
        host: device.ip_address,
        port: device.port || 502,
        timeout: 2000,
      },
    };
  }

  // ===========================
  // Gateway
  // ===========================
  return {
    device_id: device.device_id,
    slave_id: device.slave_id,
    gateway_id: device.gateway_id,
    mode: "gateway",
    connection_config:
      typeof device.connection_config === "string"
        ? JSON.parse(device.connection_config)
        : device.connection_config,
  };
}

module.exports = {
  getDeviceConnection,
};