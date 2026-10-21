const { Pool } = require("pg");

const pool = new Pool({
  user: "postgres",
  host: "171.244.141.14",
  database: "Recloser app",
  password: "1122",
  port: 5432,
});

/**
 * Load toàn bộ device kiểu ethernet đang active
 * Có thể dùng cho scheduler/runtime sau này
 */
async function loadActiveEthernetDevices() {
  const { rows } = await pool.query(`
    SELECT
      d.device_id,
      d.name AS device_name,
      d.serial_number,
      d.model,
      d.ip_address,
      d.port,
      d.slave_id,
      d.connection_type,
      COALESCE(d.active, 1) AS active,
      d.device_type_id,
      d.product_line_id
    FROM devices d
    WHERE d.connection_type = 'ethernet'
      AND COALESCE(d.active, 1) = 1
    ORDER BY d.created_at DESC
  `);

  return rows.map((r) => ({
    device_id: r.device_id,
    device_name: r.device_name,
    serial_number: r.serial_number,
    model: r.model,
    ip_address: r.ip_address,
    port: r.port,
    slave_id: r.slave_id,
    connection_type: r.connection_type,
    active: r.active,
    device_type_id: r.device_type_id,
    product_line_id: r.product_line_id,
  }));
}

module.exports = {
  loadActiveEthernetDevices,
};