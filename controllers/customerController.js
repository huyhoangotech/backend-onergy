// controllers/customerController.js
const multer = require('multer');
const { diskStorage } = require('multer');
const { extname } = require('path');
const path = require("path");   
const { existsSync, mkdirSync } = require('fs');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { fork } = require("child_process");
const {scanRegisters} = require('../modbusReader')
const modbusCache = require("../modbus/modbusCache");
const {foo} = require('../foo')
const bcrypt = require('bcrypt');

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

// ---------- API Login Customer ----------
exports.loginCustomer = async (req, res) => {
  const { email, password } = req.body;

  console.log("=== LOGIN REQUEST ===");
  console.log("EMAIL FROM CLIENT:", email);
  console.log("PASSWORD FROM CLIENT:", password);

  try {
    const result = await pool.query(
      `
      SELECT 
        user_id, 
        name, 
        email, 
        password,
        is_first_login
      FROM users 
      WHERE email = $1
      `,
      [email]
    );

    console.log("DB RESULT:", result.rows);

    if (result.rows.length === 0) {
      console.log("❌ EMAIL NOT FOUND");
      return res.status(401).json({ error: "Email không tồn tại" });
    }

    const user = result.rows[0];

    console.log("USER FROM DB:", user.email);
    console.log("HASHED PASSWORD:", user.password);

    // ✅ SO SÁNH BCRYPT
    const isMatch = await bcrypt.compare(password, user.password);

    console.log("PASSWORD MATCH:", isMatch);

    if (!isMatch) {
      console.log("❌ PASSWORD WRONG");
      return res.status(401).json({ error: "Mật khẩu không chính xác" });
    }

    // ✅ TẠO TOKEN
    const token = jwt.sign(
      {
        user_id: user.user_id,
        email: user.email,
      },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "7d" }
    );

    console.log("✅ LOGIN SUCCESS");

    res.status(200).json({
      message: "Đăng nhập thành công",
      token,
      user: {
        user_id: user.user_id,
        name: user.name,
        email: user.email,
        is_first_login: user.is_first_login,
      },
    });
  } catch (err) {
    console.error("🔥 SERVER ERROR:", err);
    res.status(500).json({ error: "Lỗi server khi đăng nhập" });
  }
};

exports.getDevicesBySite = async (req, res) => {
  const { siteId } = req.params;
  console.log('--- GET /sites/:siteId/devices called ---');
  console.log('siteId:', siteId);

  try {
    const query = `
      SELECT
        d.id as device_id,
        d.name,
        dt.type_name AS type,
        s.site_name AS site_name,
        d.status,
        d.uptime,
        d.last_activity AS lastActivity,
        d.alerts,
        d.device_type_id,
        d.site_id
      FROM devices d
      LEFT JOIN device_types dt ON d.device_type_id = dt.id
      LEFT JOIN sites s ON d.site_id = s.id
      WHERE d.site_id = $1
      ORDER BY d.id ASC;
    `;

    const { rows } = await pool.query(query, [siteId]);

    console.log(`Found ${rows.length} devices for site ${siteId}`);

    // Nếu bạn muốn map lại field id thành string hoặc khác, xử lý ở đây
    const devices = rows.map((r) => ({
      id: r.device_id,
      name: r.name,
      type: r.type || null,
      location: r.site_name || null, // location lấy từ sites.site_name
      status: r.status,
      uptime: r.uptime,
      lastActivity: r.lastactivity || r.lastActivity || null,
      alerts: r.alerts,
      device_type_id: r.device_type_id,
      site_id: r.site_id,
    }));

    res.status(200).json({
      success: true,
      count: devices.length,
      devices
    });
  } catch (err) {
    console.error('Error fetching devices by site:', err);
    res.status(500).json({ success: false, message: 'Server error when fetching devices' });
  }
};

exports.getAllDevicesTree = async (req, res) => {
  const user_id = req.user?.user_id;

  if (!user_id) {
    return res.status(403).json({ message: "User not authorized" });
  }

  try {
    const { rows: devices } = await pool.query(
      `
      WITH RECURSIVE site_tree AS (
        SELECT 
          s.site_id,
          s.name,
          s.parent_id,
          s.type,
          s.name::text AS path,
          s.site_id AS root_site_id
        FROM sites s
        JOIN users_sites us ON us.site_id = s.site_id
        WHERE us.user_id = $1

        UNION ALL

        SELECT 
          s.site_id,
          s.name,
          s.parent_id,
          s.type,
          st.path || ' > ' || s.name,
          st.root_site_id
        FROM sites s
        INNER JOIN site_tree st ON s.parent_id = st.site_id
      )

      SELECT 
        d.device_id,
        d.name,
        dt.name AS type,
        st.path,
        st.root_site_id,
        st.type AS node_type,
        COALESCE(ds.status, 0) AS status,
        d.device_type_id,
        d.site_id

      FROM devices d

      JOIN site_tree st ON d.site_id = st.site_id

      LEFT JOIN LATERAL (
        SELECT status
        FROM device_status
        WHERE device_id = d.device_id
        ORDER BY created_at DESC
        LIMIT 1
      ) ds ON TRUE

      LEFT JOIN device_types dt 
        ON d.device_type_id = dt.id

      ORDER BY d.device_id ASC;
      `,
      [user_id]
    );

    const mappedDevices = devices.map(d => ({
      id: d.device_id,
      name: d.name,
      type: d.type,

      path: d.path,
      site_id: d.root_site_id,
      node_type: d.node_type,

      status: d.status === 1 ? "connected" : "disconnected",

      uptime: null,
      lastActivity: null,
      alerts: null,
    }));

    res.json({ devices: mappedDevices });

  } catch (err) {
    console.error("[DEVICES TREE] Error:", err.stack);
    res.status(500).json({ message: "Server error" });
  }
};

const getUserIdFromToken = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    return decoded.user_id;
  } catch (err) {
    console.error('Invalid token', err);
    return null;
  }
};

// API lấy tất cả site của user
exports.getSitesByUser = async (req, res) => {
  const userId = req.user?.user_id;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized",
    });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT
        s.site_id AS id,
        s.name,
        s.address,
        COUNT(d.device_id) AS devices
      FROM sites s
      INNER JOIN users_sites us 
        ON us.site_id = s.site_id
      LEFT JOIN devices d 
        ON d.site_id = s.site_id
      WHERE us.user_id = $1
      GROUP BY s.site_id
      ORDER BY s.name ASC
      `,
      [userId]
    );

    res.json({
      success: true,
      sites: rows,
    });
  } catch (err) {
    console.error("getSitesByUser error:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// customerController.js

// Lấy tất cả devices mà user có quyền truy cập
// controllers/customerController.js

exports.getAllDevices = async (req, res) => {
  const user_id = req.user?.user_id;
  console.log("[DEVICES] Fetching devices for user_id:", user_id);

  if (!user_id) return res.status(403).json({ message: "User not authorized" });

  try {
    // 🔹 Lấy site của user
    const { rows: siteRows } = await pool.query(
      'SELECT site_id FROM "users_sites" WHERE user_id = $1',
      [user_id]
    );

    const siteIds = siteRows.map(r => r.site_id);
    if (siteIds.length === 0) {
      return res.json({ devices: [] });
    }

    // 🔹 Query devices + realtime status
    const { rows: devices } = await pool.query(
      `
      SELECT 
        d.device_id,
        d.name,
        dt.name AS type,
        s.name AS site_name,

        -- 🔥 status realtime
        COALESCE(ds.status, 0) AS status,

        d.description,
        d.created_at,
        d.updated_at,
        d.device_type_id,
        d.site_id

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
        ON d.device_type_id = dt.id

      LEFT JOIN sites s 
        ON d.site_id = s.site_id

      WHERE d.site_id = ANY($1)

      ORDER BY d.device_id ASC
      `,
      [siteIds]
    );

    // 🔹 Map output giữ nguyên cho frontend
    const mappedDevices = devices.map(d => ({
      id: d.device_id,
      name: d.name,
      type: d.type,
      location: d.site_name,

      // map number → string giống getDevices
      status: d.status === 1 ? "connected" : "disconnected",

      uptime: null,        // nếu chưa có thì để null
      lastActivity: null,
      alerts: null,
    }));

    res.json({ devices: mappedDevices });
  } catch (err) {
    console.error("[DEVICES] Error fetching devices:", err.stack);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getRecentAlerts = async (req, res) => {
 
  const user_id = req.user?.user_id;
 

  const limit = Number(req.query.limit) || 20;

  if (!user_id) {
    return res.status(403).json({ message: "Unauthorized" });
  }

  try {
    // Lấy danh sách site
    const { rows: siteRows } = await pool.query(
      'SELECT site_id FROM "users_sites" WHERE user_id = $1',
      [user_id]
    );
   
    const siteIds = siteRows.map(r => r.site_id);

    if (siteIds.length === 0) return res.json([]);

    // Lấy device thuộc site
    const { rows: devices } = await pool.query(
      'SELECT device_id, name, device_type_id FROM devices WHERE site_id = ANY($1)',
      [siteIds]
    );
   
    const deviceIds = devices.map(d => d.device_id);

    if (deviceIds.length === 0) return res.json([]);

    // Lấy recent alerts + device_type
    const { rows: alertsRows } = await pool.query(
      `
      SELECT al.id AS id,
             al.device_id,
             al.event_type,
             al.severity,
             al.triggered_at,
             al.value,
             d.name AS device_name,
             dt.name AS device_type_name,
             s.name AS site_name
      FROM alarm_logs al
      LEFT JOIN devices d       ON d.device_id = al.device_id
      LEFT JOIN device_types dt ON dt.id = d.device_type_id
      LEFT JOIN sites s         ON s.site_id = d.site_id
      WHERE al.device_id = ANY($1)
      ORDER BY al.triggered_at DESC
      LIMIT $2
      `,
      [deviceIds, limit]
    );

  
    // Trả về JSON đúng chuẩn
    const formatted = alertsRows.map((row) => {
      return {
        id: row.id,
        device: row.device_name,
        device_type: row.device_type_name,
        event_type: row.event_type,
        site: row.site_name,
        severity: row.severity,
        timestamp: row.triggered_at,
        value: row.value
      };
    });

  
    res.json(formatted);

  } catch (err) {
    console.error("[ALERTS] Error fetching recent alerts:", err.stack || err);
    res.status(500).json({ message: "Server error" });
  }
};

// customerController.ts
exports.getParentMeasurements = async (req, res) => {

  const user_id = req.user?.user_id;
  const { deviceId } = req.params;

  if (!user_id) return res.status(403).json({ message: "Unauthorized" });
  if (!deviceId) return res.status(400).json({ message: "Device ID required" });

  try {

    const modbusValues = modbusCache.get(deviceId) || {};

    // 🔥 DEBUG cache
   

    // 🔥 normalize cache key (fix mismatch UUID)
    const normalizedCache = {};
    for (const key in modbusValues) {
      normalizedCache[key.toLowerCase()] = modbusValues[key];
    }

    scanRegisters(deviceId).catch(err =>
      console.error("Live scan error:", err)
    );

    const { rows: parentRows } = await pool.query(`
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
      ORDER BY m.name ASC
    `, [deviceId]);

    const measurements = await Promise.all(parentRows.map(async parent => {

      const parentId = parent.measurement_id.toLowerCase();

      // 🔥 tìm key match (case-insensitive)
      const foundKey = Object.keys(normalizedCache).find(
        k => k === parentId
      );

      const cached = foundKey ? normalizedCache[foundKey] : undefined;

      // 🔥 DEBUG cực rõ
    
      // ✅ nếu có cache → dùng luôn (kể cả value = 0)
      if (cached !== undefined) {
        return {
          id: parent.measurement_id,
          name: parent.name,
          unit: parent.unit,
          value: cached.value,
          lastUpdate: cached.timestamp ?? null,
        };
      }

      // 🔥 fallback average
      const { rows: childRows } = await pool.query(`
        SELECT measurement_id
        FROM measurements
        WHERE parent_id = $1
      `, [parent.measurement_id]);

      const childValues = childRows
        .map(c => {
          const key = c.measurement_id.toLowerCase();
          return normalizedCache[key]?.value;
        })
        .filter(v => v !== undefined && v !== null);



      const avgValue = childValues.length > 0
        ? childValues.reduce((a, b) => a + b, 0) / childValues.length
        : null;

      return {
        id: parent.measurement_id,
        name: parent.name,
        unit: parent.unit,
        value: avgValue,
        lastUpdate: null,
      };

    }));

    res.json({ measurements });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getDeviceMeasurements = async (req, res) => {
  const user_id = req.user?.user_id;
  const { deviceId, parentId } = req.params;

  if (!user_id)
    return res.status(403).json({ message: "User not authorized" });

  if (!deviceId)
    return res.status(400).json({ message: "Device ID is required" });

  try {

    // 🔹 lấy cache
    const modbusValues = modbusCache.get(deviceId);

    // 🔹 scan background (không await)
    scanRegisters(deviceId)
      .catch(err => console.error("Live scan error:", err));

    const { rows } = await pool.query(`
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
        AND m.parent_id = $2
      ORDER BY m.name ASC
    `,[deviceId,parentId]);

    const mappedMeasurements = rows.map(m => ({
      id: m.measurement_id,
      name: m.name,
      unit: m.unit,
      parentId: m.parent_id,
      value: modbusValues[m.measurement_id]?.value ?? null,
      lastUpdate: modbusValues[m.measurement_id]?.timestamp ?? null,
    }));

    res.json({ measurements: mappedMeasurements });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};


exports.checkDeviceAlarms = async (req, res) => {
  try {
    const { device_id, measurement_id } = req.body;

    // 1. Lấy log mới nhất
    const latestLogQuery = `
      SELECT *
      FROM device_logs 
      WHERE device_id = $1 AND measurement_id = $2
      ORDER BY created_at DESC 
      LIMIT 1
    `;
    const { rows: deviceLogs } = await pool.query(latestLogQuery, [device_id, measurement_id]);
    if (deviceLogs.length === 0) {
      return res.status(404).json({ message: "Không có dữ liệu device_logs" });
    }
    const latest = deviceLogs[0];

    // 2. Lấy alarm config
    const alarmQuery = `
      SELECT *
      FROM alarms
      WHERE device_id = $1 AND measurement_id = $2
      LIMIT 1
    `;
    const { rows: alarmRows } = await pool.query(alarmQuery, [device_id, measurement_id]);
    if (alarmRows.length === 0) {
      return res.status(200).json({ message: "Thiết bị không có cấu hình alarm" });
    }
    const alarm = alarmRows[0];

    // 3. Kiểm tra vượt ngưỡng
    const value = Number(latest.value);
    const HIGH = Number(alarm.threshold_high);
    const LOW = Number(alarm.threshold_low);
    let status = null;

    if (HIGH && value > HIGH) status = "HIGH";
    if (LOW && value < LOW) status = "LOW";

    if (!status) {
      return res.status(200).json({ message: "Không vượt ngưỡng" });
    }

    // 4. Không tạo log trùng: kiểm tra log cuối cùng
    const lastAlarmQuery = `
      SELECT *
      FROM alarm_logs
      WHERE device_id = $1 AND measurement_id = $2
      ORDER BY triggered_at DESC
      LIMIT 1
    `;
    const { rows: last } = await pool.query(lastAlarmQuery, [device_id, measurement_id]);

    if (last.length > 0) {
      const prev = last[0];
      if (prev.status === status && prev.resolved === false) {
        return res.status(200).json({ message: "Đã có alarm đang active, không tạo mới" });
      }
    }

    // 5. Tạo alarm_logs mới (TRÙNG GIÁ TRỊ device_logs)
    const insertQuery = `
      INSERT INTO alarm_logs (
        alarm_id,
        device_id,
        measurement_id,
        value,
        triggered_at,
        resolved,
        status,
        description,
        start_value,
        site_id,
        device_type_id,
        event_type,
        severity
      ) VALUES ($1,$2,$3,$4,NOW(),false,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `;

    const description = status === "HIGH"
      ? `Value ${value} exceeded HIGH threshold ${HIGH}`
      : `Value ${value} dropped below LOW threshold ${LOW}`;

    const params = [
      alarm.id,
      device_id,
      measurement_id,
      value,
      status,
      description,
      value,
      null,   // site_id (bạn tự bổ sung)
      null,   // device_type_id
      "threshold_event",
      status === "HIGH" ? "critical" : "warning"
    ];

    const { rows: created } = await pool.query(insertQuery, params);

    return res.status(201).json({
      message: "Alarm triggered",
      alarm_log: created[0],
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error", error: err });
  }
};

// GET /alarms/logs
exports.getAlarmLogs = async (req, res) => {
  const user_id = req.user?.user_id;

  if (!user_id) {
    return res.status(403).json({ message: "Unauthorized" });
  }

  try {
    // 1️⃣ Lấy site user được gán
    const { rows: siteRows } = await pool.query(
      `SELECT site_id FROM users_sites WHERE user_id = $1`,
      [user_id]
    );

    const siteIds = siteRows.map(r => r.site_id);

    if (siteIds.length === 0) {
      return res.json({
        message: "No sites assigned",
        logs: [],
      });
    }

    // 2️⃣ Lấy device thuộc các site đó
    const { rows: deviceRows } = await pool.query(
      `
      SELECT device_id
      FROM devices
      WHERE site_id = ANY($1)
      `,
      [siteIds]
    );

    const deviceIds = deviceRows.map(d => d.device_id);

    if (deviceIds.length === 0) {
      return res.json({
        message: "No devices found",
        logs: [],
      });
    }

    // 3️⃣ Lấy alarm logs của các device đó
    const query = `
      SELECT 
        al.id,
        al.device_id,
        d.name AS device_name,
        dt.name AS device_type_name,
        al.measurement_id,
        m.name AS measurement_name,
        m.unit AS measurement_unit,
        al.value,
        al.status,
        al.severity,
        al.category, 
        al.description,
        al.triggered_at,
        al.resolved,
        al.resolved_by,
        al.resolved_at,
        al.start_value,
        al.end_value,
        al.duration,
        al.event_type,
        s.name AS site_name
      FROM alarm_logs al
      LEFT JOIN devices d       ON al.device_id = d.device_id
      LEFT JOIN device_types dt ON d.device_type_id = dt.id
      LEFT JOIN measurements m ON al.measurement_id = m.measurement_id
      LEFT JOIN sites s        ON s.site_id = d.site_id
      WHERE al.device_id = ANY($1)
      ORDER BY al.triggered_at DESC
      LIMIT 200
    `;

    const { rows } = await pool.query(query, [deviceIds]);

    return res.status(200).json({
      message: "Alarm logs fetched",
      logs: rows,
    });

  } catch (err) {
    console.error("GET ALARM LOGS ERROR:", err.stack || err);
    return res.status(500).json({
      message: "Server error",
    });
  }
};


exports.getDeviceAlarmLogs = async (req, res) => {
  const user_id = req.user?.user_id


  if (!user_id) {
    
    return res.status(403).json({ message: "Unauthorized" })
  }

  const { deviceId } = req.params
  const { limit = 20, cursor_time, cursor_id } = req.query

  

  if (!deviceId) {
   
    return res.status(400).json({ message: "deviceId is required" })
  }

  const safeLimit = Math.min(Number(limit), 50)

  try {
    /* ===============================
       1️⃣ VERIFY DEVICE THUỘC USER
    =============================== */
   
    const verifyQuery = `
      SELECT
        d.device_id,
        d.site_id,
        us.user_id
      FROM devices d
      LEFT JOIN users_sites us ON us.site_id = d.site_id
      WHERE d.device_id = $1
    `

    const verifyResult = await pool.query(verifyQuery, [deviceId])

    
    const isOwned = verifyResult.rows.some(
      r => r.user_id === user_id
    )

   

    if (!isOwned) {
      console.log("❌ FORBIDDEN DEVICE", {
        deviceId,
        user_id,
      })
      return res.status(403).json({ message: "Forbidden device" })
    }

    /* ===============================
       2️⃣ CURSOR CONDITION
    =============================== */
    const params = [deviceId]
    let cursorCondition = ""

    if (cursor_time && cursor_id) {
      params.push(cursor_time, cursor_id)
      cursorCondition = `
        AND (
          al.triggered_at < $${params.length - 1}
          OR (
            al.triggered_at = $${params.length - 1}
            AND al.id < $${params.length}
          )
        )
      `
    }

    params.push(safeLimit)

    

    /* ===============================
       3️⃣ QUERY ALARMS
    =============================== */
    const query = `
      SELECT
        al.id,
        al.device_id,
        al.event_type,
        al.description,
        al.severity,
        al.category,   
        al.triggered_at,
        al.resolved,
        al.resolved_at
      FROM alarm_logs al
     WHERE al.device_id = $1
AND al.category = 1
${cursorCondition}
      ORDER BY al.triggered_at DESC, al.id DESC
      LIMIT $${params.length}
    `


    const { rows } = await pool.query(query, params)


    return res.json({
      logs: rows,
      hasMore: rows.length === safeLimit,
      nextCursor:
        rows.length > 0
          ? {
              cursor_time: rows[rows.length - 1].triggered_at,
              cursor_id: rows[rows.length - 1].id,
            }
          : null,
    })
  } catch (err) {
    console.error("🔥 GET DEVICE ALARMS ERROR:", err)
    return res.status(500).json({ message: "Server error" })
  }
}

exports.GetAlarmDetail = async (req, res) => {
  const { id } = req.params;
if (!id || id === "undefined") {
  return res.status(400).json({ message: "Invalid alarm id" });
}
  if (!id) {
    return res.status(400).json({ message: "Alarm ID is required" });
  }

  try {
    const query = `
      SELECT 
        al.id,
        al.event_type,
        al.description,
        al.status,
        al.duration,
         al.category,   
        al.triggered_at,

        d.device_id,
        d.name AS device_name,
        d.site_id,

        dt.name AS device_type_name,

        s.name AS site_name

      FROM alarm_logs al
      LEFT JOIN devices d ON al.device_id = d.device_id
      LEFT JOIN device_types dt ON d.device_type_id = dt.id
      LEFT JOIN sites s ON d.site_id = s.site_id   -- DÙNG site_id ĐÚNG NHẤT

      WHERE al.id = $1;
    `;

    const { rows } = await pool.query(query, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ message: "Alarm not found" });
    }

    res.status(200).json({
      message: "Alarm detail fetched",
      log: rows[0],
    });
  } catch (err) {
    console.error("GET ALARM DETAIL ERROR:", err);
    res.status(500).json({
      message: "Server error",
      error: err,
    });
  }
};
exports.getDeviceById = async (req, res) => {
  console.log("📥 [GET /device/:id] Backend nhận request");

  const { id } = req.params;
  console.log("➡️ Đang truy vấn device_id =", id);

  try {
    const query = `
      SELECT 
        d.device_id,
        d.name,
        d.serial_number,
        d.site_id,
        s.name AS site_name,            -- LẤY SITE NAME
        d.ip_address,
        d.status,
        d.description,
        d.created_at,
        d.updated_at,
        d.device_type_id,
        d.model,
        dt.name AS device_type_name     -- LẤY DEVICE TYPE NAME
      FROM devices d
      LEFT JOIN device_types dt 
        ON dt.id = d.device_type_id
      LEFT JOIN sites s 
        ON s.site_id = d.site_id        -- DÙNG site_id CHUẨN
      WHERE d.device_id = $1
    `;

    console.log("📝 SQL:", query.replace(/\s+/g, " "));
    console.log("🔢 Params:", [id]);

    const { rows } = await pool.query(query, [id]);

    if (rows.length === 0) {
      console.log("❌ Không tìm thấy device với ID:", id);
      return res.status(404).json({ message: "Device not found" });
    }

    console.log("✅ Device tìm thấy:", rows[0]);
    return res.status(200).json(rows[0]);

  } catch (error) {
    console.log("🔥 LỖI SQL:", JSON.stringify({
      message: error.message,
      code: error.code,
      position: error.position,
      routine: error.routine,
      detail: error.detail,
      hint: error.hint,
      stack: error.stack
    }, null, 2));

    return res.status(500).json({ message: "Server error", error });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.user_id;

    console.log("========== GET PROFILE START ==========");
    console.log("userId:", userId);

    /* ========= USER + CUSTOMER ========= */
    const userResult = await pool.query(
      `
      SELECT
        u.user_id,
        u.name AS user_name,
        u.email,
        u.phone,
        u.address AS user_address,
        u.image_url,
        c.customer_id,
        c.name AS customer_name
      FROM users u
      JOIN customers c
        ON c.customer_id = u.customer_id
      WHERE u.user_id = $1
      `,
      [userId]
    );

    console.log("userResult rows:", userResult.rows);

    if (!userResult.rows.length) {
      console.warn("⚠️ User not found");
      return res.status(404).json({
        message: "User not found",
      });
    }

    const user = userResult.rows[0];

    console.log("customer_id:", user.customer_id);

    /* ========= ROOT SITES + ALL CHILD DEVICES ========= */
    const sitesResult = await pool.query(
      `
      WITH RECURSIVE site_tree AS (
        -- chỉ lấy site gốc
        SELECT
          s.site_id,
          s.name,
          s.address,
          s.parent_id,
          s.site_id AS root_site_id
        FROM sites s
        WHERE s.customer_id = $1
          AND s.parent_id IS NULL

        UNION ALL

        -- lấy toàn bộ node con
        SELECT
          child.site_id,
          child.name,
          child.address,
          child.parent_id,
          st.root_site_id
        FROM sites child
        INNER JOIN site_tree st
          ON child.parent_id = st.site_id
      )

      SELECT
        root.site_id AS id,
        root.name,
        root.address,
        COUNT(d.device_id) AS devices
      FROM sites root

      LEFT JOIN site_tree st
        ON st.root_site_id = root.site_id

      LEFT JOIN devices d
        ON d.site_id = st.site_id

      WHERE root.customer_id = $1
        AND root.parent_id IS NULL

      GROUP BY
        root.site_id,
        root.name,
        root.address

      ORDER BY root.name ASC
      `,
      [user.customer_id]
    );

    console.log("sitesResult rows:", sitesResult.rows);

    console.log("========== GET PROFILE END ==========");

    return res.json({
      user: {
        id: user.user_id,
        name: user.user_name,
        email: user.email,
        phone: user.phone,
        address: user.user_address,
        avatar: user.image_url,
      },
      customer: {
        id: user.customer_id,
        name: user.customer_name,
      },
      sites: sitesResult.rows,
    });
  } catch (err) {
    console.error("❌ getProfile error:", err.stack);

    return res.status(500).json({
      message: "Server error",
    });
  }
};
exports.changePassword = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { currentPassword, newPassword } = req.body;

    // 1️⃣ Validate input
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Thiếu mật khẩu" });
    }

    if (newPassword.length < 8) {
      return res
        .status(400)
        .json({ message: "Mật khẩu mới phải ít nhất 8 ký tự" });
    }

    // 2️⃣ Lấy password hiện tại
    const result = await pool.query(
      `
      SELECT password 
      FROM users 
      WHERE user_id = $1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = result.rows[0];

    // 3️⃣ So sánh mật khẩu hiện tại
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Mật khẩu hiện tại không đúng" });
    }

    // 4️⃣ Hash mật khẩu mới
    const hashed = await bcrypt.hash(newPassword, 10);

    // 5️⃣ Update password + 🔥 TẮT FLAG FIRST LOGIN
    await pool.query(
      `
      UPDATE users
      SET 
        password = $1,
        is_first_login = false,
        updated_at = NOW()
      WHERE user_id = $2
      `,
      [hashed, userId]
    );

    res.json({
      message: "Đổi mật khẩu thành công",
      is_first_login: false, // tiện cho frontend nếu cần
    });
  } catch (err) {
    console.error("Change password error:", err);
    res.status(500).json({ message: "Change password failed" });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { name, phone, address } = req.body;
    let avatarUrl;

    if (req.file) {
      avatarUrl = `/uploads/users/avatars/${req.file.filename}`;
      console.log("New avatar uploaded:", avatarUrl);
    }

    let query, values;

    if (avatarUrl) {
      // Có file mới → cập nhật avatar
      query = `
        UPDATE users
        SET name = $1, phone = $2, address = $3, image_url = $4, updated_at = NOW()
        WHERE user_id = $5
        RETURNING user_id, name, email, phone, address, image_url
      `;
      values = [name, phone, address, avatarUrl, userId];
    } else {
      // Không có file mới → giữ avatar cũ
      query = `
        UPDATE users
        SET name = $1, phone = $2, address = $3,updated_at = NOW()
        WHERE user_id = $4
        RETURNING user_id, name, email, phone, address, image_url
      `;
      values = [name, phone, address, userId];
    }

    console.log("SQL values:", values);

    const result = await pool.query(query, values);
    console.log("Updated row:", result.rows[0]);

    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error("UPDATE PROFILE ERROR:", err);
    res.status(500).json({ message: "Failed to update profile" });
  }
};
exports.saveAlarm = async (req, res) => {
  const user_id = req.user?.user_id;

  if (!user_id)
    return res.status(403).json({ message: "User not authorized" });

  const {
    device_id,
    measurement_id,
    threshold_high,
    threshold_low,
    meta
  } = req.body;

  if (!device_id || !measurement_id)
    return res.status(400).json({ message: "device_id and measurement_id are required" });

  try {
    const query = `
    INSERT INTO alarms (
  device_id,
  measurement_id,
  user_id,
  threshold_high,
  threshold_low,
  meta,
  created_at,
  updated_at
)
VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
ON CONFLICT (device_id, measurement_id)
DO UPDATE SET
  user_id        = EXCLUDED.user_id, -- 👈 cập nhật user_id
  threshold_high = EXCLUDED.threshold_high,
  threshold_low  = EXCLUDED.threshold_low,
  meta           = EXCLUDED.meta,
  updated_at     = NOW()
RETURNING *;
    `;

    const values = [
      device_id,
      measurement_id,
      user_id,
      threshold_high,
      threshold_low,
      meta || {}
    ];

    const { rows } = await pool.query(query, values);

    res.status(200).json({
      success: true,
      alarm: rows[0]
    });
  } catch (err) {
    console.error("[ALARM] Save error:", err);
    res.status(500).json({ message: "Server error while saving alarm" });
  }
};
exports.getAlarmByDeviceMeasurement = async (req, res) => {
  const user_id = req.user?.user_id;
  const { deviceId, measurementId } = req.params;

  console.log("[ALARM] getAlarmByDeviceMeasurement called");
  console.log("Params:", { deviceId, measurementId, user_id });

  if (!user_id) {
    console.log("[ALARM] User not authorized");
    return res.status(403).json({ message: "User not authorized" });
  }

  if (!deviceId || !measurementId) {
    console.log("[ALARM] Missing deviceId or measurementId");
    return res.status(400).json({ message: "deviceId and measurementId are required" });
  }

  try {
    const query = `
      SELECT
        device_id,
        measurement_id,
        threshold_high,
        threshold_low,
        meta,
        updated_at
      FROM alarms
      WHERE device_id = $1
        AND measurement_id = $2
      LIMIT 1;
    `;

    console.log("[ALARM] Running query with values:", [deviceId, measurementId]);
    const { rows } = await pool.query(query, [deviceId, measurementId]);

    console.log("[ALARM] Query returned rows:", rows);

    if (rows.length === 0) {
      console.log("[ALARM] No alarm found for this device + measurement + user");
      return res.status(200).json({
        exists: false
      });
    }

    console.log("[ALARM] Found alarm:", rows[0]);
    res.status(200).json({
      exists: true,
      alarm: rows[0]
    });
  } catch (err) {
    console.error("[ALARM] Get error:", err);
    res.status(500).json({ message: "Server error while fetching alarm" });
  }
};
exports.renameDevice = async (req, res) => {
  const { deviceId } = req.params;
  const { name } = req.body;

  if (!deviceId) {
    return res.status(400).json({ message: "Device ID is required" });
  }

  if (!name || !name.trim()) {
    return res.status(400).json({ message: "Name is required" });
  }

  try {
    const result = await pool.query(
      `
      UPDATE devices
      SET name = $1,
          updated_at = NOW()
      WHERE device_id = $2
      RETURNING device_id, name, updated_at
      `,
      [name.trim(), deviceId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Device not found" });
    }

    return res.json({
      message: "Device name updated successfully",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("[RENAME DEVICE ERROR]", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
// GET /api/history-config
exports.getHistoryConfigByDevice = async (req, res) => {
  const user_id = req.user.user_id;

  console.log("========== [getHistoryConfigByDevice] ==========");
  console.log("user_id:", user_id);

  try {
    // 1️⃣ LẤY CUSTOMER_ID TỪ USER
    const userRes = await pool.query(
      `
      SELECT customer_id
      FROM users
      WHERE user_id = $1
      `,
      [user_id]
    );

    const customer_id = userRes.rows[0]?.customer_id;

    console.log("customer_id:", customer_id);

    if (!customer_id) {
      console.error("❌ User has no customer_id");
      return res.status(400).json({ message: "User not linked to customer" });
    }

    // 2️⃣ QUERY HISTORY CONFIG
    const { rows } = await pool.query(
      `
      SELECT
        hc.id,
        hc.device_id,
        d.name AS device_name,
        hc.measurement_id,
        m.name AS measurement_name
      FROM history_config hc
      JOIN devices d ON d.device_id = hc.device_id
      JOIN sites s ON s.site_id = d.site_id
      JOIN measurements m ON m.measurement_id = hc.measurement_id
      WHERE s.customer_id = $1
      ORDER BY d.name, m.name
      `,
      [customer_id]
    );

    console.log("rows.length:", rows.length);
    console.log("first row:", rows[0]);

    res.json({ measurements: rows });
  } catch (err) {
    console.error("[getHistoryConfigByDevice] ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
};
// POST /api/history-config
exports.createHistoryConfig = async (req, res) => {
  const { deviceId } = req.params;
  const { measurement_id } = req.body;
console.log("req.user =", req.user);

  try {
    // 1️⃣ Lấy customer_id thông qua site
    const deviceRes = await pool.query(
      `
      SELECT s.customer_id
      FROM devices d
      JOIN sites s ON s.site_id = d.site_id
      WHERE d.device_id = $1
      `,
      [deviceId]
    );

    if (deviceRes.rowCount === 0) {
      return res.status(404).json({ message: "Device not found" });
    }

    const customer_id = deviceRes.rows[0].customer_id;

    // 2️⃣ Check quota theo customer (30 measurement)
    const quotaRes = await pool.query(
      `
      SELECT COUNT(*) 
      FROM history_config 
      WHERE customer_id = $1
      `,
      [customer_id]
    );

    if (+quotaRes.rows[0].count >= 30) {
      return res.status(403).json({
        message: "Free plan allows maximum 30 measurements",
      });
    }

    // 3️⃣ Insert
    const insertRes = await pool.query(
      `
      INSERT INTO history_config (customer_id, device_id, measurement_id)
      VALUES ($1, $2, $3)
      RETURNING id
      `,
      [customer_id, deviceId, measurement_id]
    );

    res.status(201).json({
      id: insertRes.rows[0].id,
    });
  } catch (err) {
    console.error("createHistoryConfig error:", err);

    if (err.code === "23505") {
      return res.status(409).json({ message: "Already exists" });
    }

    res.status(500).json({ message: "Server error" });
  }
};
// PATCH /api/history-config/:id
exports.updateHistoryConfig = async (req, res) => {
  const customerId = req.user.customer_id;
  const { id } = req.params;
  const { enabled } = req.body;

  try {
    const { rowCount, rows } = await db.query(
      `
      UPDATE history_config
      SET enabled = $1
      WHERE id = $2 AND customer_id = $3
      RETURNING *
      `,
      [enabled, id, customerId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ message: "Config not found" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update history config" });
  }
};
// DELETE /api/history-config/:id
exports.deleteHistoryConfig = async (req, res) => {
  const customerId = req.user.customer_id;
  const { id } = req.params;

  try {
    const { rowCount } = await db.query(
      `
      DELETE FROM history_config
      WHERE id = $1 AND customer_id = $2
      `,
      [id, customerId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ message: "Config not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete history config" });
  }
};
exports.upsertUserDeviceConfig = async (req, res) => {
  try {

    const userId = req.user.user_id;
    const { deviceId, is_visible, pinned, display_order } = req.body;
 
    if (!deviceId) {
      return res.status(400).json({ message: "deviceId is required" });
    }

    const query = `
      INSERT INTO users_devices (
        user_id,
        device_id,
        is_visible,
        pinned,
        display_order
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, device_id)
      DO UPDATE SET
        is_visible = EXCLUDED.is_visible,
        pinned = EXCLUDED.pinned,
        display_order = EXCLUDED.display_order,
        updated_at = NOW()
      RETURNING *;
    `;

    const values = [
      userId,
      deviceId,
      is_visible ?? 1,
      pinned ?? 0,
      display_order ?? 0,
    ];

    const { rows } = await pool.query(query, values);

    return res.json({
      success: true,
      data: rows[0],
    });
  } catch (error) {
    console.error("upsertUserDeviceConfig error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
exports.getUserDevices = async (req, res) => {
  const user_id = req.user?.user_id;

  if (!user_id) {
    return res.status(403).json({
      message: "User not authorized",
    });
  }

  try {
    const { rows } = await pool.query(
      `
      WITH RECURSIVE site_tree AS (
        -- 1. Root sites assigned to user
        SELECT 
          s.site_id,
          s.name,
          s.parent_id,
          s.type,
          s.name::text AS path,
          s.site_id AS root_site_id
        FROM sites s
        JOIN users_sites us 
          ON us.site_id = s.site_id
        WHERE us.user_id = $1

        UNION ALL

        -- 2. All child sites / stations / clusters
        SELECT
          s.site_id,
          s.name,
          s.parent_id,
          s.type,
          st.path || ' > ' || s.name AS path,
          st.root_site_id
        FROM sites s
        INNER JOIN site_tree st
          ON s.parent_id = st.site_id
      )

      SELECT
        d.device_id,
        d.name,
        dt.name AS type,

        st.path AS location,
        st.root_site_id,
        st.type AS node_type,

        COALESCE(ds.status, 0) AS status,

        COALESCE(ud.is_visible, 1) AS is_visible,
        COALESCE(ud.pinned, 0) AS pinned,
        COALESCE(ud.display_order, 0) AS display_order

      FROM devices d

      -- get full recursive tree
      JOIN site_tree st
        ON d.site_id = st.site_id

      -- user config
      LEFT JOIN users_devices ud
        ON ud.device_id = d.device_id
       AND ud.user_id = $1

      -- latest device status
      LEFT JOIN LATERAL (
        SELECT status
        FROM device_status
        WHERE device_id = d.device_id
        ORDER BY created_at DESC
        LIMIT 1
      ) ds ON TRUE

      -- device type
      LEFT JOIN device_types dt
        ON d.device_type_id = dt.id

      ORDER BY
        COALESCE(ud.pinned, 0) DESC,
        COALESCE(ud.display_order, 0) ASC,
        d.device_id ASC
      `,
      [user_id]
    );

    const mapped = rows.map((r) => ({
      device_id: r.device_id,
      name: r.name,
      type: r.type,

      location: r.location,
      root_site_id: r.root_site_id,
      node_type: r.node_type,

      status: r.status === 1 ? "connected" : "disconnected",

      is_visible: r.is_visible,
      pinned: r.pinned,
      display_order: r.display_order,
    }));

    return res.json({
      success: true,
      data: mapped,
    });
  } catch (error) {
    console.error("[getUserDevices] error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};
exports.savePushToken = async (req, res) => {
  const { token } = req.body;

  const user_id = req.user?.user_id;

  console.log("📲 Save token:");
  console.log("👉 user_id:", user_id);
  console.log("👉 token:", token);

  if (!user_id) {
    return res.status(401).json({ error: "Invalid user (missing user_id)" });
  }

  if (!token) {
    return res.status(400).json({ error: "Missing token" });
  }

  try {
    await pool.query(`
      INSERT INTO user_push_tokens (user_id, push_token)
      VALUES ($1, $2)
      ON CONFLICT (push_token) DO UPDATE
      SET user_id = EXCLUDED.user_id
    `, [user_id, token]);

    console.log("✅ Token saved");

    res.json({ success: true });

  } catch (err) {
    console.error("🔥 Save token error:", err);
    res.status(500).json({ error: "Server error" });
  }
};
exports.getDeviceBySerial = async (req, res) => {
  const { serial } = req.params;

  if (!serial) {
    return res.status(400).json({ error: "Serial is required" });
  }

  try {
    const result = await pool.query(
      `SELECT 
  device_id,
  name,
  model,
  serial_number,
  status,
  ip_address,
  site_id
FROM devices
WHERE serial_number = $1
LIMIT 1`,
      [serial]
    );

    // ❌ không tìm thấy
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Device not found" });
    }

    const device = result.rows[0];

    // ❗ nếu đã assign thì chặn luôn
    if (device.site_id) {
      return res.status(400).json({ error: "Device already assigned" });
    }

    return res.json({
      message: "Device found",
      device,
    });
  } catch (err) {
    console.error("getDeviceBySerial error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};
exports.claimDeviceBySerial = async (req, res) => {
  const { serial, site_id } = req.body;
  const user = req.user;

  if (!serial || !site_id) {
    return res.status(400).json({
      error: "Serial and site_id are required",
    });
  }

  try {
    // 🔥 1. check device tồn tại & chưa assign
    const deviceResult = await pool.query(
      `SELECT device_id, site_id
       FROM devices
       WHERE serial_number = $1
       LIMIT 1`,
      [serial]
    );

    if (deviceResult.rows.length === 0) {
      return res.status(404).json({
        error: "Device not found",
      });
    }

    const device = deviceResult.rows[0];

    if (device.site_id) {
      return res.status(400).json({
        error: "Device already assigned",
      });
    }

    // 🔥 2. check site có thuộc user không
   const siteResult = await pool.query(
  `SELECT site_id
   FROM users_sites
   WHERE user_id = $1 AND site_id = $2
   LIMIT 1`,
  [user.user_id, site_id]
);

    if (siteResult.rows.length === 0) {
      return res.status(403).json({
        error: "You do not have permission for this site",
      });
    }

    // 🔥 3. assign device → site
    const updatedResult = await pool.query(
      `UPDATE devices
       SET site_id = $1,
           updated_at = NOW()
       WHERE device_id = $2
       RETURNING device_id, name, model, serial_number, status, site_id`,
      [site_id, device.device_id]
    );

    return res.json({
      success: true,
      message: "Device assigned successfully",
      device: updatedResult.rows[0],
    });
  } catch (err) {
    console.error("claimDeviceBySerial error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};