const { Pool, Client } = require("pg");
const { checkAndHandleAlarm } = require("./alarmService");

const pool = new Pool({
  user: "postgres",
   host: "171.244.141.14",
  database: "Recloser app",
  password: "1122",
  port: 5432,
});

const listener = new Client({
  user: "postgres",
   host: "171.244.141.14",
  database: "Recloser app",
  password: "1122",
  port: 5432,
});

async function processAlarms() {

  const client = await pool.connect();

  try {

    await client.query("BEGIN");

    // 🔥 LOCK ROWS
    const res = await client.query(`
      SELECT *
      FROM device_logs
      WHERE alarm_processed = false
      ORDER BY timestamp_ms
      LIMIT 100
      FOR UPDATE SKIP LOCKED
    `);

    for (const log of res.rows) {

      await checkAndHandleAlarm({
        device_id: log.device_id,
        measurement_id: log.measurement_id,
        value: log.value,
        timestamp: log.timestamp_ms,
      });

      await client.query(`
        UPDATE device_logs
        SET alarm_processed = true
        WHERE id = $1
      `, [log.id]);
    }

    await client.query("COMMIT");

  } catch (err) {

    await client.query("ROLLBACK");
    console.error("Worker TX ERROR:", err);

  } finally {

    client.release();
  }
}

async function startAlarmWorker() {

  await listener.connect();
  await listener.query("LISTEN device_log_inserted");

  console.log("👂 Alarm worker listening...");

  listener.on("notification", async () => {
    processAlarms().catch(console.error);
  });

}

module.exports = { startAlarmWorker };
