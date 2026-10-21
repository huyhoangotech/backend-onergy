const multer = require('multer');
const { diskStorage } = require('multer');
const { extname } = require('path');
const { existsSync, mkdirSync } = require('fs');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const path = require("path");
const { sendAccountCreatedEmail } = require("../../services/mailService");
const { generateRandomPassword } = require("../../services/password");
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
exports.getAllCustomers = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        c.customer_id,
        c.name,
        c.code,
        c.address,
        c.created_at,

        COUNT(DISTINCT u.user_id)   AS total_users,
        COUNT(DISTINCT s.site_id)   AS total_sites,
        COUNT(DISTINCT d.device_id) AS total_devices

      FROM customers c
      LEFT JOIN users u   ON u.customer_id = c.customer_id
      LEFT JOIN sites s   ON s.customer_id = c.customer_id
      LEFT JOIN devices d ON d.site_id = s.site_id
      GROUP BY c.customer_id
      ORDER BY c.created_at DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error("getAllCustomers error:", err);
    res.status(500).json({ error: "Failed to fetch customers" });
  }
};
exports.getUsersByCustomer = async (req, res) => {
  const { customerId } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT
        u.user_id,
        u.name,
        u.email,
        u.phone,
        u.address,
         u.image_url,   
        u.created_at,
        c.customer_id,
        c.name AS customer_name
      FROM users u
      JOIN customers c ON c.customer_id = u.customer_id
      WHERE u.customer_id = $1
      ORDER BY u.created_at DESC
      `,
      [customerId]
    );

    return res.json({
      data: result.rows,
    });
  } catch (err) {
    console.error("getUsersByCustomer error:", err);
    return res.status(500).json({
      error: "Failed to fetch users",
    });
  }
};

exports.getSitesByCustomer = async (req, res) => {
  const { customerId } = req.params;

  if (!customerId) {
    console.warn("⚠️ customerId is missing");

    return res.status(400).json({
      success: false,
      message: "customerId is required",
    });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        site_id,
        name,
        address,
        image_url,
        created_at,
        updated_at,
        parent_id
      FROM sites
      WHERE customer_id = $1
        AND parent_id IS NULL
      ORDER BY created_at DESC
      `,
      [customerId]
    );


    return res.json({
      success: true,
      total: result.rows.length,
      data: result.rows,
    });
  } catch (err) {
    console.error("❌ getSitesByCustomer error:", err.stack);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch sites",
    });
  } finally {
  }
};
exports.getCustomerById = async (req, res) => {
  const { customerId } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT
        customer_id,
        name,
        code,
        address,
        created_at
      FROM customers
      WHERE customer_id = $1
      `,
      [customerId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Customer not found",
      });
    }

    // ⚠️ TRẢ VỀ OBJECT – KHÔNG bọc data
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("getCustomerById error:", err);
    return res.status(500).json({
      error: "Failed to fetch customer",
    });
  }
};

exports.createSiteByCustomer = async (req, res) => {
  const { customerId } = req.params;
  const { name, address, image_url } = req.body;

  if (!name) {
    return res.status(400).json({
      error: "Site name is required",
    });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO sites (
        site_id,
        customer_id,
        name,
        address,
        image_url,
        created_at,
        updated_at
      )
      VALUES (
        gen_random_uuid(),
        $1,
        $2,
        $3,
        $4,
        NOW(),
        NOW()
      )
      RETURNING *
      `,
      [customerId, name, address || null, image_url || null]
    );

    return res.status(201).json({
      message: "Site created successfully",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("createSiteByCustomer error:", err);
    return res.status(500).json({
      error: "Failed to create site",
    });
  }
};
exports.createCustomer = async (req, res) => {
  const { name, code, address } = req.body;

  try {
    const result = await pool.query(
      `
      INSERT INTO customers (
        customer_id,
        name,
        code,
        address,
        created_at
      )
      VALUES (
        gen_random_uuid(),
        $1, $2, $3,
        NOW()
      )
      RETURNING *
      `,
      [name, code, address]
    );

    return res.status(201).json({
      data: result.rows[0],
    });
  } catch (err) {
    console.error("createCustomer error:", err);
    return res.status(500).json({
      error: "Failed to create customer",
    });
  }
};
exports.deleteCustomer = async (req, res) => {
  const { customerId } = req.params;

  try {
    const userCount = await pool.query(
      `SELECT COUNT(*) FROM users WHERE customer_id = $1`,
      [customerId]
    );

    if (parseInt(userCount.rows[0].count) > 0) {
      return res.json({
        success: false,
        message: "Cannot delete customer because it still has users",
      });
    }

    await pool.query(
      `DELETE FROM customers WHERE customer_id = $1`,
      [customerId]
    );

    return res.json({
      success: true,
      message: "Customer deleted successfully",
    });
  } catch (err) {
    console.error("deleteCustomer error:", err);
    return res.json({
      success: false,
      message: "Delete customer failed",
    });
  }
};
exports.updateCustomer = async (req, res) => {
  const { id } = req.params;
  const { name, code, address } = req.body;

  if (!name || !code) {
    return res.status(400).json({
      success: false,
      message: "Name and code are required",
    });
  }

  try {
    const result = await pool.query(
      `
      UPDATE customers
      SET 
        name = $1,
        code = $2,
        address = $3
      WHERE customer_id = $4
      RETURNING customer_id
      `,
      [name, code, address || null, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    res.json({
      success: true,
      message: "Customer updated successfully",
    });
  } catch (err) {
    console.error("Update customer error:", err);

    // Trường hợp code bị trùng (nếu có unique)
    if (err.code === "23505") {
      return res.status(400).json({
        success: false,
        message: "Customer code already exists",
      });
    }

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
exports.createUserForCustomer = async (req, res) => {
  const { customerId } = req.params;
  const { name, email, phone, address } = req.body;

  console.log("========== CREATE USER FOR CUSTOMER ==========");
  console.log("customerId:", customerId);
  console.log("body:", req.body);

  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required" });
  }

  try {
    const plainPassword = generateRandomPassword(8);
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    const imageUrl = req.file
      ? `/uploads/users/avatars/${req.file.filename}`
      : null;

    await pool.query("BEGIN");

    // 🔥 1. create user
    const result = await pool.query(
      `
      INSERT INTO users (
        name, email, password,
        phone, address,
        image_url, customer_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING user_id, name, email
      `,
      [
        name,
        email,
        hashedPassword,
        phone || null,
        address || null,
        imageUrl,
        customerId,
      ]
    );

    const user = result.rows[0];

    console.log("✅ User created:", user);

    // 🔥 2. lấy sites của customer
    const { rows: sites } = await pool.query(
      `SELECT site_id FROM sites WHERE customer_id = $1`,
      [customerId]
    );

    console.log("👉 Sites:", sites);

    // 🔥 3. insert users_sites
    for (const site of sites) {
      console.log(`➡️ Assign user ${user.user_id} to site ${site.site_id}`);

      await pool.query(
        `INSERT INTO users_sites (user_id, site_id)
         VALUES ($1, $2)`,
        [user.user_id, site.site_id]
      );
    }

    await pool.query("COMMIT");

    console.log("🎉 DONE create user + assign sites");

    // 🔥 4. send email
    await sendAccountCreatedEmail({
      to: email,
      password: plainPassword,
    });

    res.status(201).json({
      data: user,
    });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("createUserForCustomer error:", err);
    res.status(500).json({ error: "Create user failed" });
  }
};
exports.getDevicesByCustomer = async (req, res) => {
  const { customer_id } = req.params;

  if (!customer_id) {
    console.warn("⚠️ customer_id is missing");
    return res.status(400).json({
      success: false,
      message: "customer_id is required",
    });
  }

  try {

    const { rows: rootSites } = await pool.query(
      `
      SELECT 
        site_id,
        name,
        parent_id,
        customer_id,
        type
      FROM sites
      WHERE customer_id = $1
      ORDER BY name ASC;
      `,
      [customer_id]
    );
    console.log("\n========== STEP 2: BUILD SITE TREE ==========");

    const { rows: siteTree } = await pool.query(
      `
      WITH RECURSIVE tree AS (
        SELECT 
          s.site_id,
          s.name,
          s.parent_id,
          s.customer_id,
          s.type,
          s.name::text AS path,
          s.site_id AS root_site_id
        FROM sites s
        WHERE s.customer_id = $1
          AND s.parent_id IS NULL

        UNION ALL

        SELECT 
          s.site_id,
          s.name,
          s.parent_id,
          s.customer_id,
          s.type,
          t.path || ' > ' || s.name AS path,
          t.root_site_id
        FROM sites s
        INNER JOIN tree t
          ON s.parent_id = t.site_id
      )
      SELECT *
      FROM tree
      ORDER BY path ASC;
      `,
      [customer_id]
    );
    const { rows: rawDevices } = await pool.query(
      `
      SELECT 
        d.device_id,
        d.name,
        d.site_id
      FROM devices d
      ORDER BY d.device_id ASC;
      `
    );
    const { rows: devices } = await pool.query(
      `
      WITH RECURSIVE site_tree AS (
        SELECT 
          s.site_id,
          s.name,
          s.parent_id,
          s.type,
          s.customer_id,
          s.name::text AS path,
          s.site_id AS root_site_id
        FROM sites s
        WHERE s.customer_id = $1
          AND s.parent_id IS NULL

        UNION ALL

        SELECT 
          s.site_id,
          s.name,
          s.parent_id,
          s.type,
          s.customer_id,
          st.path || ' > ' || s.name,
          st.root_site_id
        FROM sites s
        INNER JOIN site_tree st
          ON s.parent_id = st.site_id
      )

      SELECT 
        d.device_id,
        d.name,
        dt.name AS type,

        st.path,
        st.site_id,
        st.root_site_id,
        st.type AS node_type,

        COALESCE(ds.status, 0) AS status

      FROM devices d

      JOIN site_tree st
        ON d.site_id = st.site_id

      LEFT JOIN LATERAL (
        SELECT status
        FROM device_status
        WHERE device_id = d.device_id
        ORDER BY created_at DESC
        LIMIT 1
      ) ds ON TRUE

      LEFT JOIN device_types dt
        ON d.device_type_id = dt.id

      ORDER BY st.path ASC, d.device_id ASC;
      `,
      [customer_id]
    );
    const mappedDevices = devices.map((d) => ({
      device_id: d.device_id,
      name: d.name,
      type: d.type || "Unknown",
      location: d.path,
      path: d.path,
      site_id: d.site_id,
      root_site_id: d.root_site_id,
      node_type: d.node_type,
      status: d.status === 1 ? "connected" : "disconnected",
    }));

    return res.json({
      success: true,
      total: mappedDevices.length,
      data: mappedDevices,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
exports.getProductLinesByCustomer = async (req, res) => {
  const { customer_id } = req.params;

  if (!customer_id) {
    console.warn("⚠️ customer_id is missing");

    return res.status(400).json({
      success: false,
      message: "customer_id is required",
    });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT
        pl.product_line_id,
        pl.name AS product_line_name,
        COUNT(d.device_id)::int AS device_count
      FROM devices d

      JOIN sites s
        ON s.site_id = d.site_id

      JOIN product_lines pl
        ON pl.product_line_id = d.product_line_id

      WHERE s.customer_id = $1

      GROUP BY
        pl.product_line_id,
        pl.name

      ORDER BY
        pl.name ASC;
      `,
      [customer_id]
    );

    return res.json({
      success: true,
      total: rows.length,
      data: rows,
    });

  } catch (err) {
    console.error(
      "❌ GET PRODUCT LINES BY CUSTOMER ERROR:",
      err
    );

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};