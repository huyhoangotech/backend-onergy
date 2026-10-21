const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const ExcelJS = require("exceljs");
const pool = new Pool({
  user: "postgres",
  host: "171.244.141.14",
  database: "Recloser app",
  password: "1122",
  port: 5432,
});
exports.login = async (req, res) => {
const { email, password } = req.body;

try {
if (!email || !password) {
return res.status(400).json({
error: "Email and password are required",
});
}

const result = await pool.query(
  `
  SELECT
    user_id,
    name,
    email,
    password,
     role, 
     customer_id
  FROM users
  WHERE LOWER(email) = LOWER($1)
  LIMIT 1
  `,
  [email]
);

if (result.rows.length === 0) {
  return res.status(401).json({
    error: "Invalid email or password",
  });
}

const user = result.rows[0];

const isMatch = await bcrypt.compare(
  password,
  user.password
);

if (!isMatch) {
  return res.status(401).json({
    error: "Invalid email or password",
  });
}

const token = jwt.sign(
  {
    user_id: user.user_id,
    email: user.email,
    role: user.role,
     customer_id: user.customer_id 
  },
  process.env.JWT_SECRET || "your-secret-key",
  { expiresIn: "7d" }
);

return res.status(200).json({
  message: "Login successful",
  token,
  user: {
    user_id: user.user_id,
    name: user.name,
    email: user.email,
    role: user.role,   // 👈 THÊM
    
  },
});

} catch (error) {
console.error("LOGIN ERROR:", error);

return res.status(500).json({
  error: "Internal server error",
});

}
};
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.user_id;

    const result = await pool.query(
      `
      SELECT
        user_id,
        name,
        email,
        is_first_login
      FROM users
      WHERE user_id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    res.json({
      success: true,
      user: result.rows[0],
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Internal server error",
    });

  }
};
function getResolution(period, from, to) {
  const diffHours =
    (new Date(to) - new Date(from)) / 36e5;

  // =========================
  // HOUR
  // =========================
  if (
    period === "today" ||
    period === "last_24_hours" ||
    diffHours <= 24
  ) {
    return "hour";
  }

  // =========================
  // DAY
  // =========================
  if (
    period === "last_7_days" ||
    period === "last_30_days" ||
    period === "this_month" ||
    diffHours <= 24 * 30
  ) {
    return "day";
  }

  // =========================
  // MONTH
  // =========================
  return "month";
}
function buildQuery(resolution) {
  let groupBy = "";

  switch (resolution) {
    case "hour":
      groupBy = `DATE_TRUNC('hour', timestamp_ms)`;
      break;

    case "day":
      groupBy = `DATE(timestamp_ms)`;
      break;

    case "month":
      groupBy = `DATE_TRUNC('month', timestamp_ms)`;
      break;

    default:
      groupBy = `DATE(timestamp_ms)`;
  }

  return `
    WITH ranked AS (
      SELECT
        ${groupBy} AS time_bucket,
        measurement_id,
        value,
        timestamp_ms,

        ROW_NUMBER() OVER (
          PARTITION BY ${groupBy}, measurement_id
          ORDER BY timestamp_ms DESC
        ) AS rn

      FROM device_logs

      WHERE device_id = $1::uuid
        AND timestamp_ms BETWEEN $2 AND $3
    ),

    pivoted AS (
      SELECT
        time_bucket,

        MAX(
          CASE
            WHEN measurement_id = '1dfbe3ba-d5ce-425a-90fb-a4b866aca029'
            THEN value
          END
        ) AS peak,

        MAX(
          CASE
            WHEN measurement_id = '4fb6378f-fa58-4efc-ac60-d390bf6415c0'
            THEN value
          END
        ) AS normal,

        MAX(
          CASE
            WHEN measurement_id = '42a4ef8e-72ac-4cff-ba51-faa156b0db0a'
            THEN value
          END
        ) AS offpeak

      FROM ranked

      WHERE rn = 1

      GROUP BY time_bucket
    )

    SELECT
      TO_CHAR(
        time_bucket,
        CASE
          WHEN '${resolution}' = 'hour'
            THEN 'YYYY-MM-DD HH24:00'

          WHEN '${resolution}' = 'month'
            THEN 'YYYY-MM'

          ELSE 'YYYY-MM-DD'
        END
      ) AS label,

      COALESCE(
        peak - LAG(peak) OVER (ORDER BY time_bucket),
        0
      ) AS peak,

      COALESCE(
        normal - LAG(normal) OVER (ORDER BY time_bucket),
        0
      ) AS normal,

      COALESCE(
        offpeak - LAG(offpeak) OVER (ORDER BY time_bucket),
        0
      ) AS offpeak,

      COALESCE(
        (peak - LAG(peak) OVER (ORDER BY time_bucket)) +
        (normal - LAG(normal) OVER (ORDER BY time_bucket)) +
        (offpeak - LAG(offpeak) OVER (ORDER BY time_bucket)),
        0
      ) AS total

    FROM pivoted

    ORDER BY time_bucket;
  `;
}
function getDateRange(period) {
  const now = new Date();

  let from = new Date();
  let to = new Date();

  switch (period) {
    case "today":
      from.setHours(0, 0, 0, 0);
      to.setHours(23, 59, 59, 999);
      break;

    case "this_week":
      const day = now.getDay();
      from.setDate(now.getDate() - day);
      from.setHours(0, 0, 0, 0);
      to.setHours(23, 59, 59, 999);
      break;

  case "this_month":
  from = new Date(
    now.getFullYear(),
    now.getMonth(),
    1
  );

  to = new Date(now);

  break;

    case "this_year":
      from = new Date(now.getFullYear(), 0, 1);
      to = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
      break;

    case "last_24_hours":
      from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      to = now;
      break;

    case "last_7_days":
      from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      to = now;
      break;

    case "last_30_days":
      from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      to = now;
      break;

    case "last_12_months":
  from = new Date(
    now.getFullYear(),
    now.getMonth() - 11,
    1
  );

  to = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
    23,
    59,
    59,
    999
  );

  break;

    default:
      from.setHours(0, 0, 0, 0);
      to.setHours(23, 59, 59, 999);
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
}
exports.getCustomReport = async (req, res) => {
  try {
    const {
      period = "today",
      fromDate: customFromDate,
      toDate: customToDate,
      userId: requestedUserId,
    } = req.query;

    // ==========================================
    // XÁC ĐỊNH USER ĐƯỢC XEM
    // ==========================================

    let userId;

    if (req.user.role === 1) {
      userId = requestedUserId || req.user.user_id;
    } else {
      userId = req.user.user_id;
    }

    console.log("===== CUSTOM REPORT USER =====");
    console.log({
      loginUserId: req.user.user_id,
      role: req.user.role,
      requestedUserId,
      targetUserId: userId,
    });

    // ==========================================
    // DATE RANGE
    // ==========================================

    let fromDate;
    let toDate;
    let from;
    let to;

    if (
      period === "fixed_date" &&
      customFromDate &&
      customToDate
    ) {
      from = customFromDate;
      to = customToDate;

      fromDate = new Date(customFromDate);
      toDate = new Date(customToDate);
    } else {
      const range = getDateRange(period);

      from = range.from;
      to = range.to;

      fromDate = new Date(range.from);
      toDate = new Date(range.to);
    }

    // ==========================================
    // LẤY DEVICE CỦA USER
    // ==========================================

    const deviceResult = await pool.query(
      `
      SELECT device_id
      FROM users_devices
      WHERE user_id = $1
      ORDER BY pinned DESC
      LIMIT 1
      `,
      [userId]
    );

    if (!deviceResult.rows.length) {
      return res.status(404).json({
        error: "No device",
      });
    }

    const deviceId = deviceResult.rows[0].device_id;

    // ==========================================
    // RESOLUTION
    // ==========================================

    const resolution = getResolution(
      period,
      from,
      to
    );

    // ==========================================
    // LÙI 1 BUCKET ĐỂ TÍNH LAG
    // ==========================================

 const queryFrom = new Date(fromDate);

switch (resolution) {
  case "hour":
    queryFrom.setHours(
      queryFrom.getHours() - 1
    );
    break;

  case "day":
    queryFrom.setDate(
      queryFrom.getDate() - 1
    );
    break;

  case "month":
    // Chỉ cần lấy ngày cuối của tháng trước
    // để LAG() có giá trị tham chiếu.
    queryFrom.setDate(1);
    queryFrom.setDate(0);
    break;
}

    // ==========================================
    // BUILD ENERGY SQL
    // ==========================================

    const sql = buildQuery(resolution);

    console.log("===== SQL =====");
    console.log(sql);

    console.log("===== PARAMS =====");
    console.log({
      deviceId,
      queryFrom,
      fromDate,
      toDate,
      resolution,
    });

    // ==========================================
    // LẤY ENERGY TỪ DEVICE_LOGS
    // ==========================================

    const result = await pool.query(sql, [
      deviceId,
      queryFrom,
      toDate,
    ]);

    // ==========================================
    // BỎ BUCKET PHỤ
    // ==========================================

    let data = result.rows;

    if (data.length > 0) {
      data = data.slice(1);
    }

    // ==========================================
    // LẤY PRICING PLAN ACTIVE
    // ==========================================

    const pricingPlanResult = await pool.query(
      `
      SELECT pricing_plan_id
      FROM pricing_plans
      WHERE is_active = true
      ORDER BY created_at DESC
      LIMIT 1
      `
    );

    if (!pricingPlanResult.rows.length) {
      return res.status(404).json({
        error: "No active pricing plan",
      });
    }

    const pricingPlanId =
      pricingPlanResult.rows[0].pricing_plan_id;

    console.log("===== ACTIVE PRICING PLAN =====");
    console.log({
      pricingPlanId,
    });

    // ==========================================
    // LẤY PRICE TỪ PRICING_RULES
    // ==========================================

    const pricingResult = await pool.query(
      `
      SELECT
        tariff_type,
        price
      FROM pricing_rules
      WHERE pricing_plan_id = $1
        AND rule_type = 1
      ORDER BY tariff_type
      `,
      [pricingPlanId]
    );

    // ==========================================
    // PRICE MAP
    // ==========================================

    const prices = {
      peak: 0,
      normal: 0,
      offPeak: 0,
    };

    for (const row of pricingResult.rows) {
      const tariffType = Number(row.tariff_type);
      const price = Number(row.price) || 0;

      if (tariffType === 1) {
        prices.peak = price;
      } else if (tariffType === 2) {
        prices.normal = price;
      } else if (tariffType === 3) {
        prices.offPeak = price;
      }
    }

    console.log("===== PRICES FROM DATABASE =====");
    console.log(prices);

    // ==========================================
    // TÍNH COST
    // ==========================================

    data = data.map((item) => {
      const peak = Number(item.peak) || 0;
      const normal = Number(item.normal) || 0;
      const offPeak = Number(item.offpeak) || 0;

      const peakCost =
        peak * prices.peak;

      const normalCost =
        normal * prices.normal;

      const offPeakCost =
        offPeak * prices.offPeak;

      const totalCost =
        peakCost +
        normalCost +
        offPeakCost;

      return {
        ...item,

        // =========================
        // ENERGY
        // =========================

        peak,
        normal,
        offpeak: offPeak,

        // =========================
        // PRICE FROM DATABASE
        // =========================

        peakPrice: prices.peak,
        normalPrice: prices.normal,
        offPeakPrice: prices.offPeak,

        // =========================
        // COST
        // =========================

        peakCost,
        normalCost,
        offPeakCost,
        totalCost,
      };
    });

    return res.json({
      success: true,

      resolution,

      pricing: {
        pricingPlanId,

        peak: prices.peak,
        normal: prices.normal,
        offPeak: prices.offPeak,
      },

      data,
    });

  } catch (err) {
    console.error(
      "getCustomReport error:",
      err
    );

    return res.status(500).json({
      error: err.message,
    });
  }
};
exports.exportCustomReport = async (req, res) => {
  try {
    
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
exports.getDashboard = async (req, res) => {
     console.log("===== GET DASHBOARD =====");
  try {
    const { customer_id } = req.user;
console.log("USER IN TOKEN:", req.user);
console.log("CUSTOMER ID:", req.user?.customer_id);
    if (!customer_id) {
      return res.status(400).json({
        error: "Missing customer_id in token",
      });
    }

    // =========================
    // 1. USERS (có role)
    // =========================
    const usersQ = pool.query(
      `
      SELECT COUNT(*) AS total
      FROM users
      WHERE customer_id = $1
        AND role IS NOT NULL
      `,
      [customer_id]
    );
console.log("REQ USER =", req.user);
    // =========================
    // 2. SITES
    // =========================
    const sitesQ = pool.query(
      `
      SELECT COUNT(*) AS total
      FROM sites
      WHERE customer_id = $1
      `,
      [customer_id]
    );

    // =========================
    // 3. DEVICES (qua users_devices)
    // =========================
    const devicesQ = pool.query(
      `
      SELECT COUNT(DISTINCT ud.device_id) AS total
      FROM users_devices ud
      JOIN users u ON u.user_id = ud.user_id
      WHERE u.customer_id = $1
      `,
      [customer_id]
    );

    // =========================
    // 4. ENERGY TOTAL (1 ngày)
    // =========================
    const energyQ = pool.query(
      `
      SELECT COALESCE(SUM(dl.value), 0) AS total
      FROM device_logs dl
      JOIN users_devices ud ON ud.device_id = dl.device_id
      JOIN users u ON u.user_id = ud.user_id
      WHERE u.customer_id = $1
        AND dl.timestamp_ms >= NOW() - INTERVAL '1 day'
      `,
      [customer_id]
    );

    // =========================
    // 5. TOU BREAKDOWN
    // =========================
   const touQ = pool.query(
  `
  SELECT
    COALESCE(SUM(CASE WHEN dl.measurement_id = '1dfbe3ba-d5ce-425a-90fb-a4b866aca029' THEN dl.value ELSE 0 END),0) AS peak,

    COALESCE(SUM(CASE WHEN dl.measurement_id = '4fb6378f-fa58-4efc-ac60-d390bf6415c0' THEN dl.value ELSE 0 END),0) AS normal,

    COALESCE(SUM(CASE WHEN dl.measurement_id = '42a4ef8e-72ac-4cff-ba51-faa156b0db0a' THEN dl.value ELSE 0 END),0) AS offpeak

  FROM device_logs dl
  JOIN users_devices ud ON ud.device_id = dl.device_id
  JOIN users u ON u.user_id = ud.user_id
  WHERE u.customer_id = $1
    AND dl.timestamp_ms >= NOW() - INTERVAL '1 day'
  `,
  [customer_id]
);
    // =========================
    // RUN PARALLEL
    // =========================
    const [users, sites, devices, energy, tou] = await Promise.all([
      usersQ,
      sitesQ,
      devicesQ,
      energyQ,
      touQ,
    ]);

    // =========================
    // RESPONSE
    // =========================
    return res.json({
      success: true,
      kpi: {
        users: Number(users.rows[0].total),
        sites: Number(sites.rows[0].total),
        devices: Number(devices.rows[0].total),
        energy: Number(energy.rows[0].total),
      },
      tou: tou.rows[0],
    });
  } catch (err) {
    console.error("DASHBOARD ERROR:", err);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
};
exports.getAllUsers = async (req, res) => {
  try {
    const { customer_id } = req.user;

    const result = await pool.query(
      `
      SELECT
        u.user_id,
        u.name,
        u.email,
        u.role,
        u.created_at,

        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'device_id', d.device_id,
              'name', d.name
            )
          ) FILTER (WHERE d.device_id IS NOT NULL),
          '[]'
        ) AS devices

      FROM users u

      LEFT JOIN users_devices ud
        ON ud.user_id = u.user_id

      LEFT JOIN devices d
        ON d.device_id = ud.device_id

      WHERE u.customer_id = $1

      GROUP BY
        u.user_id,
        u.name,
        u.email,
        u.role,
        u.created_at

      ORDER BY u.created_at DESC
      `,
      [customer_id]
    );

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (err) {
    console.error("GET USERS ERROR:", err);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
};
exports.createUser = async (req, res) => {
  try {
    const { customer_id } = req.user;
    const { name, email, password, role } = req.body;

    const hashed = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `
      INSERT INTO users (name, email, password, role, customer_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING user_id, name, email, role
      `,
      [name, email, hashed, role, customer_id]
    );

    return res.json({
      success: true,
      user: result.rows[0],
    });
  } catch (err) {
    console.error("CREATE USER ERROR:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
exports.updateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, email, role } = req.body;

    const result = await pool.query(
      `
      UPDATE users
      SET name = $1,
          email = $2,
          role = $3
      WHERE user_id = $4
      RETURNING user_id, name, email, role
      `,
      [name, email, role, userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json({
      success: true,
      user: result.rows[0],
    });
  } catch (err) {
    console.error("UPDATE USER ERROR:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
exports.getUserDevices = async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      `
      SELECT 
        d.device_id,
        d.name,
        d.serial_number,
        d.status,
        ud.created_at
      FROM users_devices ud
      JOIN devices d ON d.device_id = ud.device_id
      WHERE ud.user_id = $1
      ORDER BY ud.created_at DESC
      `,
      [userId]
    );

    return res.json({
      success: true,
      devices: result.rows,
    });
  } catch (err) {
    console.error("GET USER DEVICES ERROR:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
exports.getUserById = async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      `
      SELECT 
        user_id,
        name,
        email,
        role,
        created_at
      FROM users
      WHERE user_id = $1
      `,
      [userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json({
      success: true,
      user: result.rows[0],
    });
  } catch (err) {
    console.error("GET USER DETAIL ERROR:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
exports.addDevice = async (req, res) => {
  console.log("BODY =", req.body);

  try {
    const { customer_id } = req.user;

    const {
      device_name,
      serial_number,
      device_type_id,
      site_id,
      slave_id
    } = req.body;

    if (!device_name || !serial_number || !device_type_id || !slave_id) {
      return res.status(400).json({
        error: "Missing required fields",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO devices (
        name,
        serial_number,
        device_type_id,
        site_id,
        slave_id
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [
        device_name,
        serial_number,
        device_type_id,
        site_id || null,
        slave_id
      ]
    );

    return res.json({
      success: true,
      device: result.rows[0],
    });

  } catch (err) {
    console.error("ADD DEVICE ERROR:", err);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
};
exports.getDevices = async (req, res) => {
  try {
    const { customer_id } = req.user;

    const result = await pool.query(
      `
      SELECT DISTINCT
        d.device_id,
        d.name,
        d.serial_number,
        d.status,
        d.created_at,
        dt.name AS device_type,
        s.name AS site_name
      FROM devices d
      JOIN sites s
        ON s.site_id = d.site_id
      LEFT JOIN device_types dt
        ON dt.id = d.device_type_id
      LEFT JOIN users_devices ud
        ON ud.device_id = d.device_id
      LEFT JOIN users u
        ON u.user_id = ud.user_id
      WHERE s.customer_id = $1
         OR u.customer_id = $1
      ORDER BY d.created_at DESC
      `,
      [customer_id]
    );

    return res.json({
      success: true,
      devices: result.rows,
    });
  } catch (err) {
    console.error("GET DEVICES ERROR:", err);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
};
exports.getDeviceById = async (req, res) => {
  try {
    const { device_id } = req.params;

    const result = await pool.query(
      `
      SELECT 
        d.device_id,
        d.name AS device_name,
        d.serial_number,
        d.ip_address,
        d.model,
        d.slave_id,
        d.created_at,

        s.site_id,
        s.name AS site_name,

        pl.product_line_id,
        pl.name AS product_line_name

      FROM devices d
      LEFT JOIN sites s 
        ON s.site_id = d.site_id

      LEFT JOIN product_lines pl 
        ON pl.product_line_id = d.product_line_id

      WHERE d.device_id = $1
      `,
      [device_id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "Device not found",
      });
    }

    return res.json({
      success: true,
      data: result.rows[0],
    });

  } catch (err) {
    console.error("GET DEVICE DETAIL ERROR:", err);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
};
exports.updateDevice = async (req, res) => {
  try {
    const { device_id } = req.params;

    const {
      device_name,
      serial_number,
      ip_address,
      model,
      site_id,
      product_line_id,
      slave_id
    } = req.body;

    // check tồn tại device
    const check = await pool.query(
      `SELECT device_id FROM devices WHERE device_id = $1`,
      [device_id]
    );

    if (!check.rows.length) {
      return res.status(404).json({
        error: "Device not found",
      });
    }

    // update
    const result = await pool.query(
      `
      UPDATE devices
      SET
        name = COALESCE($1, name),
        serial_number = COALESCE($2, serial_number),
        ip_address = COALESCE($3, ip_address),
        model = COALESCE($4, model),
        site_id = COALESCE($5, site_id),
        product_line_id = COALESCE($6, product_line_id),
        slave_id = COALESCE($7, slave_id),
        updated_at = NOW()
      WHERE device_id = $8
      RETURNING *
      `,
      [
        device_name,
        serial_number,
        ip_address,
        model,
        site_id,
        product_line_id,
        slave_id,
        device_id
      ]
    );

    return res.json({
      success: true,
      data: result.rows[0],
    });

  } catch (err) {
    console.error("UPDATE DEVICE ERROR:", err);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
};
exports.getMySites = async (req, res) => {
  try {
    const { customer_id } = req.user;

    const result = await pool.query(
      `
      SELECT
        site_id,
        name
      FROM sites
      WHERE customer_id = $1
        AND parent_id IS NULL
      ORDER BY name
      `,
      [customer_id]
    );

    res.json({
      success: true,
      data: result.rows,
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Internal server error",
    });
  }
};
exports.createSite = async (req, res) => {
  try {
    const { customer_id } = req.user;
    const { name, address } = req.body;

    if (!name) {
      return res.status(400).json({
        error: "Site name is required",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO sites (
        name,
        address,
        customer_id
      )
      VALUES ($1, $2, $3)
      RETURNING *
      `,
      [
        name,
        address || null,
        customer_id,
      ]
    );

    return res.json({
      success: true,
      site: result.rows[0],
    });

  } catch (err) {
    console.error("CREATE SITE ERROR:", err);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
};
exports.getAvailableDevicesForUser = async (req, res) => {
  try {
    const { customer_id } = req.user;

    const result = await pool.query(
      `
      SELECT DISTINCT
        d.device_id,
        d.name
      FROM devices d
      JOIN sites s
        ON s.site_id = d.site_id
      WHERE s.customer_id = $1
      ORDER BY d.name
      `,
      [customer_id]
    );

    res.json({
      success: true,
      data: result.rows,
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Internal server error",
    });
  }
};
exports.assignDeviceToUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { device_id } = req.body;

    if (!device_id) {
      return res.status(400).json({
        error: "device_id is required",
      });
    }

    const existed = await pool.query(
      `
      SELECT 1
      FROM users_devices
      WHERE user_id = $1
        AND device_id = $2
      `,
      [userId, device_id]
    );

    if (existed.rows.length) {
      return res.status(400).json({
        error: "Device already assigned",
      });
    }

    await pool.query(
      `
      INSERT INTO users_devices (
        user_id,
        device_id
      )
      VALUES ($1, $2)
      `,
      [userId, device_id]
    );

    res.json({
      success: true,
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Internal server error",
    });
  }
};
exports.removeDeviceFromUser = async (req, res) => {
  try {
    const { userId, deviceId } = req.params;

    await pool.query(
      `
      DELETE FROM users_devices
      WHERE user_id = $1
        AND device_id = $2
      `,
      [userId, deviceId]
    );

    res.json({
      success: true,
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Internal server error",
    });
  }
};
exports.getPricingPlans = async (req, res) => {
  try {
    const { customer_id } = req.user;

    const result = await pool.query(
      `
      SELECT
        pricing_plan_id,
        name,
        pricing_type,
        description,
        is_active,
        created_at
      FROM pricing_plans
      WHERE customer_id = $1
      ORDER BY created_at DESC
      `,
      [customer_id]
    );

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (err) {
    console.error("GET PRICING PLANS ERROR:", err);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
};
exports.createPricingPlan = async (req, res) => {
  try {
    const { customer_id } = req.user;

    const {
      name,
      description,
    } = req.body;

    const result = await pool.query(
      `
      INSERT INTO pricing_plans (
        customer_id,
        name,
        pricing_type,
        description
      )
      VALUES ($1,$2,$3,$4)
      RETURNING *
      `,
      [
        customer_id,
        name,
        "custom", // mặc định
        description || null,
      ]
    );

    return res.status(201).json({
      success: true,
      data: result.rows[0],
    });
  } catch (err) {
    console.error(
      "CREATE PRICING PLAN ERROR:",
      err
    );

    return res.status(500).json({
      error: "Internal server error",
    });
  }
};
exports.getPricingPlanById = async (req, res) => {
  try {
    const { customer_id } = req.user;
    const { pricing_plan_id } = req.params;

    const planResult = await pool.query(
      `
      SELECT *
      FROM pricing_plans
      WHERE pricing_plan_id = $1
        AND customer_id = $2
      `,
      [pricing_plan_id, customer_id]
    );

    if (!planResult.rows.length) {
      return res.status(404).json({
        success: false,
        error: "Pricing plan not found",
      });
    }

    const rulesResult = await pool.query(
      `
      SELECT *
      FROM pricing_rules
      WHERE pricing_plan_id = $1
      ORDER BY created_at
      `,
      [pricing_plan_id]
    );

    const rules = rulesResult.rows;

    // Lấy schedule cho từng rule
    for (const rule of rules) {
      const scheduleResult = await pool.query(
        `
        SELECT
          days,
          start_min,
          end_min
        FROM pricing_rule_schedule
        WHERE pricing_rule_id = $1
        ORDER BY start_min
        `,
        [rule.pricing_rule_id]
      );

      rule.schedules = scheduleResult.rows;
    }

    return res.json({
      success: true,
      data: {
        ...planResult.rows[0],
        rules,
      },
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};
exports.updatePricingPlan = async (req, res) => {
  try {
    const { customer_id } = req.user;
    const { pricing_plan_id } = req.params;

    const {
      name,
      description,
      is_active,
    } = req.body;

    const result = await pool.query(
      `
      UPDATE pricing_plans
      SET
        name = $1,
        description = $2,
        is_active = $3,
        updated_at = NOW()
      WHERE pricing_plan_id = $4
        AND customer_id = $5
      RETURNING *
      `,
      [
        name,
        description,
        is_active,
        pricing_plan_id,
        customer_id,
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "Pricing plan not found",
      });
    }

    return res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (err) {
    console.error("UPDATE PRICING PLAN ERROR:", err);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
};
exports.deletePricingPlan = async (req, res) => {
  try {
    const { customer_id } = req.user;
    const { pricing_plan_id } = req.params;

    const result = await pool.query(
      `
      DELETE FROM pricing_plans
      WHERE pricing_plan_id = $1
        AND customer_id = $2
      RETURNING *
      `,
      [pricing_plan_id, customer_id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "Pricing plan not found",
      });
    }

    return res.json({
      success: true,
      message: "Pricing plan deleted",
    });
  } catch (err) {
    console.error(
      "DELETE PRICING PLAN ERROR:",
      err
    );

    return res.status(500).json({
      error: "Internal server error",
    });
  }
};
function daysToMask(days) {
  if (typeof days === "number") return days;

  const bool = days.split("").map(Number);

  const bin = [1, 2, 4, 8, 16, 32, 64];

  let KQ = 0;

  for (let i = 0; i <= 6; i++) {
    KQ = KQ | (bool[i] * bin[i]);
  }

  return KQ;
}
function maskToDays(KQ) {
  const bin = [1, 2, 4, 8, 16, 32, 64];

  let result = "";

  for (let i = 0; i <= 6; i++) {
    result += (KQ & bin[i]) ? "1" : "0";
  }

  return result;
}
exports.createPricingRule = async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { pricing_plan_id } = req.params;

    const {
      rule_name,
      rule_type,
      from_value,
      to_value,
      price,
      schedules = [],
    } = req.body;

    const ruleResult = await client.query(
      `
      INSERT INTO pricing_rules (
        pricing_plan_id,
        rule_name,
        rule_type,
        from_value,
        to_value,
        price
      )
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *;
      `,
      [
        pricing_plan_id,
        rule_name,
        rule_type,
        from_value,
        to_value,
        price,
      ]
    );

    const pricingRule = ruleResult.rows[0];

  // Time Range
if (Number(rule_type) === 1) {
  for (const schedule of schedules) {
    await client.query(
      `
      INSERT INTO pricing_rule_schedule
      (
        pricing_rule_id,
        days,
        start_min,
        end_min
      )
      VALUES ($1,$2,$3,$4)
      `,
      [
        pricingRule.pricing_rule_id,
        daysToMask(schedule.days),
        Number(schedule.start_min),
        Number(schedule.end_min),
      ]
    );
  }
}
    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      data: pricingRule,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);

    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  } finally {
    client.release();
  }
};
exports.updatePricingRule = async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { pricing_rule_id } = req.params;

    const {
      rule_name,
      rule_type,
      from_value,
      to_value,
      price,
      schedules = [],
    } = req.body;

    const result = await client.query(
      `
      UPDATE pricing_rules
      SET
        rule_name = $1,
        rule_type = $2,
        from_value = $3,
        to_value = $4,
        price = $5
      WHERE pricing_rule_id = $6
      RETURNING *;
      `,
      [
        rule_name,
        rule_type,
        from_value,
        to_value,
        price,
        pricing_rule_id,
      ]
    );

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        success: false,
        error: "Pricing rule not found",
      });
    }

    await client.query(
      `
      DELETE FROM pricing_rule_schedule
      WHERE pricing_rule_id = $1
      `,
      [pricing_rule_id]
    );

  // Time Range
if (Number(rule_type) === 1) {
  for (const schedule of schedules) {
    await client.query(
      `
      INSERT INTO pricing_rule_schedule
      (
        pricing_rule_id,
        days,
        start_min,
        end_min
      )
      VALUES ($1,$2,$3,$4)
      `,
      [
        pricing_rule_id,
        daysToMask(schedule.days),
        Number(schedule.start_min),
        Number(schedule.end_min),
      ]
    );
  }
}

    await client.query("COMMIT");

    return res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);

    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  } finally {
    client.release();
  }
};
exports.deletePricingRule = async (req, res) => {
  try {
    const { pricing_rule_id } = req.params;

    const result = await pool.query(
      `
      DELETE FROM pricing_rules
      WHERE pricing_rule_id = $1
      RETURNING *;
      `,
      [pricing_rule_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: "Pricing rule not found",
      });
    }

    return res.json({
      success: true,
      message: "Rule deleted",
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};
exports.activatePricingPlan = async (req, res) => {
  const client = await pool.connect();

  try {
    const { customer_id } = req.user;
    const { pricing_plan_id } = req.params;

    await client.query("BEGIN");

    await client.query(
      `
      UPDATE pricing_plans
      SET is_active = FALSE
      WHERE customer_id = $1
      `,
      [customer_id]
    );

    await client.query(
      `
      UPDATE pricing_plans
      SET
        is_active = TRUE,
        updated_at = NOW()
      WHERE pricing_plan_id = $1
        AND customer_id = $2
      `,
      [pricing_plan_id, customer_id]
    );

    await client.query("COMMIT");

    return res.json({
      success: true,
      message: "Pricing plan activated",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);

    return res.status(500).json({
      error: "Internal server error",
    });
  } finally {
    client.release();
  }
};
