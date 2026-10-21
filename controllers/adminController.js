const multer = require('multer');
const { diskStorage } = require('multer');
const { extname } = require('path');
const { existsSync, mkdirSync } = require('fs');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const path = require("path");
const {sendAdminAccountCreatedEmail}= require("../services/mailadminService")
const { generateRandomPassword } = require("../services/password");
const {scanRegistersAndSave} = require('../modbusReader')
const modbusCache = require("../modbus/modbusCache");
// ---------- Database ----------
console.log("DB_HOST:", process.env.DB_HOST);
console.log("DB_USER:", process.env.DB_USER);
console.log("DB_PASSWORD:", process.env.DB_PASSWORD);
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

exports.loginAdmin = async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query(
      `SELECT admin_id, name, email, password, role, image_url
       FROM admins
       WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Email không tồn tại" });
    }

    const admin = result.rows[0];

    // ✅ SO SÁNH ĐÚNG
    const isMatch = await bcrypt.compare(password, admin.password);

    if (!isMatch) {
      return res.status(401).json({ error: "Mật khẩu không chính xác" });
    }

    const token = jwt.sign(
      {
        admin_id: admin.admin_id,
        email: admin.email,
        role: admin.role,
      },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "7d" }
    );

    res.json({
      message: "Đăng nhập thành công",
      admin: {
        admin_id: admin.admin_id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        image_url: admin.image_url,
      },
      token,
    });
  } catch (err) {
    console.error("Lỗi khi đăng nhập admin:", err);
    res.status(500).json({ error: "Lỗi server" });
  }
};
exports.getAllAdmins = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        admin_id,
        name,
        email,
        role,
        image_url,
        created_at,
        updated_at
      FROM admins
      ORDER BY created_at DESC
    `);

    res.json({ data: result.rows });
  } catch (err) {
    console.error("getAllAdmins error:", err);
    res.status(500).json({ error: "Failed to fetch accounts" });
  }
};
exports.createAdmin = async (req, res) => {
  const { name, email, role, image_url } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required" });
  }

  if (!["admin", "manager"].includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }

  try {
    // 1️⃣ Generate password random
    const plainPassword = generateRandomPassword(8);

    // 2️⃣ Hash password
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    // 3️⃣ Insert DB
    const result = await pool.query(
      `
      INSERT INTO admins (
        admin_id,
        name,
        email,
        password,
        role,
        image_url
      )
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
      RETURNING admin_id, name, email, role, image_url, created_at
      `,
      [name, email, hashedPassword, role, image_url || null]
    );

    // 4️⃣ Send email cấp tài khoản ADMIN
    try {
      await sendAdminAccountCreatedEmail({
        to: email,
        password: plainPassword,
        role: role.toUpperCase(),
      });
    } catch (mailErr) {
      console.error("❌ Send admin email failed:", mailErr);
    }

    res.status(201).json({
      data: result.rows[0],
    });
  } catch (err) {
    console.error("createAdmin error:", err);
    res.status(500).json({ error: "Failed to create admin account" });
  }
};

exports.updateAdmin = async (req, res) => {
  const { adminId } = req.params;
  const { name, role, image_url } = req.body;

  try {
    const result = await pool.query(
      `
      UPDATE admins
      SET
        name = $1,
        role = $2,
        image_url = $3,
        updated_at = NOW()
      WHERE admin_id = $4
      RETURNING admin_id, name, email, role, image_url
      `,
      [name, role, image_url, adminId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Account not found" });
    }

    res.json({ data: result.rows[0] });
  } catch (err) {
    console.error("updateAdmin error:", err);
    res.status(500).json({ error: "Failed to update account" });
  }
};
exports.deleteAdmin = async (req, res) => {
  const { adminId } = req.params;

  if (!adminId) {
    return res.status(400).json({ error: "adminId is required" });
  }

  try {
    const result = await pool.query(
      `
      DELETE FROM admins
      WHERE admin_id = $1
      RETURNING admin_id, name, email, role
      `,
      [adminId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Admin not found" });
    }

    res.status(200).json({
      message: "Admin deleted successfully",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("deleteAdmin error:", err);
    res.status(500).json({ error: "Failed to delete admin" });
  }
};

exports.updateAdminPassword = async (req, res) => {
  const { adminId } = req.params;
  const { password } = req.body;

  try {
    const hashed = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `
      UPDATE admins
      SET password = $1, updated_at = NOW()
      WHERE admin_id = $2
      `,
      [hashed, adminId]
    );

    res.json({ message: "Password updated" });
  } catch (err) {
    console.error("updateAdminPassword error:", err);
    res.status(500).json({ error: "Failed to update password" });
  }
};
exports.getDashboardSummary = async (req, res) => {
  try {
    const result = await pool.query(`
      WITH latest_status AS (
        SELECT DISTINCT ON (device_id)
          device_id,
          status
        FROM device_status
        ORDER BY device_id, created_at DESC
      )
      SELECT
        COUNT(d.device_id) AS total_devices,

        COUNT(d.device_id)
          FILTER (WHERE ls.status = 1) AS connected,

        COUNT(d.device_id)
          FILTER (WHERE ls.status = 0 OR ls.status IS NULL) AS disconnected,

        (SELECT COUNT(*) FROM customers) AS total_customers
      FROM devices d
      LEFT JOIN latest_status ls
        ON ls.device_id = d.device_id;
    `);

    res.json(result.rows[0]);
  } catch (err) {
    console.error("getDashboardSummary error:", err);
    res.status(500).json({ error: "Failed to load dashboard stats" });
  }
};
exports.getRecentAlarms = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        al.id,
        al.description,
        al.severity,
        al.triggered_at,
        d.name AS device_name
      FROM alarm_logs al
      LEFT JOIN devices d ON d.device_id = al.device_id
        WHERE al.category = 1
      ORDER BY al.triggered_at DESC
      LIMIT 5
    `);

    return res.json(result.rows);
  } catch (err) {
    console.error("getRecentAlarms error:", err);
    return res.status(500).json({ error: "Failed to load alarms" });
  }
};
exports.getMeasurements = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        measurement_id,
        code,
        name,
        unit,
        value_type,
        description,
        parent_id,
        created_at,
        updated_at
      FROM measurements
      ORDER BY parent_id NULLS FIRST, name ASC
    `);
    // build tree (parent → children)
    const map = {};
    const roots = [];
    rows.forEach((m) => {
      map[m.measurement_id] = { ...m, children: [] };
    });
    rows.forEach((m) => {
      if (m.parent_id) {
        map[m.parent_id]?.children.push(map[m.measurement_id]);
      } else {
        roots.push(map[m.measurement_id]);
      }
    });
    res.json({
      measurements: roots,
      flat: rows, 
    });
  } catch (err) {
    console.error("[MEASUREMENTS] GET error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
exports.createMeasurement = async (req, res) => {
  const {
    code,
    name,
    unit,
    value_type,
    description,
    parent_id,
  } = req.body;

  if (!code || !name) {
    return res.status(400).json({
      message: "code and name are required",
    });
  }

  try {
    // check unique code
    const exists = await pool.query(
      "SELECT 1 FROM measurements WHERE code = $1",
      [code]
    );
    if (exists.rowCount > 0) {
      return res.status(409).json({
        field: "code",
        message: "Measurement code already exists",
      });
    }

    // check parent exists (if provided)
    if (parent_id) {
      const parent = await pool.query(
        "SELECT 1 FROM measurements WHERE measurement_id = $1",
        [parent_id]
      );
      if (parent.rowCount === 0) {
        return res.status(400).json({
          message: "Parent measurement not found",
        });
      }
    }

    const { rows } = await pool.query(
      `
      INSERT INTO measurements (
        code,
        name,
        unit,
        value_type,
        description,
        parent_id
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [
        code,
        name,
        unit || null,
        value_type || "instant",
        description || null,
        parent_id || null,
      ]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("[MEASUREMENTS] POST error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
exports.updateMeasurement = async (req, res) => {
  const { id } = req.params;
  const {
    code,
    name,
    unit,
    description,
    parent_id,
  } = req.body;

  if (!id)
    return res.status(400).json({ message: "Measurement ID is required" });

  if (!code || !name)
    return res.status(400).json({ message: "Code and name are required" });

  if (parent_id && parent_id === id)
    return res
      .status(400)
      .json({ message: "Measurement cannot be its own parent" });

  try {
    const { rowCount } = await pool.query(
      `
      UPDATE measurements
      SET
        code = $1,
        name = $2,
        unit = $3,
        description = $4,
        parent_id = $5,
        updated_at = now()
      WHERE measurement_id = $6
      `,
      [
        code,
        name,
        unit || null,
        description || null,
        parent_id || null,
        id,
      ]
    );

    if (rowCount === 0)
      return res.status(404).json({ message: "Measurement not found" });

    res.json({ message: "Measurement updated successfully" });
  } catch (err) {
    console.error("[MEASUREMENT] Update error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
exports.deleteMeasurement = async (req, res) => {
  const { id } = req.params;

  if (!id)
    return res.status(400).json({ message: "Measurement ID is required" });

  try {
    // 1️⃣ Có child không?
    const childCheck = await pool.query(
      `SELECT 1 FROM measurements WHERE parent_id = $1 LIMIT 1`,
      [id]
    );
    if (childCheck.rowCount > 0)
      return res.status(409).json({
        message: "Cannot delete measurement with child measurements",
      });

    // 2️⃣ Có dùng trong device_types_measurements không?
    const dtmCheck = await pool.query(
      `SELECT 1 FROM device_types_measurements WHERE measurement_id = $1 LIMIT 1`,
      [id]
    );
    if (dtmCheck.rowCount > 0)
      return res.status(409).json({
        message: "Measurement is used in device type configuration",
      });

    // 3️⃣ Có log chưa?
    const logCheck = await pool.query(
      `SELECT 1 FROM device_logs WHERE measurement_id = $1 LIMIT 1`,
      [id]
    );
    if (logCheck.rowCount > 0)
      return res.status(409).json({
        message: "Measurement already has data logs",
      });

    // 4️⃣ Xóa
    const { rowCount } = await pool.query(
      `DELETE FROM measurements WHERE measurement_id = $1`,
      [id]
    );

    if (rowCount === 0)
      return res.status(404).json({ message: "Measurement not found" });

    res.json({ message: "Measurement deleted successfully" });
  } catch (err) {
    console.error("[MEASUREMENT] Delete error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
exports.getMeasurementsTree = async (req, res) => {
  const { deviceId } = req.params;

  if (!deviceId) {
    return res.status(400).json({ message: "Device ID required" });
  }

  try {
   

    // =====================================================
    // 1) LẤY CACHE REALTIME
    // =====================================================
    const modbusValues = modbusCache.get(deviceId) || {};

    

    console.log(
      "🧠 Cache measurement IDs:",
      Object.keys(modbusValues)
    );

    /* ================= PARENTS ================= */

    const parentsRes = await pool.query(
      `
      SELECT 
        m.measurement_id,
        m.name,
        m.unit
      FROM measurements m
      JOIN device_types_measurements dtm 
        ON dtm.measurement_id = m.measurement_id
      JOIN devices d 
        ON d.device_type_id = dtm.device_type_id
      WHERE d.device_id = $1
        AND m.parent_id IS NULL
      ORDER BY m.name
      `,
      [deviceId]
    );

    console.log("📂 Parents from DB:", parentsRes.rows.length);
    console.log(parentsRes.rows);

    /* ================= CHILDREN ================= */

    const childrenRes = await pool.query(
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
        AND m.parent_id IS NOT NULL
      `,
      [deviceId]
    );

    console.log("📂 Children from DB:", childrenRes.rows.length);
    console.log(childrenRes.rows);

    /* ================= BUILD TREE ================= */

    const map = {};

    parentsRes.rows.forEach((p) => {
      const cacheValue = modbusValues[p.measurement_id];

      console.log(
        `🌳 Parent ${p.name} | measurement_id=${p.measurement_id} | cache=`,
        cacheValue
      );

      map[p.measurement_id] = {
        id: p.measurement_id,
        name: p.name,
        unit: p.unit,

        value: cacheValue?.value ?? "-",
        lastUpdate: cacheValue?.timestamp ?? null,

        children: [],
      };
    });

    childrenRes.rows.forEach((c) => {
      const cacheValue = modbusValues[c.measurement_id];

      console.log(
        `   └─ Child ${c.name} | measurement_id=${c.measurement_id} | parent_id=${c.parent_id} | cache=`,
        cacheValue
      );

      if (map[c.parent_id]) {
        map[c.parent_id].children.push({
          id: c.measurement_id,
          name: c.name,
          unit: c.unit,

          value: cacheValue?.value ?? "-",
          lastUpdate: cacheValue?.timestamp ?? null,
        });
      } else {
        console.log(
          `⚠️ Child ${c.name} has parent_id=${c.parent_id} but parent not found in map`
        );
      }
    });

    const tree = Object.values(map);

    console.log("📤 FINAL TREE RESPONSE:");
    console.dir(tree, { depth: null });

    console.log("================ END MEASUREMENTS TREE ================\n");

    return res.json({ measurements: tree });
  } catch (err) {
    console.error("❌ MEASUREMENTS TREE ERROR:", err.stack);
    return res.status(500).json({ message: "Server error" });
  }
};
exports.exportCustomReport = async (req, res) => {
  try {
    // Tái sử dụng API báo cáo hiện tại để bảo đảm
    // dữ liệu xuất Excel giống dữ liệu Dashboard.
    let statusCode = 200;
    let reportResult = null;

    const mockRes = {
      status(code) {
        statusCode = code;
        return this;
      },

      json(data) {
        reportResult = data;
        return this;
      },
    };

    await exports.getCustomReport(req, mockRes);

    if (statusCode !== 200 || !reportResult?.success) {
      return res.status(statusCode).json(
        reportResult || { error: "Cannot generate report" }
      );
    }

    const rows = reportResult.data || [];

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Onergy";
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet("Custom Report");

    worksheet.columns = [
      { header: "Thời gian", key: "label", width: 22 },
      { header: "Điện năng Peak", key: "peak", width: 18 },
      { header: "Điện năng Normal", key: "normal", width: 18 },
      { header: "Điện năng Off-peak", key: "offpeak", width: 20 },
      { header: "Đơn giá Peak", key: "peakPrice", width: 16 },
      { header: "Đơn giá Normal", key: "normalPrice", width: 18 },
      { header: "Đơn giá Off-peak", key: "offPeakPrice", width: 20 },
      { header: "Chi phí Peak", key: "peakCost", width: 18 },
      { header: "Chi phí Normal", key: "normalCost", width: 20 },
      { header: "Chi phí Off-peak", key: "offPeakCost", width: 20 },
      { header: "Tổng chi phí", key: "totalCost", width: 20 },
    ];

    worksheet.addRows(
      rows.map((item) => ({
        label: item.label,
        peak: Number(item.peak) || 0,
        normal: Number(item.normal) || 0,
        offpeak: Number(item.offpeak) || 0,
        peakPrice: Number(item.peakPrice) || 0,
        normalPrice: Number(item.normalPrice) || 0,
        offPeakPrice: Number(item.offPeakPrice) || 0,
        peakCost: Number(item.peakCost) || 0,
        normalCost: Number(item.normalCost) || 0,
        offPeakCost: Number(item.offPeakCost) || 0,
        totalCost: Number(item.totalCost) || 0,
      }))
    );

    // Định dạng tiêu đề
    const header = worksheet.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF047857" },
    };
    header.alignment = {
      vertical: "middle",
      horizontal: "center",
    };
    header.height = 28;

    // Định dạng số
    for (let row = 2; row <= worksheet.rowCount; row++) {
      for (const col of [2, 3, 4]) {
        worksheet.getCell(row, col).numFmt = "#,##0.00";
      }

      for (const col of [5, 6, 7, 8, 9, 10, 11]) {
        worksheet.getCell(row, col).numFmt = '#,##0.00';
      }
    }

    worksheet.views = [{ state: "frozen", ySplit: 1 }];
    worksheet.autoFilter = {
      from: "A1",
      to: "K1",
    };

    const buffer = await workbook.xlsx.writeBuffer();

    const filename = `custom-report-${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );

    return res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("exportCustomReport error:", err);

    return res.status(500).json({
      error: "Failed to export custom report",
    });
  }
};