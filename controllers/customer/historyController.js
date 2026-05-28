const multer = require('multer');
const { diskStorage } = require('multer');
const { extname } = require('path');
const { existsSync, mkdirSync } = require('fs');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const path = require("path");

// ---------- Database ----------
const pool = new Pool({
  user: 'postgres',
  host: "171.244.141.14",
  database: 'Recloser app',
   password: '1122',
  port: 5432,
});

exports.getMeasurementHistory1H = async (req, res) => {
  const { device_id, measurement_id } = req.params;

  const to = Date.now();
  const from = to - 60 * 60 * 1000;

  try {
    const { rows } = await pool.query(
      `
      SELECT
        date_trunc('hour', timestamp_ms)
          + floor(EXTRACT(MINUTE FROM timestamp_ms) / 15)
            * INTERVAL '15 minute' AS bucket,
        AVG(value) AS avg_value
      FROM device_logs
      WHERE device_id = $1
        AND measurement_id = $2
        AND timestamp_ms BETWEEN to_timestamp($3 / 1000.0)
                              AND to_timestamp($4 / 1000.0)
      GROUP BY bucket
      ORDER BY bucket
      `,
      [device_id, measurement_id, from, to]
    );

    res.json({
      range: "1h",
      group: "15m",
      data: rows,
    });
  } catch (err) {
    console.error("[getMeasurementHistory1H]", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getDeviceMeasurementInfo = async (req, res) => {
  const { device_id, measurement_id } = req.params;

  try {
    const deviceRes = await pool.query(
      `SELECT device_id, name FROM devices WHERE device_id = $1`,
      [device_id]
    );

    const measurementRes = await pool.query(
      `SELECT measurement_id, name, unit FROM measurements WHERE measurement_id = $1`,
      [measurement_id]
    );

    res.json({
      device: deviceRes.rows[0],
      measurement: measurementRes.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};
exports.getMeasurementHistory = async (req, res) => {
  try {
    const { device_id, measurement_id } = req.params;
    let { from, to, type = "hour" } = req.query;

    from = Number(from);
    to = Number(to);

    if (!from || !to || from >= to) {
      return res.status(400).json({ message: "Invalid from/to" });
    }

    const configMap = {
        hour: {
  bucketExpr: `
    date_trunc('hour', timestamp_ms)
    + (floor(EXTRACT(minute FROM timestamp_ms) / 15) ) * interval '15 minute'
  `,
  step: "15 minute",
},
      day: {
        bucketExpr: `date_trunc('hour', timestamp_ms)`,
        step: "1 hour",
      },

      week: {
        bucketExpr: `date_trunc('day', timestamp_ms)`,
        step: "1 day",
      },

      month: {
        bucketExpr: `date_trunc('day', timestamp_ms)`,
        step: "1 day",
      },

      year: {
        bucketExpr: `date_trunc('month', timestamp_ms)`,
        step: "1 month",
      },
    };

    const cfg = configMap[type];
    if (!cfg) {
      return res.status(400).json({ message: "Invalid type" });
    }

    const query = `
      SELECT
        ${cfg.bucketExpr} AS bucket,
        AVG(value)::float AS avg_value,
        MIN(value)::float AS min_value,
        MAX(value)::float AS max_value
      FROM device_logs
      WHERE device_id = $1
        AND measurement_id = $2
        AND timestamp_ms BETWEEN
          to_timestamp($3 / 1000.0)
          AND to_timestamp($4 / 1000.0)
      GROUP BY bucket
      ORDER BY bucket
    `;

    const { rows } = await pool.query(query, [
      device_id,
      measurement_id,
      from,
      to,
    ]);

    res.json({
      type,
      from,
      to,
      step: cfg.step,
      data: rows,
    });
  } catch (err) {
    console.error("getMeasurementHistory error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
exports.getMobileStorageQuota = async (req, res) => {
 const userId = req.user?.user_id;

  console.log("📌 userId from token:", userId);

  try {

    /* lấy customer_id từ user */
    const userResult = await pool.query(
      `
      SELECT customer_id
      FROM users
      WHERE user_id = $1
      `,
      [userId]
    );

    if (userResult.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const customerId = userResult.rows[0].customer_id;

    console.log("📌 customerId:", customerId);

    /* total quota */
    const quotaResult = await pool.query(
      `
      SELECT COALESCE(SUM(quantity),0) AS total_quota
      FROM storage_quota
      WHERE customer_id = $1
      `,
      [customerId]
    );

    console.log("📌 quota query result:", quotaResult.rows);

    const totalQuota = Number(quotaResult.rows[0].total_quota);

    /* saved measurements */
    const savedResult = await pool.query(
      `
      SELECT COUNT(*) AS saved
      FROM history_config hc
      JOIN devices d ON d.device_id = hc.device_id
      JOIN sites s ON s.site_id = d.site_id
      WHERE s.customer_id = $1
      `,
      [customerId]
    );

    console.log("📌 saved query result:", savedResult.rows);

    const savedMeasurements = Number(savedResult.rows[0].saved);

    const remaining = totalQuota - savedMeasurements;

    console.log("📌 FINAL RESULT:", {
      totalQuota,
      savedMeasurements,
      remaining
    });

    return res.json({
      total_quota: totalQuota,
      saved_measurements: savedMeasurements,
      remaining_slots: remaining < 0 ? 0 : remaining
    });

  } catch (err) {
    console.error("❌ getMobileStorageQuota error:", err);
    return res.status(500).json({
      message: "Failed to load storage quota"
    });
  }
};