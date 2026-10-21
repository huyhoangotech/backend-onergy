const { scanGatewayDevices, scanRegistersAndSave } = require("./modbusReader");
const { loadActiveEthernetDevices } = require("./modbus/ethernetDeviceLoader");
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
   SCAN ALL GATEWAYS
====================================== */
async function scanAllGateways(source = "cron") {
  try {
    const { rows } = await pool.query(`
      SELECT gateway_id
      FROM gateways
    `); 
    await Promise.all(
      rows.map(async (g) => {

        try {

          await scanGatewayDevices(
            g.gateway_id,
            source
          );

        } catch(err) {

          console.error(
            "Gateway scan error:",
            g.gateway_id,
            err.message
          );

        }

      })
    );
  } catch(err) {

    console.error(
      "Scan all gateways error:",
      err.message
    );

  }
}
async function scanAllEthernetDevices(source = "cron") {
  try {
    const devices = await loadActiveEthernetDevices();

    if (!devices.length) {
      console.log("ℹ️ No active ethernet devices");
      return;
    }

    for (const device of devices) {
      try {
        console.log(
          `🖧 Scan ethernet device ${device.device_name || device.device_id} | ip=${device.ip_address} | port=${device.port || 502}`
        );
console.log("Before scanRegistersAndSave");
        // scanRegistersAndSave(deviceId) phải hỗ trợ connection_type='ethernet'
        await scanRegistersAndSave(device.device_id, source);
        console.log("After scanRegistersAndSave");
      } catch (err) {
        console.error(
          "Ethernet device scan error:",
          device.device_id,
          err.message
        );
      }
    }
  } catch (err) {
    console.error("Scan all ethernet devices error:", err.message);
  }
}

/* ======================================
   FULL SCAN
====================================== */
async function fullScan(source = "cron") {
  console.log("🔄 Gateway scan started");
  await scanAllGateways(source);
  console.log("✅ Gateway scan done");

  console.log("🔄 Ethernet scan started");
  await scanAllEthernetDevices(source);
  console.log("✅ Ethernet scan done");
}

/* ======================================
   POLLING LOOP
====================================== */
async function pollingLoop() {
  console.log("🟢 Modbus scheduler started");
  running = true;

  console.log("🔄 Initial full scan started");
  await fullScan("cron");
  console.log("✅ Initial full scan done");

  while (running) {
    await fullScan("cron");

    // nghỉ 2s giữa 2 vòng để tránh ăn CPU / spam gateway
    await new Promise((resolve) => setTimeout(resolve, 2000));
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

  pollingLoop().catch((err) =>
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