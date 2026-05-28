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
exports.getDeviceTypes = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, code, name, description, created_at, updated_at
      FROM device_types
      ORDER BY name ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error("[DEVICE TYPES] Error fetching device types:", err);
    res.status(500).json({ message: "Server error" });
  }
};
exports.getDevicesByType = async (req, res) => {
  const { id } = req.params; // id của device_type

  if (!id) return res.status(400).json({ message: "Device type ID is required" });

  try {
    const { rows } = await pool.query(
      `
      SELECT d.device_id, d.name, d.serial_number, d.ip_address,
             d.model, d.status, dt.name AS device_type_name
      FROM devices d
      JOIN device_types dt ON dt.id = d.device_type_id
      WHERE d.device_type_id = $1
      ORDER BY d.name ASC
      `,
      [id]
    );

    res.json(rows);
  } catch (err) {
    console.error("[DEVICES] Error fetching devices by type:", err);
    res.status(500).json({ message: "Server error" });
  }
};
exports.getMeasurementsByDeviceType = async (req, res) => {
  const { id } = req.params;

  try {
    const { rows } = await pool.query(
      `
      SELECT 
        m.measurement_id,
        m.code,
        m.name,
        m.unit,
        m.parent_id
      FROM device_types_measurements dtm
      JOIN measurements m 
        ON m.measurement_id = dtm.measurement_id
      WHERE dtm.device_type_id = $1
      ORDER BY m.name
      `,
      [id]
    );

    res.json(rows);
  } catch (err) {
    console.error("[DEVICE TYPE MEASUREMENTS] GET error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
/* ================= ADD MEASUREMENT TO DEVICE TYPE ================= */
exports.addMeasurementToDeviceType = async (req, res) => {
  const { id: device_type_id } = req.params;
  const { measurement_id } = req.body;

  if (!measurement_id) {
    return res.status(400).json({ message: "measurement_id is required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Insert device_types_measurements
    const insertDTM = await client.query(
      `
      INSERT INTO device_types_measurements (device_type_id, measurement_id)
      VALUES ($1, $2)
      ON CONFLICT (device_type_id, measurement_id) DO NOTHING
      RETURNING id
      `,
      [device_type_id, measurement_id]
    );

    // Lấy id (trường hợp đã tồn tại)
    let device_type_measurement_id;
    if (insertDTM.rows.length > 0) {
      device_type_measurement_id = insertDTM.rows[0].id;
    } else {
      const existing = await client.query(
        `
        SELECT id
        FROM device_types_measurements
        WHERE device_type_id = $1 AND measurement_id = $2
        `,
        [device_type_id, measurement_id]
      );
      device_type_measurement_id = existing.rows[0].id;
    }

    // 2. Insert vào product_lines_modbus cho tất cả product_line của type
    await client.query(
      `
      INSERT INTO product_lines_modbus (
        product_line_id,
        device_type_measurement_id
      )
      SELECT
        pl.product_line_id,
        $1
      FROM product_lines pl
      WHERE pl.device_type_id = $2
      ON CONFLICT DO NOTHING
      `,
      [device_type_measurement_id, device_type_id]
    );

    await client.query("COMMIT");

    res.json({
      message: "Measurement added to device type and all product lines",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[DEVICE TYPE MEASUREMENT] ADD error:", err);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
};

/* ================= REMOVE MEASUREMENT FROM DEVICE TYPE ================= */
exports.removeMeasurementFromDeviceType = async (req, res) => {
  const { id, measurement_id } = req.params;

  try {
    const { rowCount } = await pool.query(
      `
      DELETE FROM device_types_measurements
      WHERE device_type_id = $1
        AND measurement_id = $2
      `,
      [id, measurement_id]
    );

    if (rowCount === 0)
      return res
        .status(404)
        .json({ message: "Measurement not assigned to this device type" });

    res.json({ message: "Measurement removed from device type" });
  } catch (err) {
    console.error("[DEVICE TYPE MEASUREMENTS] DELETE error:", err);
    res.status(500).json({ message: "Server error" });
  }
};