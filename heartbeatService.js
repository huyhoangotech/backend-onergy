// heartbeatService.js
const axios = require("axios");
const os = require("os");
const { Pool } = require("pg");

// ======================
// CONFIG
// ======================
const BACKEND_URL = "http://be.otech.vn/api/admin/heartbeat"; 
const DEVICE_ID = "8f4c2b6a-1c3e-4b7d-9a5f-6a3d8d9e2c11";

const pool = new Pool({
  user: "postgres",
  host: "171.244.141.14",
  database: "Recloser app",
  password: "1122",
  port: 5432,
});

// ======================
// GET LOCAL IP
// ======================
function getLocalIP() {
  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === "IPv4" && !net.internal) {
        if (
          net.address.startsWith("192.168") ||
          net.address.startsWith("10.") ||
          net.address.startsWith("172.")
        ) {
          return net.address;
        }
      }
    }
  }
  return null;
}

// ======================
// GET PUBLIC IP (optional)
// ======================
async function getPublicIP() {
  try {
    const res = await axios.get("https://api.ipify.org?format=json");
    return res.data.ip;
  } catch (err) {
    return null;
  }
}

// ======================
// SEND HEARTBEAT
// ======================
async function sendHeartbeat() {
  const lan_ip = getLocalIP();
  const public_ip = await getPublicIP();

  try {
    await axios.post(BACKEND_URL, {
      device_id: DEVICE_ID,
      lan_ip,
      public_ip,
      status: "ONLINE",
      timestamp: Date.now(),
    });

    console.log("📡 Heartbeat sent:", {
      device_id: DEVICE_ID,
      lan_ip,
      public_ip,
    });
  } catch (err) {
    console.log("❌ Heartbeat error:", err.message);
  }
}

// ======================
// LOOP RUNNER
// ======================
function startHeartbeatService(intervalMs = 10000) {
  console.log("🚀 Heartbeat service started...");

  // gửi ngay lần đầu
  sendHeartbeat();

  // chạy định kỳ
  setInterval(() => {
    sendHeartbeat();
  }, intervalMs);
}

// ======================
// EXPORT
// ======================
module.exports = {
  startHeartbeatService,
};