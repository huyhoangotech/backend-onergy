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
exports.getAllUsers = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.user_id,
        u.name,
        u.email,
        u.phone,
        u.image_url,
        u.address,
        u.company,
        u.customer_id,
        c.name AS customer_name,
        u.created_at,
        u.updated_at
      FROM users u
      LEFT JOIN customers c ON c.customer_id = u.customer_id
      ORDER BY u.created_at DESC
    `);

    return res.json({
      data: result.rows,
    });
  } catch (err) {
    console.error("getAllUsers error:", err);
    return res.status(500).json({
      error: "Failed to fetch users",
    });
  }
};
exports.getUserById = async (req, res) => {
  const { userId } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT
        u.user_id,
        u.name,
        u.email,
        u.phone,
        u.image_url,
        u.address,
        u.company,
        u.customer_id,
        c.name AS customer_name,
        u.created_at,
        u.updated_at
      FROM users u
      LEFT JOIN customers c ON c.customer_id = u.customer_id
      WHERE u.user_id = $1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json({ data: result.rows[0] });
  } catch (err) {
    console.error("getUserById error:", err);
    return res.status(500).json({
      error: "Failed to fetch user",
    });
  }
};
exports.updateUser = async (req, res) => {
  const { userId } = req.params;
  const { name, phone, address, company } = req.body;

  try {
    const result = await pool.query(
      `
      UPDATE users
      SET
        name = COALESCE($1, name),
        phone = COALESCE($2, phone),
        address = COALESCE($3, address),
        company = COALESCE($4, company),
        updated_at = NOW()
      WHERE user_id = $5
      RETURNING
        user_id,
        name,
        email,
        phone,
        address,
        company,
        image_url,
        customer_id,
        updated_at
      `,
      [name, phone, address, company, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json({ data: result.rows[0] });
  } catch (err) {
    console.error("updateUser error:", err);
    return res.status(500).json({
      error: "Failed to update user",
    });
  }
};
exports.updateUserAvatar = async (req, res) => {
  const { userId } = req.params;

  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const imageUrl = `/uploads/users/avatars/${req.file.filename}`;

    const result = await pool.query(
      `
      UPDATE users
      SET image_url = $1,
          updated_at = NOW()
      WHERE user_id = $2
      RETURNING image_url
      `,
      [imageUrl, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json({
      data: result.rows[0],
    });
  } catch (err) {
    console.error("updateUserAvatar error:", err);
    return res.status(500).json({
      error: "Failed to upload avatar",
    });
  }
};
exports.deleteUser = async (req, res) => {
  const { userId } = req.params;

  try {
    // 1. Lấy avatar trước khi xóa
    const userResult = await pool.query(
      `SELECT image_url FROM users WHERE user_id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const imageUrl = userResult.rows[0].image_url;

    // 2. Xóa user
    await pool.query(`DELETE FROM users WHERE user_id = $1`, [userId]);

    // 3. Xóa file avatar nếu tồn tại
    if (imageUrl) {
      const filePath = path.join(__dirname, "..", imageUrl);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    return res.json({ message: "User deleted successfully" });
  } catch (err) {
    console.error("deleteUser error:", err);
    return res.status(500).json({ error: "Failed to delete user" });
  }
};
exports.createUser = async (req, res) => {
  const {
    name,
    email,
    password,
    phone,
    address,
    company,
    image_url,
  } = req.body;

  const admin = req.user;

  console.log("========== CREATE USER ==========");
  console.log("Request body:", req.body);
  console.log("Admin user:", admin);

  if (!name || !email || !password) {
    console.log("❌ Missing required fields");
    return res.status(400).json({
      error: "Name, email and password are required",
    });
  }

  try {
    // 🔹 check email
    const check = await pool.query(
      "SELECT 1 FROM users WHERE email = $1",
      [email]
    );

    console.log("Email check result:", check.rows);

    if (check.rows.length > 0) {
      console.log("❌ Email already exists");
      return res.status(400).json({
        error: "Email already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    console.log("✅ Password hashed");

    await pool.query("BEGIN");
    console.log("🚀 Transaction BEGIN");

    // 🔥 1. tạo user
    const result = await pool.query(
      `
      INSERT INTO users (
        name, email, password,
        phone, address, company, image_url,
        created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
      RETURNING user_id, name, email
      `,
      [
        name,
        email,
        hashedPassword,
        phone || null,
        address || null,
        company || null,
        image_url || null,
      ]
    );

    const user = result.rows[0];

    console.log("✅ User created:", user);

    // 🔥 2. check customer_id
    if (!admin?.customer_id) {
      console.log("❌ Missing customer_id in token");
      throw new Error("Missing customer_id in token");
    }

    console.log("👉 customer_id:", admin.customer_id);

    // 🔥 3. lấy tất cả site
    const { rows: sites } = await pool.query(
      `SELECT site_id
       FROM sites
       WHERE customer_id = $1`,
      [admin.customer_id]
    );

    console.log("👉 Sites found:", sites);
    console.log("👉 Total sites:", sites.length);

    // 🔥 4. insert users_sites
    if (sites.length > 0) {
      for (const site of sites) {
        console.log(`➡️ Assigning user ${user.user_id} to site ${site.site_id}`);

        await pool.query(
          `INSERT INTO users_sites (user_id, site_id)
           VALUES ($1, $2)`,
          [user.user_id, site.site_id]
        );
      }

      console.log("✅ Assigned user to all sites");
    } else {
      console.log("⚠️ No sites found for this customer");
    }

    await pool.query("COMMIT");
    console.log("🎉 Transaction COMMIT");

    return res.status(201).json({
      data: user,
      message: "User created and assigned to all sites",
    });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("💥 createUser error:", err);

    return res.status(500).json({
      error: "Failed to create user",
    });
  }
};
exports.resetUserPassword = async (req, res) => {
  try {
    const { userId } = req.params;
    const { newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({ message: "Missing newPassword" });
    }

    // Mã hóa mật khẩu
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Cập nhật vào DB
    const result = await pool.query(
      'UPDATE users SET password=$1 WHERE user_id=$2 RETURNING user_id, name, email',
      [hashedPassword, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      message: "Password reset successfully",
      user: result.rows[0],
    });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
exports.sendAccountEmail = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    // tạo mật khẩu random
    const password = generateRandomPassword(8);

    // ⚠️ Nếu có DB:
    // const hashedPassword = await bcrypt.hash(password, 10);
    // await saveUserToDB(email, hashedPassword);

    await sendAccountCreatedEmail({
      to: email,
      password,
    });

    res.json({
      success: true,
      message: "Account email sent",
      password, // 👉 chỉ trả về nếu bạn cần (prod nên bỏ)
    });
  } catch (err) {
    console.error("SEND MAIL ERROR:", err);
    res.status(500).json({ message: "Send email failed" });
  }
};
