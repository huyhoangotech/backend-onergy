const { Pool } = require("pg");

const pool = new Pool({
  user: "postgres",
  host: "171.244.141.14",
  database: "Recloser app",
  password: "1122",
  port: 5432,
});

async function getAllTokens() {
  const res = await pool.query(`
    SELECT push_token FROM user_push_tokens
  `);

  return res.rows.map(r => r.push_token);
}
async function getTokensByDevice(deviceId) {
  try {
    console.log("📡 [INPUT] deviceId:", deviceId);

    const res = await pool.query(`
      SELECT DISTINCT upt.push_token
      FROM devices d
      JOIN users_sites us ON us.site_id = d.site_id
      JOIN user_push_tokens upt ON upt.user_id = us.user_id
      WHERE d.device_id = $1
        AND upt.push_token IS NOT NULL
        AND upt.push_token <> ''
    `, [deviceId]);

    console.log("📲 [RESULT RAW]:", res.rows);

    const tokens = res.rows.map(r => r.push_token);

    console.log("🚀 [TOKENS]:", tokens);
    console.log("📊 [COUNT]:", tokens.length);

    if (tokens.length === 0) {
      console.warn("⚠️ No tokens found for device:", deviceId);

      // 🔥 DEBUG sâu hơn (chỉ khi fail)
      const debug = await pool.query(`
        SELECT 
          d.device_id,
          d.site_id,
          us.user_id,
          upt.push_token
        FROM devices d
        LEFT JOIN users_sites us ON us.site_id = d.site_id
        LEFT JOIN user_push_tokens upt ON upt.user_id = us.user_id
        WHERE d.device_id = $1
      `, [deviceId]);

      console.log("🧪 [DEBUG JOIN RESULT]:", debug.rows);
    }

    return tokens;

  } catch (err) {
    console.error("🔥 getTokensByDevice ERROR:", err);
    return [];
  }
}

module.exports = { getAllTokens, getTokensByDevice };