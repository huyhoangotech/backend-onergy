const { scanRegistersAndSave,scanAlarmOnly  } = require("./modbusReader");
const { Pool } = require("pg");

const pool = new Pool({
  user: "postgres",
  host: "171.244.141.14",
  database: "Recloser app",
  password: "1122",
  port: 5432,
});

let running = false;

/* ======================================
   SCAN ALL DEVICES
====================================== */

async function scanAllDevices(source = "cron") {
  try {

    const { rows } = await pool.query(`
      SELECT device_id
      FROM devices
    `);

    for (const d of rows) {

      try {

        await scanRegistersAndSave(d.device_id, source);

      } catch (err) {

        console.error("Device scan error:", d.device_id, err);

      }

    }

  } catch (err) {

    console.error("Scan all devices error:", err);

  }
}
async function scanAlarmAllDevices() {
  try {

    const { rows } = await pool.query(`
      SELECT device_id
      FROM devices
    `);

    for (const d of rows) {

      // ❗ KHÔNG await → chạy song song nhẹ
      scanAlarmOnly(d.device_id).catch(err =>
        console.error("Alarm scan error:", d.device_id, err)
      );

    }

  } catch (err) {

    console.error("Scan alarm devices error:", err);

  }
}
/* ======================================
   POLLING LOOP
====================================== */

async function pollingLoop() {

  console.log("🟢 Modbus polling loop started");

  running = true;

  // 🔥 alarm chạy riêng
  setInterval(() => {
    scanAlarmAllDevices();
  }, 2000); // ⚡ 2 giây (realtime)

  // 🔥 loop chính (full scan)
  while (running) {

    await scanAllDevices("cron");

  }

}

/* ======================================
   START / STOP
====================================== */

function startModbusScheduler() {

  if (running) {
    console.log("⚠️ Modbus scheduler already started");
    return;
  }

  pollingLoop().catch(err =>
    console.error("Polling loop crashed:", err)
  );

}

function stopModbusScheduler() {

  running = false;

  console.log("🛑 Modbus scheduler stopped");

}

module.exports = {
  startModbusScheduler,
  stopModbusScheduler,
};