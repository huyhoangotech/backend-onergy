const { sendPush } = require("../backend/services/pushService");
const { getTokensByDevice,getAllTokens } = require("../backend/services/tokenService");
const { Pool } = require("pg");

const pool = new Pool({
  user: "postgres",
   host: "171.244.141.14",
  database: "Recloser app",
  password: "1122",
  port: 5432,
});

async function checkAndHandleAlarm({
  device_id,
  measurement_id,
  value,
  timestamp
}) {

  const client = await pool.connect();
 let shouldSend = false;
  let pushMessage = "";
  try {

    // 🔥 CAST VALUE NGAY
    const valueNum = Number(value);

    if (Number.isNaN(valueNum)) {
      console.error("INVALID VALUE:", value);
      return;
    }

    await client.query("BEGIN");

    // ===============================
    // 1️⃣ lấy alarm config
    // ===============================
    const alarmRes = await client.query(`
      SELECT *
      FROM alarms
      WHERE device_id = $1
      AND measurement_id = $2
      LIMIT 1
    `, [device_id, measurement_id]);

    if (!alarmRes.rows.length) {
      await client.query("COMMIT");
      return;
    }

    const alarm = alarmRes.rows[0];

    const high = alarm.threshold_high !== null
      ? Number(alarm.threshold_high)
      : null;

    const low = alarm.threshold_low !== null
      ? Number(alarm.threshold_low)
      : null;

    const isHigh = high !== null && valueNum > high;
    const isLow  = low !== null && valueNum < low;

    // ===============================
    // 2️⃣ LOCK ACTIVE ROW
    // ===============================
    const activeRes = await client.query(`
      SELECT *
      FROM alarm_logs
      WHERE alarm_id = $1
      AND status = 'ACTIVE'
      FOR UPDATE
    `, [alarm.id]);

    const activeAlarm = activeRes.rows[0];

    // ===============================
    // 3️⃣ measurement info
    // ===============================
    const mRes = await client.query(`
      SELECT name, unit
      FROM measurements
      WHERE measurement_id = $1
    `, [measurement_id]);

    const measurementName = mRes.rows[0]?.name || "Unknown";
    const unit = mRes.rows[0]?.unit || "";

    let eventType = null;
    let description = null;

    if (isHigh) {
      eventType = `HIGH_${measurementName.replace(/\s+/g, "_")}`;
      description = `High ${measurementName}: ${valueNum}${unit} / ${high}${unit}`;
    }

    if (isLow) {
      eventType = `LOW_${measurementName.replace(/\s+/g, "_")}`;
      description = `Low ${measurementName}: ${valueNum}${unit} / ${low}${unit}`;
    }

    // ===============================
    // 🚨 CREATE ACTIVE
    // ===============================
    if ((isHigh || isLow) && !activeAlarm) {

      await client.query(`
  INSERT INTO alarm_logs (
    alarm_id,
    device_id,
    measurement_id,
    value,
    triggered_at,
    status,
    event_type,
    severity,
    description,
    category
  )
  VALUES ($1,$2,$3,$4,$5,
          'ACTIVE',$6,'MEDIUM',$7,$8)
`, [
  alarm.id,
  device_id,
  measurement_id,
  valueNum,
  new Date(timestamp),
  eventType,
  description,
  1 // 🔥 alarm
]);
  shouldSend = true;
      pushMessage = description;
    }

    // ===============================
    // ✅ RESOLVE
    // ===============================
    if (!isHigh && !isLow && activeAlarm) {

      const durationSec = Math.floor(
        (Date.now() -
          new Date(activeAlarm.triggered_at).getTime()) / 1000
      );

      await client.query(`
        UPDATE alarm_logs
        SET
          status = 'RESOLVED',
          resolved_at = NOW(),
          duration = $1
        WHERE id = $2
      `, [
        durationSec,
        activeAlarm.id
      ]);
    }

    await client.query("COMMIT");

  } catch (err) {

    await client.query("ROLLBACK");
    console.error("ALARM TX ERROR:", err);

  } finally {

    client.release();
  }
  if (shouldSend) {
    try {
     const tokens = await getTokensByDevice(device_id);

      sendPush(
        tokens,
        "🚨 ALARM",
        pushMessage
      );

      console.log("📲 Push sent:", pushMessage);

    } catch (err) {
      console.error("Push send error:", err);
    }
  }
}

module.exports = { checkAndHandleAlarm };
