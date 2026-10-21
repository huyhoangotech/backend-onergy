const ModbusRTU = require("modbus-serial");
const { Pool } = require("pg");
const dns = require("dns/promises");

const pool = new Pool({
  user: "postgres",
   host: "171.244.141.14",
  database: "Recloser app",
  password: "1122",
  port: 5432,
});

async function checkDevice(device) {
  const client = new ModbusRTU();
  const { device_id, ip_address, slave_id } = device;
  let status = 0;

  try {
    if (!ip_address) {
      await updateStatus(device_id, 0);
      return;
    }

    try {
      await client.connectTCP(ip_address, { port: 502, timeout: 3000 });
      client.setID(slave_id || 1);

      await client.readHoldingRegisters(0, 1);

      status = 1;
      console.log(`✅ Device ${device_id} connected`);
    } catch (err) {
      status = 0;
  
      try { client.close(); } catch {}
    }
  } catch (err) {
    console.log(`⚠️ Device ${device_id} unexpected error:`, err.message);
    status = 0;
  }

  await updateStatus(device_id, status);
}
async function updateStatus(device_id, newStatus) {
  try {

    const { rows } = await pool.query(
      `SELECT status FROM device_status WHERE device_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [device_id]
    );

    const lastStatus = rows[0]?.status ?? null;

    if (lastStatus !== newStatus) {
     
      await pool.query(
        `INSERT INTO device_status (device_id, status, created_at) VALUES ($1,$2,NOW())`,
        [device_id, newStatus]
      );
     
      console.log(`Device ${device_id} status changed: ${lastStatus ?? "-"} → ${newStatus}`);
    }
  } catch (err) {
    
    console.error(`Failed to update status for ${device_id}:`, err.message);
  }
}

async function checkAllDevices() {
  try {
    const { rows: devices } = await pool.query(
      `SELECT device_id, ip_address, slave_id FROM devices`
    );

    for (const d of devices) {
      console.log("Checking:", d.ip_address);
      await checkDevice(d);
    }
  } catch (err) {
    console.error("Check all devices error:", err.message);
  }
}


function startDeviceMonitor() {
  console.log("Starting device monitor...");
  checkAllDevices(); // chạy ngay
  setInterval(() => checkAllDevices(), 60 * 1000); // mỗi phút
}

module.exports = { startDeviceMonitor };
