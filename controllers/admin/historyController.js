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

// ---------- Cấu hình upload ảnh ----------
const storage = diskStorage({
  destination: function (req, file, cb) {
    const dir = 'uploads/';
    if (!existsSync(dir)) mkdirSync(dir);
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const ext = extname(file.originalname);
    cb(null, Date.now() + '-' + file.fieldname + ext);
  }
});

const upload = multer({ storage });

exports.getCustomerStorage = async (req, res) => {
  const { customerId } = req.params;

  try {

    const query = `
      SELECT
        d.device_id,
        d.name AS device_name,

        m.measurement_id,
        m.name AS measurement_name,
        m.unit,

        COALESCE(hc.enabled, false) AS enabled

      FROM devices d

      JOIN device_types_measurements dtm
        ON dtm.device_type_id = d.device_type_id

      JOIN measurements m
        ON m.measurement_id = dtm.measurement_id

      LEFT JOIN history_config hc
        ON hc.device_id = d.device_id
        AND hc.measurement_id = m.measurement_id
        AND hc.customer_id = $1

      WHERE d.customer_id = $1

      ORDER BY d.name, m.name
    `;

    const { rows } = await pool.query(query, [customerId]);

    /* build tree */

    const map = {};

    rows.forEach(r => {

      if (!map[r.device_id]) {
        map[r.device_id] = {
          device_id: r.device_id,
          device_name: r.device_name,
          measurements: []
        };
      }

      map[r.device_id].measurements.push({
        measurement_id: r.measurement_id,
        name: r.measurement_name,
        unit: r.unit,
        enabled: r.enabled
      });
    });

    res.json({
      devices: Object.values(map)
    });

  } catch (err) {
    console.error("GET STORAGE ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
};
exports.toggleHistoryConfig = async (req, res) => {
  const { customerId } = req.params;
  const { device_id, measurement_id, enabled } = req.body;

  try {

    await pool.query(`
      INSERT INTO history_config
        (customer_id, device_id, measurement_id, enabled)
      VALUES ($1,$2,$3,$4)

      ON CONFLICT (customer_id, device_id, measurement_id)
      DO UPDATE SET enabled = EXCLUDED.enabled
    `,
    [customerId, device_id, measurement_id, enabled]);

    res.json({ success: true });

  } catch (err) {
    console.error("TOGGLE HISTORY ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
};
exports.getCustomerStorageSummary = async (req, res) => {
  const { customerId } = req.params;

  try {
    const { rows } = await pool.query(
      `
      SELECT
        c.customer_id,
        c.name AS customer_name,

        /* Tổng quota */
        COALESCE(q.total_quota, 0) AS total_quota,

        /* Devices đang dùng */
        COALESCE(h.devices_using_storage, 0) AS devices_using_storage,

        /* Measurement đang lưu */
        COALESCE(h.saved_measurements, 0) AS saved_measurements,

        /* Remaining */
        COALESCE(q.total_quota, 0)
        - COALESCE(h.saved_measurements, 0)
        AS remaining_slots

      FROM customers c

      /* Subquery quota */
      LEFT JOIN (
        SELECT
          customer_id,
          SUM(quantity) AS total_quota
        FROM storage_quota
        GROUP BY customer_id
      ) q ON q.customer_id = c.customer_id

      /* Subquery history */
      LEFT JOIN (
        SELECT
          customer_id,
          COUNT(DISTINCT device_id) FILTER (WHERE enabled = true)
            AS devices_using_storage,

          COUNT(DISTINCT device_id || '-' || measurement_id)
            FILTER (WHERE enabled = true)
            AS saved_measurements
        FROM history_config
        GROUP BY customer_id
      ) h ON h.customer_id = c.customer_id

      WHERE c.customer_id = $1
      `,
      [customerId]
    );
  
    res.json(rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getHistoryConfigByDeviceAdmin = async (req, res) => {
  const { deviceId } = req.params;

  console.log("\n========== [ADMIN getHistoryConfigByDevice] ==========");
  console.log("👉 deviceId:", deviceId);

  if (!deviceId) {
    console.error("❌ Missing deviceId");
    return res.status(400).json({
      message: "Device ID required",
    });
  }

  try {

    /* ================= CHECK DEVICE ================= */

    const deviceCheck = await pool.query(
      `
      SELECT device_id, name
      FROM devices
      WHERE device_id = $1
      `,
      [deviceId]
    );

    console.log("👉 device exists:", deviceCheck.rowCount);

    if (!deviceCheck.rowCount) {
      console.error("❌ Device NOT found in DB");
      return res.status(404).json({
        message: "Device not found",
      });
    }

    console.log("✅ device name:", deviceCheck.rows[0].name);

    /* ================= HISTORY CONFIG ================= */

    console.log("👉 Running history_config query...");

    const { rows } = await pool.query(
      `
      SELECT
        hc.id,
        hc.device_id,
        hc.measurement_id::text,
        m.name AS measurement_name,
        m.unit
      FROM history_config hc
      JOIN measurements m
        ON m.measurement_id = hc.measurement_id
      WHERE hc.device_id = $1
      ORDER BY m.name
      `,
      [deviceId]
    );

    console.log("✅ history rows:", rows.length);

    if (rows.length) {
      console.log("👉 first row:", rows[0]);
    } else {
      console.warn("⚠️ NO history_config found for this device");
      console.warn(
        "👉 Check if signals were saved into history_config"
      );
    }

    console.log("========== END ADMIN HISTORY ==========\n");

    return res.json({
      data: rows,
    });

  } catch (err) {
    console.error("\n❌ ADMIN HISTORY CONFIG ERROR");
    console.error("message:", err.message);
    console.error("stack:", err.stack);

    return res.status(500).json({
      message: "Server error",
    });
  }
};
exports.adminCreateHistoryConfig = async (req, res) => {
  const { deviceId } = req.params;
  const { measurement_id } = req.body;

  console.log("====== [ADMIN CREATE HISTORY CONFIG] ======");
  console.log("deviceId:", deviceId);
  console.log("measurement_id:", measurement_id);

  if (!measurement_id) {
    return res.status(400).json({
      message: "measurement_id is required",
    });
  }

  try {
    // ✅ Lấy customer từ device
    const deviceRes = await pool.query(
      `
      SELECT s.customer_id
      FROM devices d
      JOIN sites s ON s.site_id = d.site_id
      WHERE d.device_id = $1
      `,
      [deviceId]
    );

    if (!deviceRes.rowCount) {
      return res.status(404).json({
        message: "Device not found",
      });
    }

    const customer_id = deviceRes.rows[0].customer_id;

    console.log("customer_id:", customer_id);

    // ✅ Check quota
    const quotaRes = await pool.query(
      `
      SELECT COUNT(*) 
      FROM history_config
      WHERE customer_id = $1
      `,
      [customer_id]
    );

    const total = +quotaRes.rows[0].count;

    console.log("current quota:", total);

    if (total >= 30) {
      return res.status(403).json({
        message: "Customer reached 30 measurements limit",
      });
    }

    // ✅ Insert
   const insertRes = await pool.query(
  `
  INSERT INTO history_config
  (customer_id, device_id, measurement_id, enabled)
  VALUES ($1, $2, $3, true)

  ON CONFLICT (customer_id, device_id, measurement_id)
  DO UPDATE SET enabled = true

  RETURNING *
  `,
  [customer_id, deviceId, measurement_id]
);

    console.log("Created:", insertRes.rows[0]);

    res.status(201).json(insertRes.rows[0]);

  } catch (err) {
    console.error("ADMIN CREATE ERROR:", err);

    if (err.code === "23505") {
      return res.status(409).json({
        message: "Measurement already configured",
      });
    }

    res.status(500).json({
      message: "Server error",
    });
  }
};
exports.adminUpdateHistoryConfig = async (req, res) => {
  const { id } = req.params;
  const { enabled } = req.body;

  console.log("====== [ADMIN UPDATE HISTORY CONFIG] ======");
  console.log("id:", id);
  console.log("enabled:", enabled);

  try {
    const { rowCount, rows } = await pool.query(
      `
      UPDATE history_config
      SET enabled = $1
      WHERE id = $2
      RETURNING *
      `,
      [enabled, id]
    );

    if (!rowCount) {
      return res.status(404).json({
        message: "Config not found",
      });
    }

    console.log("Updated:", rows[0]);

    res.json(rows[0]);

  } catch (err) {
    console.error("ADMIN UPDATE ERROR:", err);

    res.status(500).json({
      message: "Failed to update history config",
    });
  }
};
exports.adminDeleteHistoryConfig = async (req, res) => {
  const { id } = req.params;

  console.log("====== [ADMIN DELETE HISTORY CONFIG] ======");
  console.log("id:", id);

  try {
    const { rowCount } = await pool.query(
      `
      DELETE FROM history_config
      WHERE id = $1
      `,
      [id]
    );

    if (!rowCount) {
      return res.status(404).json({
        message: "Config not found",
      });
    }

    console.log("Deleted config:", id);

    res.json({
      success: true,
    });

  } catch (err) {
    console.error("ADMIN DELETE ERROR:", err);

    res.status(500).json({
      message: "Failed to delete history config",
    });
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

    /**
     * Bucket config
     * bucketExpr: biểu thức SQL tạo bucket
     * step: dùng cho frontend hiển thị
     */
    const configMap = {
      hour: {
  bucketExpr: `
    date_trunc('hour', timestamp_ms)
    + (floor(EXTRACT(minute FROM timestamp_ms) / 15) + 1) * interval '15 minute'
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
exports.getCustomerStorageQuota = async (req, res) => {
  const { customerId } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT id, quantity, description
      FROM storage_quota
      WHERE customer_id = $1
      ORDER BY created_at ASC
      `,
      [customerId]
    );

    const rows = result.rows;

    const total = rows.reduce(
      (sum, r) => sum + Number(r.quantity || 0),
      0
    );

    return res.json({
      rows,
      total,
    });
  } catch (err) {
    console.error("getCustomerStorageQuota error:", err);
    return res.status(500).json({
      message: "Failed to load storage quota",
    });
  }
};

exports.saveCustomerStorageQuota = async (req, res) => {
  const { customerId } = req.params;
  const { rows } = req.body;

  if (!Array.isArray(rows)) {
    return res.status(400).json({
      message: "Rows must be an array",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /* 1️⃣ Xoá toàn bộ quota cũ */
    await client.query(
      `
      DELETE FROM storage_quota
      WHERE customer_id = $1
      `,
      [customerId]
    );

    /* 2️⃣ Insert lại theo rows mới */
    for (const row of rows) {
      await client.query(
        `
        INSERT INTO storage_quota
        (customer_id, quantity, description)
        VALUES ($1, $2, $3)
        `,
        [
          customerId,
          Number(row.quantity || 0),
          row.description || "",
        ]
      );
    }

    await client.query("COMMIT");

    return res.json({
      message: "Storage quota saved successfully",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("saveCustomerStorageQuota error:", err);

    return res.status(500).json({
      message: "Failed to save storage quota",
    });
  } finally {
    client.release();
  }
};
exports.deleteCustomerStorageQuotaRow = async (req, res) => {
  const { id } = req.params;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Lấy customer_id trước khi xoá
    const existing = await client.query(
      `
      SELECT customer_id
      FROM storage_quota
      WHERE id = $1
      `,
      [id]
    );

    if (existing.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        message: "Quota row not found",
      });
    }

    const customerId = existing.rows[0].customer_id;

    // 2️⃣ Xoá row
    await client.query(
      `
      DELETE FROM storage_quota
      WHERE id = $1
      `,
      [id]
    );

    // 3️⃣ Tính lại summary mới
    const summary = await client.query(
      `
      SELECT
        COALESCE(SUM(quantity), 0) AS total_quota
      FROM storage_quota
      WHERE customer_id = $1
      `,
      [customerId]
    );

    await client.query("COMMIT");

    return res.json({
      message: "Quota row deleted successfully",
      total_quota: Number(summary.rows[0].total_quota),
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("deleteCustomerStorageQuotaRow error:", err);

    return res.status(500).json({
      message: "Failed to delete quota row",
    });
  } finally {
    client.release();
  }
};



