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
exports.getDevices = async (req, res) => {
  try {
    const { status } = req.query; // connected | disconnected | undefined

    const values = [];
    let whereClause = "";

    // map string -> number
    if (status === "connected") {
      values.push(1);
      whereClause = `WHERE COALESCE(ds.status, 0) = $1`;
    }

    if (status === "disconnected") {
      values.push(0);
      whereClause = `WHERE COALESCE(ds.status, 0) = $1`;
    }

    const query = `
      SELECT
        d.device_id,
        d.name            AS device_name,
        d.serial_number,
        d.ip_address,
        d.model,
        d.slave_id,
        d.created_at,


        -- 🔥 trạng thái mới nhất
        COALESCE(ds.status, 0) AS status,

        d.product_line_id,
        pl.name           AS product_line_name,

        dt.id             AS device_type_id,
        dt.name           AS device_type_name,

        s.site_id,
        s.name            AS site_name

      FROM devices d

      -- 🔥 status mới nhất
      LEFT JOIN LATERAL (
        SELECT status
        FROM device_status
        WHERE device_id = d.device_id
        ORDER BY created_at DESC
        LIMIT 1
      ) ds ON TRUE

      LEFT JOIN device_types dt 
        ON dt.id = d.device_type_id

      LEFT JOIN product_lines pl
        ON pl.product_line_id = d.product_line_id

      LEFT JOIN sites s 
        ON s.site_id = d.site_id

      ${whereClause}

      ORDER BY d.created_at DESC
    `;

    const { rows } = await pool.query(query, values);

    // map status number -> string cho frontend
    const result = rows.map((r) => ({
      ...r,
      status: r.status === 1 ? "connected" : "disconnected",
    }));

    res.json(result);
  } catch (error) {
    console.error("Error getDevices:", error);
    res.status(500).json({ error: "Failed to get devices" });
  }
};
exports.getDeviceDetail = async (req, res) => {
  const { deviceId } = req.params;

  // kiểm tra UUID hợp lệ
  if (!deviceId) {
  return res.status(400).json({ message: "Missing device ID" });
}


  try {
    const { rows } = await pool.query(`
      SELECT d.device_id, d.name AS device_name, d.serial_number, d.model,
             ds.status, dt.name AS device_type_name, s.name AS site_name
      FROM devices d
      LEFT JOIN device_types dt ON dt.id = d.device_type_id
      LEFT JOIN sites s ON s.site_id = d.site_id
      LEFT JOIN device_status ds ON ds.device_id = d.device_id
      WHERE d.device_id = $1
      LIMIT 1
    `, [deviceId]);

    if (rows.length === 0)
      return res.status(404).json({ message: "Device not found" });

    res.json(rows[0]);
  } catch (err) {
    console.error("❌ GET DEVICE ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getAdminDeviceAlarmLogs = async (req, res) => {

  const { deviceId } = req.params;

  if (!deviceId) {
    return res.status(400).json({ message: "Device ID is required" });
  }

  try {
    const query = `
      SELECT 
        al.id,
        al.device_id,

        d.name           AS device_name,
        dt.name          AS device_type_name,

        al.measurement_id,
        m.name           AS measurement_name,
        m.unit           AS measurement_unit,

        al.value,
        al.status,
        al.severity,
        al.description,

        al.triggered_at,
        al.resolved,
        al.resolved_by,
        al.resolved_at,
        al.start_value,
        al.end_value,
        al.duration,
        al.event_type
      FROM alarm_logs al
      LEFT JOIN devices d 
        ON al.device_id = d.device_id
      LEFT JOIN device_types dt 
        ON d.device_type_id = dt.id
      LEFT JOIN measurements m 
        ON al.measurement_id = m.measurement_id
     WHERE al.device_id = $1
AND al.category = 1
      ORDER BY al.triggered_at DESC
      LIMIT 200
    `;

    const { rows } = await pool.query(query, [deviceId]);


    return res.status(200).json({
      alarms: rows,
    });

  } catch (err) {
    console.error("❌ [ADMIN][ALARM_LOGS] ERROR:", err.stack);
    return res.status(500).json({
      message: "Server error",
    });
  }
};
exports.createDevice = async (req, res) => {
  const {
    device_name,
    serial_number,
    ip_address,
    model,
    device_type_id,
    product_line_id,
    site_id,
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ tạo device (KHÔNG status)
    const deviceResult = await client.query(
      `
      INSERT INTO devices (
        name,
        serial_number,
        ip_address,
        model,
        device_type_id,
        product_line_id,
        site_id,
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING device_id
      `,
      [
        device_name || null,
        serial_number || null,
        ip_address && ip_address.trim() !== "" ? ip_address : null,
        model || null,
        device_type_id || null,
        product_line_id || null,
        site_id || null,
      ]
    );

    const deviceId = deviceResult.rows[0].device_id;

    // 2️⃣ tạo status ban đầu (connected = 1)
    await client.query(
      `
      INSERT INTO device_status (
        device_id,
        status,
        created_at
      )
      VALUES ($1, 1, NOW())
      `,
      [deviceId]
    );

    await client.query("COMMIT");

    return res.json({
      message: "Device created successfully",
      device_id: deviceId,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error createDevice:", err);

    // SERIAL TRÙNG
    if (err.code === "23505" && err.constraint === "devices_serial_number_key") {
      return res.status(400).json({
        error: "Serial number already exists",
        field: "serial_number",
      });
    }

    // UUID sai
    if (err.code === "22P02") {
      return res.status(400).json({
        error: "Invalid input format",
      });
    }

    return res.status(500).json({
      error: "Failed to create device",
    });
  } finally {
    client.release();
  }
};
exports.updateDevice = async (req, res) => {
  const { device_id } = req.params;
  console.log("UPDATE device_id:", device_id);

  const {
    device_name,
    serial_number,
    ip_address,
    model,
    device_type_id,
    product_line_id, // ✅ mới thêm
    site_id,
    status,
     slave_id,
  } = req.body;

  try {
    const fields = [];
    const values = [];
    let idx = 1;

    // device_name
    if (device_name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(device_name || null);
    }

    // serial_number
    if (serial_number !== undefined) {
      fields.push(`serial_number = $${idx++}`);
      values.push(serial_number || null);
    }

    // ip_address
    if (ip_address !== undefined) {
      fields.push(`ip_address = $${idx++}`);
      values.push(ip_address && ip_address.trim() !== "" ? ip_address : null);
    }

    // model
    if (model !== undefined) {
      fields.push(`model = $${idx++}`);
      values.push(model || null);
    }

    // device_type_id
    if (device_type_id !== undefined) {
      fields.push(`device_type_id = $${idx++}`);
      values.push(device_type_id && device_type_id !== "" ? device_type_id : null);
    }

    // product_line_id
    if ("product_line_id" in req.body) {
      fields.push(`product_line_id = $${idx++}`);
      values.push(product_line_id || null);
    }

    // site_id
    if ("site_id" in req.body) {
      fields.push(`site_id = $${idx++}`);
      values.push(site_id || null);
    }

    // status
    if (status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(status);
    }
// slave_id
if ("slave_id" in req.body) {
  fields.push(`slave_id = $${idx++}`);
  values.push(slave_id || null);
}
    // Không có field nào để update
    if (fields.length === 0) {
      return res.status(400).json({
        error: "No fields to update",
      });
    }

    fields.push(`updated_at = NOW()`);

    const query = `
      UPDATE devices
      SET ${fields.join(", ")}
      WHERE device_id = $${idx}
      RETURNING device_id,
                name AS device_name,
                serial_number,
                ip_address,
                model,
                status,
                device_type_id,
                product_line_id,
                slave_id
    `;

    values.push(device_id);

    const result = await pool.query(query, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Device not found" });
    }

    const device = result.rows[0];

    // Lấy product_line_name nếu product_line_id có
    let product_line_name = null;
    if (device.product_line_id) {
      const plRes = await pool.query(
        `SELECT name FROM product_lines WHERE product_line_id = $1`,
        [device.product_line_id]
      );
      if (plRes.rowCount > 0) {
        product_line_name = plRes.rows[0].name;
      }
    }

    return res.json({
      message: "Device updated successfully",
      device: {
        ...device,
        product_line_name,
      },
    });
  } catch (err) {
    console.error("Error updateDevice:", err);

    if (err.code === "23505" && err.constraint === "devices_serial_number_key") {
      return res.status(400).json({
        error: "Serial number already exists",
        field: "serial_number",
      });
    }

    if (err.code === "22P02") {
      return res.status(400).json({ error: "Invalid input format" });
    }

    return res.status(500).json({ error: "Failed to update device" });
  }
};
exports.deleteDevice = async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query(
      `DELETE FROM devices WHERE device_id = $1`,
      [id]
    );

    res.json({ message: "Device deleted successfully" });
  } catch (err) {
    console.error("Error deleteDevice:", err);
    res.status(500).json({ error: "Failed to delete device" });
  }
};
exports.getDeviceTypes = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, name
      FROM device_types
      ORDER BY name
    `);

    res.json(rows);
  } catch (err) {
    console.error("getDeviceTypes:", err);
    res.status(500).json({ error: "Failed to load device types" });
  }
};
exports.getDeviceMeasurements = async (req, res) => {
  const { deviceId } = req.params;

  if (!deviceId) {
    return res.status(400).json({
      message: "Device ID required",
    });
  }

  try {
    const result = await pool.query(
      `
      SELECT 
        m.measurement_id,
        m.name,
        m.unit,
        m.parent_id
      FROM measurements m
      JOIN device_types_measurements dtm
        ON dtm.measurement_id = m.measurement_id
      JOIN devices d
        ON d.device_type_id = dtm.device_type_id
      WHERE d.device_id = $1
      ORDER BY 
        COALESCE(m.parent_id, m.measurement_id),
        m.parent_id NULLS FIRST
      `,
      [deviceId]
    );

    return res.json({
      data: result.rows,
    });

  } catch (err) {
    console.error("MEASUREMENTS CONFIG ERROR:", err);
    return res.status(500).json({
      message: "Server error",
    });
  }
};
  