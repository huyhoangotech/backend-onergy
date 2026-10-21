const multer = require('multer');
const { diskStorage } = require('multer');
const { extname } = require('path');
const { existsSync, mkdirSync } = require('fs');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const path = require("path");
const ExcelJS = require("exceljs");
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
        d.name AS device_name,
        d.serial_number,
        d.ip_address,
        d.port,
        d.model,
        d.slave_id,
        d.connection_type,
        d.gateway_id,
        d.active,
        d.created_at,

        -- trạng thái mới nhất
        COALESCE(ds.status, 0) AS status,

        d.product_line_id,
        pl.name AS product_line_name,

        dt.id AS device_type_id,
        dt.name AS device_type_name,

        s.site_id,
        s.name AS site_name,

        g.name AS gateway_name

      FROM devices d

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

      LEFT JOIN gateways g
        ON g.gateway_id = d.gateway_id

      ${whereClause}

      ORDER BY d.created_at DESC
    `;

    const { rows } = await pool.query(query, values);

    const result = rows.map((r) => ({
      ...r,
      status: r.status === 1 ? "connected" : "disconnected",
      connection_type: r.connection_type || "none",
    }));

    res.json(result);
  } catch (error) {
    console.error("Error getDevices:", error);
    res.status(500).json({ error: "Failed to get devices" });
  }
};
exports.getDeviceDetail = async (req, res) => {
  const { deviceId } = req.params;

  if (!deviceId) {
    return res.status(400).json({ message: "Missing device ID" });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT
        d.device_id,
        d.name AS device_name,
        d.serial_number,
        d.ip_address,
        d.port,
        d.model,
        d.device_type_id,
        d.product_line_id,
        d.site_id,
        d.slave_id,
        d.connection_type,
        d.gateway_id,
        d.active,

        COALESCE(ds.status, 0) AS status,

        dt.name AS device_type_name,
        pl.name AS product_line_name,
        s.name AS site_name,
        g.name AS gateway_name

      FROM devices d

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

      LEFT JOIN gateways g
        ON g.gateway_id = d.gateway_id

      WHERE d.device_id = $1
      LIMIT 1
      `,
      [deviceId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Device not found" });
    }

    const device = rows[0];

    res.json({
      ...device,
      status: device.status === 1 ? "connected" : "disconnected",
      connection_type: device.connection_type || "none",
    });
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
    port,
    model,
    device_type_id,
    product_line_id,
    site_id,
    gateway_id,
    slave_id,
    connection_type = "none",
    active = 1,
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // =========================
    // 1) VALIDATE INPUT
    // =========================
    const allowedConnectionTypes = ["gateway", "ethernet", "none"];
    if (!allowedConnectionTypes.includes(connection_type)) {
      return res.status(400).json({
        error: "connection_type must be one of: gateway, ethernet, none",
        field: "connection_type",
      });
    }

    if (![0, 1, "0", "1"].includes(active)) {
      return res.status(400).json({
        error: "active must be 0 or 1",
        field: "active",
      });
    }

    // gateway mode
    if (connection_type === "gateway") {
      if (!gateway_id) {
        return res.status(400).json({
          error: "gateway_id is required when connection_type = gateway",
          field: "gateway_id",
        });
      }
    }

    // ethernet mode
    if (connection_type === "ethernet") {
      if (!ip_address || String(ip_address).trim() === "") {
        return res.status(400).json({
          error: "ip_address is required when connection_type = ethernet",
          field: "ip_address",
        });
      }

      if (port === undefined || port === null || port === "") {
        return res.status(400).json({
          error: "port is required when connection_type = ethernet",
          field: "port",
        });
      }
    }

    // =========================
    // 2) NORMALIZE DATA
    // =========================
    let finalGatewayId = null;
    let finalIpAddress = null;
    let finalPort = null;
    let finalSlaveId = null;

    if (connection_type === "gateway") {
      finalGatewayId = gateway_id || null;
      finalSlaveId = slave_id !== undefined && slave_id !== "" ? Number(slave_id) : null;
      finalIpAddress = null;
      finalPort = null;
    } else if (connection_type === "ethernet") {
      finalGatewayId = null;
      finalIpAddress = ip_address?.trim() || null;
      finalPort = port !== undefined && port !== "" ? Number(port) : null;
      finalSlaveId = slave_id !== undefined && slave_id !== "" ? Number(slave_id) : null;
    } else {
      // none = draft device
      finalGatewayId = null;
      finalIpAddress = null;
      finalPort = null;
      finalSlaveId = null;
    }

    // =========================
    // 3) INSERT DEVICE
    // =========================
    const deviceResult = await client.query(
      `
      INSERT INTO devices (
        name,
        serial_number,
        ip_address,
        port,
        model,
        device_type_id,
        product_line_id,
        site_id,
        gateway_id,
        slave_id,
        connection_type,
        active
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      )
      RETURNING device_id
      `,
      [
        device_name || null,
        serial_number || null,
        finalIpAddress,
        finalPort,
        model || null,
        device_type_id || null,
        product_line_id || null,
        site_id || null,
        finalGatewayId,
        finalSlaveId,
        connection_type,
        Number(active),
      ]
    );

    const deviceId = deviceResult.rows[0].device_id;

    // =========================
    // 4) INSERT INITIAL STATUS
    // draft device => mặc định offline
    // active device có kết nối => có thể để 1 hoặc 0 tùy bạn
    // mình đang để 0 cho an toàn, đợi scan thật rồi đổi
    // =========================
    await client.query(
      `
      INSERT INTO device_status (
        device_id,
        status,
        created_at
      )
      VALUES ($1, $2, NOW())
      `,
      [
        deviceId,
        connection_type === "none" ? 0 : 0
      ]
    );

    await client.query("COMMIT");

    return res.json({
      message: "Device created successfully",
      device_id: deviceId,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error createDevice:", err);

    if (err.code === "23505" && err.constraint === "devices_serial_number_key") {
      return res.status(400).json({
        error: "Serial number already exists",
        field: "serial_number",
      });
    }

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
    port,
    model,
    device_type_id,
    product_line_id,
    site_id,
    status,
    slave_id,
    gateway_id,
    connection_type,
    active,
  } = req.body;

  try {
    const fields = [];
    const values = [];
    let idx = 1;

    // =========================
    // 1) VALIDATE connection_type / active
    // =========================
    if (connection_type !== undefined) {
      const allowedConnectionTypes = ["gateway", "ethernet", "none"];
      if (!allowedConnectionTypes.includes(connection_type)) {
        return res.status(400).json({
          error: "connection_type must be one of: gateway, ethernet, none",
          field: "connection_type",
        });
      }
    }

    if (active !== undefined && ![0, 1, "0", "1"].includes(active)) {
      return res.status(400).json({
        error: "active must be 0 or 1",
        field: "active",
      });
    }

    // =========================
    // 2) NORMAL FIELD UPDATE
    // =========================
    if (device_name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(device_name || null);
    }

    if (serial_number !== undefined) {
      fields.push(`serial_number = $${idx++}`);
      values.push(serial_number || null);
    }

    if (model !== undefined) {
      fields.push(`model = $${idx++}`);
      values.push(model || null);
    }

    if (device_type_id !== undefined) {
      fields.push(`device_type_id = $${idx++}`);
      values.push(device_type_id && device_type_id !== "" ? device_type_id : null);
    }

    if ("product_line_id" in req.body) {
      fields.push(`product_line_id = $${idx++}`);
      values.push(product_line_id || null);
    }

    if ("site_id" in req.body) {
      fields.push(`site_id = $${idx++}`);
      values.push(site_id || null);
    }

    if (status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(status);
    }

    if (active !== undefined) {
      fields.push(`active = $${idx++}`);
      values.push(Number(active));
    }

    // =========================
    // 3) CONNECTION LOGIC
    // =========================
    if (connection_type !== undefined) {
      // update connection_type trước
      fields.push(`connection_type = $${idx++}`);
      values.push(connection_type);

      if (connection_type === "gateway") {
        if (!gateway_id) {
          return res.status(400).json({
            error: "gateway_id is required when connection_type = gateway",
            field: "gateway_id",
          });
        }

        // gateway fields
        fields.push(`gateway_id = $${idx++}`);
        values.push(gateway_id);

        fields.push(`slave_id = $${idx++}`);
        values.push(slave_id !== undefined && slave_id !== "" ? Number(slave_id) : null);

        // clear ethernet fields
        fields.push(`ip_address = NULL`);
        fields.push(`port = NULL`);
      }

      else if (connection_type === "ethernet") {
        if (!ip_address || String(ip_address).trim() === "") {
          return res.status(400).json({
            error: "ip_address is required when connection_type = ethernet",
            field: "ip_address",
          });
        }

        if (port === undefined || port === null || port === "") {
          return res.status(400).json({
            error: "port is required when connection_type = ethernet",
            field: "port",
          });
        }

        // ethernet fields
        fields.push(`ip_address = $${idx++}`);
        values.push(ip_address.trim());

        fields.push(`port = $${idx++}`);
        values.push(Number(port));

        fields.push(`slave_id = $${idx++}`);
        values.push(slave_id !== undefined && slave_id !== "" ? Number(slave_id) : null);

        // clear gateway field
        fields.push(`gateway_id = NULL`);
      }

      else if (connection_type === "none") {
        // clear all connection fields
        fields.push(`gateway_id = NULL`);
        fields.push(`slave_id = NULL`);
        fields.push(`ip_address = NULL`);
        fields.push(`port = NULL`);
      }
    } else {
      // nếu không đổi connection_type nhưng user update lẻ các field thì vẫn cho update
      if ("gateway_id" in req.body) {
        fields.push(`gateway_id = $${idx++}`);
        values.push(gateway_id || null);
      }

      if ("slave_id" in req.body) {
        fields.push(`slave_id = $${idx++}`);
        values.push(slave_id !== undefined && slave_id !== "" ? Number(slave_id) : null);
      }

      if (ip_address !== undefined) {
        fields.push(`ip_address = $${idx++}`);
        values.push(ip_address && ip_address.trim() !== "" ? ip_address.trim() : null);
      }

      if ("port" in req.body) {
        fields.push(`port = $${idx++}`);
        values.push(port !== undefined && port !== "" ? Number(port) : null);
      }
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
      RETURNING
        device_id,
        name AS device_name,
        serial_number,
        ip_address,
        port,
        model,
        status,
        active,
        device_type_id,
        product_line_id,
        slave_id,
        gateway_id,
        connection_type,
        site_id
    `;

    values.push(device_id);

    const result = await pool.query(query, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Device not found" });
    }

    const device = result.rows[0];

    // lấy product_line_name nếu có
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
exports.exportMeasurementHistory = async (req, res) => {
  try {
    // =========================================================
    // PARAMS
    // =========================================================

    // Hỗ trợ cả :deviceId và :device_id
    const deviceId = req.params.deviceId || req.params.device_id;

    let {
      from,
      to,
      type = "month",
    } = req.query;

    if (!deviceId) {
      return res.status(400).json({
        message: "Device ID required",
      });
    }

    from = Number(from);
    to = Number(to);

    if (!from || !to || from >= to) {
      return res.status(400).json({
        message: "Invalid from/to",
      });
    }

    // =========================================================
    // BUCKET CONFIG
    // =========================================================

    const configMap = {
      // 1 ngày / bucket
      week: {
        bucketExpr: `
          date_trunc('day', timestamp_ms)
        `,
        step: "1 day",
      },

      // 1 ngày / bucket
      month: {
        bucketExpr: `
          date_trunc('day', timestamp_ms)
        `,
        step: "1 day",
      },

     // 1 tháng / bucket
      year: {
        bucketExpr: `
          date_trunc('month', timestamp_ms)
        `,
        step: "1 month",
      },

      // 15 phút / bucket
      custom: {
        bucketExpr: `
          date_trunc('hour', timestamp_ms)
          + floor(EXTRACT(minute FROM timestamp_ms) / 15)
            * interval '15 minute'
        `,
        step: "15 minute",
      },
    };

    const cfg = configMap[type];

    if (!cfg) {
      return res.status(400).json({
        message: "Invalid type",
      });
    }

    // =========================================================
    // LẤY TẤT CẢ MEASUREMENT CỦA DEVICE
    // =========================================================

    const measurementResult = await pool.query(
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

    if (!measurementResult.rows.length) {
      return res.status(404).json({
        message: "No measurements configured for this device",
      });
    }

    // =========================================================
    // QUERY DATA
    // =========================================================

    const query = `
      SELECT
        ${cfg.bucketExpr} AS bucket,
        measurement_id,
        AVG(value)::float AS avg_value,
        MIN(value)::float AS min_value,
        MAX(value)::float AS max_value
      FROM device_logs
      WHERE device_id = $1
        AND measurement_id = ANY($4::uuid[])
        AND timestamp_ms BETWEEN
          to_timestamp($2 / 1000.0)
          AND to_timestamp($3 / 1000.0)
      GROUP BY
        bucket,
        measurement_id
      ORDER BY
        bucket,
        measurement_id
    `;

    const measurementIds = measurementResult.rows.map(
      (item) => item.measurement_id
    );

    const { rows } = await pool.query(query, [
      deviceId,
      from,
      to,
      measurementIds,
    ]);

    // =========================================================
    // GROUP DATA THEO BUCKET
    // =========================================================

    const bucketMap = new Map();

    for (const row of rows) {
      const bucketKey = new Date(row.bucket).toISOString();

      if (!bucketMap.has(bucketKey)) {
        bucketMap.set(bucketKey, {
          bucket: row.bucket,
          measurements: {},
        });
      }

      bucketMap.get(bucketKey).measurements[row.measurement_id] = {
        avg: row.avg_value,
        min: row.min_value,
        max: row.max_value,
      };
    }

    const data = Array.from(bucketMap.values());

    // =========================================================
    // CREATE EXCEL
    // =========================================================

    const workbook = new ExcelJS.Workbook();

    workbook.creator = "Onergy";
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet("Measurements");

    // =========================================================
    // EXCEL COLUMNS
    // =========================================================

const measurementsWithData = measurementResult.rows.filter(
  (measurement) => {
    return data.some(
      (bucket) =>
        bucket.measurements[measurement.measurement_id]
    );
  }
);

const measurementsWithoutData = measurementResult.rows.filter(
  (measurement) => {
    return !data.some(
      (bucket) =>
        bucket.measurements[measurement.measurement_id]
    );
  }
);

const sortedMeasurements = [
  ...measurementsWithData,
  ...measurementsWithoutData,
];

// =========================================================
// EXCEL COLUMNS
// =========================================================

const columns = [
  {
    header: "Timestamp",
    key: "timestamp",
    width: 24,
  },
];

for (const measurement of sortedMeasurements) {
      columns.push({
        header: `${measurement.name} - Avg${
          measurement.unit ? ` (${measurement.unit})` : ""
        }`,
        key: `${measurement.measurement_id}_avg`,
        width: 20,
      });

      columns.push({
        header: `${measurement.name} - Min${
          measurement.unit ? ` (${measurement.unit})` : ""
        }`,
        key: `${measurement.measurement_id}_min`,
        width: 20,
      });

      columns.push({
        header: `${measurement.name} - Max${
          measurement.unit ? ` (${measurement.unit})` : ""
        }`,
        key: `${measurement.measurement_id}_max`,
        width: 20,
      });
    }

    worksheet.columns = columns;

    // =========================================================
    // HEADER
    // =========================================================

    const headerRow = worksheet.getRow(1);

    headerRow.font = {
      bold: true,
    };

    headerRow.alignment = {
      vertical: "middle",
      horizontal: "center",
      wrapText: true,
    };

    headerRow.height = 30;

    // =========================================================
    // DATA ROWS
    // =========================================================

    for (const bucket of data) {
      const row = {
        timestamp: new Date(bucket.bucket),
      };

      for (const measurement of measurementResult.rows) {
        const values =
          bucket.measurements[measurement.measurement_id];

        row[`${measurement.measurement_id}_avg`] =
          values?.avg ?? null;

        row[`${measurement.measurement_id}_min`] =
          values?.min ?? null;

        row[`${measurement.measurement_id}_max`] =
          values?.max ?? null;
      }

      worksheet.addRow(row);
    }

    // =========================================================
    // FORMAT TIMESTAMP
    // =========================================================

    worksheet.getColumn("timestamp").numFmt =
      "yyyy-mm-dd hh:mm:ss";

    // =========================================================
    // FREEZE HEADER
    // =========================================================

    worksheet.views = [
      {
        state: "frozen",
        ySplit: 1,
      },
    ];

    // =========================================================
    // AUTO FILTER
    // =========================================================

    if (worksheet.rowCount > 1) {
      worksheet.autoFilter = {
        from: "A1",
        to: worksheet.getRow(1).getCell(
          worksheet.columnCount
        ).address,
      };
    }

    // =========================================================
    // RESPONSE HEADERS
    // =========================================================

    const filename = `measurement_export_${deviceId}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );

    // =========================================================
    // WRITE EXCEL DIRECTLY TO RESPONSE
    // =========================================================

    await workbook.xlsx.write(res);

    res.end();
  } catch (err) {
    console.error(
      "exportMeasurementHistory error:",
      err
    );

    if (!res.headersSent) {
      return res.status(500).json({
        message: "Server error",
        error: err.message,
      });
    }
  }
};