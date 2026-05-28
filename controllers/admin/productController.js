const multer = require('multer');
const { diskStorage } = require('multer');
const { extname } = require('path');
const { existsSync, mkdirSync } = require('fs');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const path = require("path");
const {readDeviceRawRange} = require('../../modbusReader')
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
exports.createProductLine = async (req, res) => {
  const {
    device_type_id,
    code,
    name,
    description,
    manufacturer,
    protocol,
  } = req.body;

  if (!code || !name || !device_type_id) {
    return res.status(400).json({
      message: "device_type_id, code và name là bắt buộc",
    });
  }

  try {
    // 1️⃣ Thêm product line
    const { rows } = await pool.query(
      `
      INSERT INTO product_lines (
        device_type_id,
        code,
        name,
        description,
        manufacturer,
        protocol,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING *
      `,
      [
        device_type_id,
        code.trim(),
        name.trim(),
        description || null,
        manufacturer || null,
        protocol || null,
      ]
    );

    const productLine = rows[0];

    // 2️⃣ Lấy tất cả measurement của device_type
    const { rows: dtMeasurements } = await pool.query(
      `
      SELECT id AS device_type_measurement_id
      FROM device_types_measurements
      WHERE device_type_id = $1
      `,
      [device_type_id]
    );

    // 3️⃣ Thêm các record vào product_lines_modbus với modbus_address = NULL
    if (dtMeasurements.length > 0) {
      const insertValues = dtMeasurements
        .map(
          (m, idx) =>
            `($1, $${idx + 2}, NULL, NOW())`
        )
        .join(", ");

      const params = [productLine.product_line_id, ...dtMeasurements.map((m) => m.device_type_measurement_id)];

      await pool.query(
        `
        INSERT INTO product_lines_modbus (
          product_line_id,
          device_type_measurement_id,
          modbus_address,
          created_at
         
        )
        VALUES ${insertValues}
        `,
        params
      );
    }

    res.status(201).json({
      message: "Product line created successfully",
      product_line: productLine,
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        message: "Product line code already exists",
      });
    }

    console.error("[PRODUCT_LINES] Create error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
// controllers/admin/productLineController.js
exports.getProductLinesByDeviceType = async (req, res) => {
  const { id } = req.params; // device_type_id

  if (!id) {
    return res.status(400).json({ message: "Device type ID is required" });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT
        pl.product_line_id,
        pl.code,
        pl.name,
        pl.description,
        pl.manufacturer,
        pl.protocol,
        pl.created_at,
        pl.updated_at
      FROM product_lines pl
      WHERE pl.device_type_id = $1
      ORDER BY pl.name ASC
      `,
      [id]
    );

    res.json(rows);
  } catch (err) {
    console.error(
      "[PRODUCT_LINES] Error fetching product lines by device type:",
      err.stack
    );
    res.status(500).json({ message: "Server error" });
  }
};
exports.getAllProducts = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        pl.product_line_id,
        pl.device_type_id,
        dt.name            AS device_type_name,
        pl.code,
        pl.name,
        pl.description,
        pl.manufacturer,
        pl.protocol,
        pl.created_at,
        pl.updated_at
      FROM product_lines pl
      LEFT JOIN device_types dt 
        ON dt.id = pl.device_type_id
      ORDER BY pl.name
    `);

    res.json(rows);
  } catch (err) {
    console.error("[PRODUCT_LINES] GET all error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
exports.updateProductLine = async (req, res) => {
  const { id } = req.params;
  const { code, name, manufacturer, protocol, description } = req.body;

  try {
    const result = await pool.query(
      `
      UPDATE product_lines
      SET
        code = $1,
        name = $2,
        manufacturer = $3,
        protocol = $4,
        description = $5,
        updated_at = NOW()
      WHERE product_line_id = $6
      RETURNING *
      `,
      [code, name, manufacturer, protocol, description, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Product line not found" });
    }

    res.json({
      message: "Product line updated successfully",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("updateProductLine error:", err);
    res.status(500).json({ error: "Failed to update product line" });
  }
};
exports.deleteProductLine = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      "DELETE FROM product_lines WHERE product_line_id = $1",
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Product line not found" });
    }

    res.json({ message: "Product line deleted successfully" });
  } catch (err) {
    console.error("deleteProductLine error:", err);
    res.status(500).json({ error: "Failed to delete product line" });
  }
};
exports.addModbusAddress = async (req, res) => {
  const { productLineId } = req.params;
  const { device_type_measurement_id, modbus_address } = req.body;

  try {
    const { rows } = await pool.query(`
      INSERT INTO product_lines_modbus
        (product_line_id, device_type_measurement_id, modbus_address, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      RETURNING *
    `, [productLineId, device_type_measurement_id, modbus_address]);

    res.json(rows[0]);
  } catch (err) {
    console.error("[ADD MODBUS] error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
// PUT update modbus address
exports.updateModbusAddress = async (req, res) => {
  const { modbusId } = req.params;
  const { modbus_address } = req.body;

  try {
    const { rows } = await pool.query(`
      UPDATE product_lines_modbus
      SET modbus_address = $1
      WHERE product_line_modbus_id = $2
      RETURNING *
    `, [modbus_address, modbusId]);

    res.json(rows[0]);
  } catch (err) {
    console.error("[UPDATE MODBUS] error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
// DELETE modbus
exports.deleteModbusAddress = async (req, res) => {
  const { modbusId } = req.params;

  try {
    await pool.query(`
      DELETE FROM product_lines_modbus
      WHERE product_line_modbus_id = $1
    `, [modbusId]);

    res.json({ message: "Deleted" });
  } catch (err) {
    console.error("[DELETE MODBUS] error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
exports.getMeasurementsWithModbus = async (req, res) => {
  const { productLineId } = req.params;


  try {
    // 1️⃣ Kiểm tra product_lines_modbus cho product_line này
    const { rows: plmRows } = await pool.query(
      `SELECT * FROM product_lines_modbus WHERE product_line_id = $1`,
      [productLineId]
    );
    
    // 2️⃣ Join với device_types_measurements
    const { rows: dtmRows } = await pool.query(
      `
      SELECT dtm.*
      FROM product_lines_modbus plm
      JOIN device_types_measurements dtm
        ON dtm.id = plm.device_type_measurement_id
      WHERE plm.product_line_id = $1
      `,
      [productLineId]
    );

    // 3️⃣ Join với measurements
    const { rows } = await pool.query(
      `
      SELECT 
        plm.product_line_modbus_id,
        m.measurement_id,
        m.code AS measurement_code,
        m.name AS measurement_name,
        m.unit AS measurement_unit,
        plm.modbus_address
      FROM product_lines_modbus plm
      JOIN device_types_measurements dtm 
        ON dtm.id = plm.device_type_measurement_id
      JOIN measurements m 
        ON m.measurement_id = dtm.measurement_id
      WHERE plm.product_line_id = $1
      ORDER BY m.name
      `,
      [productLineId]
    );

    res.json(rows);
  } catch (err) {
    console.error("[PRODUCT LINE MEASUREMENTS] GET error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
exports.runLiveScan = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { start, end } = req.body;

    if (start === undefined || end === undefined) {
      return res.status(400).json({ message: "Missing start or end" });
    }

    const data = await readDeviceRawRange(
      deviceId,
      Number(start),
      Number(end)
    );

    res.json({
      device_id: deviceId,
      start,
      end,
      total: data.length,
      data
    });
  } catch (err) {
    console.error("LIVE SCAN ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};
