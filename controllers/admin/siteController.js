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
exports.getSiteById = async (req, res) => {
  const { siteId } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT *
      FROM sites
      WHERE site_id = $1
      `,
      [siteId]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: "Site not found" });

    return res.json({ data: result.rows[0] });
  } catch (err) {
    console.error("getSiteById error:", err);
    return res.status(500).json({ error: "Failed to fetch site" });
  }
};
exports.deleteSiteById = async (req, res) => {
  const { siteId } = req.params;

  try {
    await pool.query(
      `
      DELETE FROM sites
      WHERE site_id = $1
      `,
      [siteId]
    );

    return res.json({ message: "Site deleted successfully" });
  } catch (err) {
    console.error("deleteSiteById error:", err);
    return res.status(500).json({ error: "Failed to delete site" });
  }
};
// controller/sites.js
exports.updateSite = async (req, res) => {
  const { siteId } = req.params;
  const { name, address, image_url } = req.body;

  try {
    const result = await pool.query(
      `
      UPDATE sites
      SET name = $1, address = $2, image_url = $3, updated_at = NOW()
      WHERE site_id = $4
      RETURNING *
      `,
      [name, address, image_url, siteId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Site not found" });
    }

    return res.json({ data: result.rows[0] });
  } catch (err) {
    console.error("updateSite error:", err);
    return res.status(500).json({ error: "Failed to update site" });
  }
};

exports.getUnassignedDevices = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT device_id, name, model, serial_number, status
       FROM devices
       WHERE site_id IS NULL
       ORDER BY created_at DESC`
    );

    return res.json({ data: result.rows });
  } catch (err) {
    console.error("getUnassignedDevices error:", err);
    return res.status(500).json({ error: "Failed to fetch unassigned devices" });
  }
};
exports.assignDeviceToSite = async (req, res) => {
  const { nodeId } = req.params;
  const { device_ids } = req.body;

  if (!Array.isArray(device_ids) || device_ids.length === 0) {
    return res.status(400).json({ error: "No devices selected" });
  }

  try {
    // check node tồn tại
    const nodeCheck = await pool.query(
      `SELECT site_id FROM sites WHERE site_id = $1`,
      [nodeId]
    );

    if (nodeCheck.rowCount === 0) {
      return res.status(404).json({ error: "Node not found" });
    }

    const result = await pool.query(
      `
      UPDATE devices
      SET site_id = $1, updated_at = NOW()
      WHERE device_id = ANY($2::uuid[])
      RETURNING *
      `,
      [nodeId, device_ids]
    );

    return res.json({
      message: "Devices assigned successfully",
      data: result.rows,
    });
  } catch (err) {
    console.error("assignDeviceToNode error:", err);
    return res.status(500).json({
      error: "Failed to assign devices",
    });
  }
};
// controllers/admin/siteController.js
exports.unassignDevices = async (req, res) => {
  const { nodeId, deviceId } = req.params;

  try {
    const result = await pool.query(
      `
      UPDATE devices
      SET site_id = NULL, updated_at = NOW()
      WHERE device_id = $1 AND site_id = $2
      RETURNING *
      `,
      [deviceId, nodeId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Device not found or not assigned to this node",
      });
    }

    return res.json({
      message: "Device unassigned successfully",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("unassignDevice error:", err);
    return res.status(500).json({
      error: "Failed to unassign device",
    });
  }
};
// GET /api/admin/sites/:siteId/devices
exports.getDevicesBySite = async (req, res) => {
  const { siteId } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT
        d.device_id,
        d.name,
        d.serial_number,
        d.ip_address,
        d.status,
        d.device_type_id,
        d.model,

        -- 🔥 device có đang lưu measurement không
        EXISTS (
          SELECT 1
          FROM history_config hc
          WHERE hc.device_id = d.device_id
            AND hc.enabled = true
        ) AS is_using_storage,

        -- 🔥 bao nhiêu measurement đang lưu
        COUNT(hc.measurement_id)
          FILTER (WHERE hc.enabled = true)
          AS saved_measurements

      FROM devices d
      LEFT JOIN history_config hc
        ON hc.device_id = d.device_id

      WHERE d.site_id = $1

      GROUP BY d.device_id

      ORDER BY
        is_using_storage DESC,
        saved_measurements DESC,
        d.created_at DESC
      `,
      [siteId]
    );

    return res.json({ data: result.rows });

  } catch (err) {
    console.error("getDevicesBySite error:", err);
    return res.status(500).json({ error: "Failed to fetch devices" });
  }
};
// controllers/adminController.js
exports.getAllSites = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        s.site_id,
        s.name,
        s.address,
        c.name AS customer_name,
        s.created_at,
        COUNT(d.device_id) AS total_devices
      FROM sites s
      LEFT JOIN customers c ON s.customer_id = c.customer_id
      LEFT JOIN devices d ON s.site_id = d.site_id
      WHERE s.parent_id IS NULL   -- 🔥 CHỈ LẤY SITE
      GROUP BY s.site_id, c.name
      ORDER BY s.created_at DESC
    `);

    return res.json({
      data: result.rows,
    });
  } catch (err) {
    console.error("getAllSites error:", err);
    return res.status(500).json({
      error: "Failed to fetch sites",
    });
  }
};
exports.assignUserToSite = async (req, res) => {
  const { siteId } = req.params;
  const { user_id } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: "user_id is required" });
  }

  try {
    // 🔥 check đã tồn tại chưa
    const check = await pool.query(
      `SELECT 1 FROM users_sites
       WHERE user_id = $1 AND site_id = $2`,
      [user_id, siteId]
    );

    if (check.rowCount > 0) {
      return res.status(400).json({
        error: "User already assigned to this site",
      });
    }

    // 🔥 insert
    await pool.query(
      `INSERT INTO users_sites (user_id, site_id)
       VALUES ($1, $2)`,
      [user_id, siteId]
    );

    return res.json({
      success: true,
      message: "User assigned to site successfully",
    });
  } catch (err) {
    console.error("assignUserToSite error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};
exports.getAvailableUsersForSite = async (req, res) => {
  const { siteId } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT u.user_id, u.name, u.email
      FROM users u
      JOIN sites s ON s.customer_id = u.customer_id
      WHERE s.site_id = $1

      AND u.user_id NOT IN (
        SELECT user_id
        FROM users_sites
        WHERE site_id = $1
      )

      ORDER BY u.created_at DESC
      `,
      [siteId]
    );

    return res.json({
      data: result.rows,
    });
  } catch (err) {
    console.error("getAvailableUsersForSite error:", err);
    return res.status(500).json({
      error: "Failed to fetch users",
    });
  }
};
exports.getUsersBySite = async (req, res) => {
  const { siteId } = req.params;

  if (!siteId) {
    return res.status(400).json({
      error: "siteId is required",
    });
  }

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
        u.created_at
      FROM users u
      INNER JOIN users_sites us 
        ON us.user_id = u.user_id
      WHERE us.site_id = $1
      ORDER BY u.created_at DESC
      `,
      [siteId]
    );

    return res.json({
      data: result.rows,
    });
  } catch (err) {
    console.error("getUsersBySite error:", err);
    return res.status(500).json({
      error: "Failed to fetch users for site",
    });
  }
};
exports.removeUserFromSite = async (req, res) => {
  const { siteId, userId } = req.params;

  try {
    await pool.query(
      `DELETE FROM users_sites
       WHERE site_id = $1 AND user_id = $2`,
      [siteId, userId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("removeUserFromSite error:", err);
    res.status(500).json({ error: "Server error" });
  }
};
exports.getSiteTree = async (req, res) => {
  const { siteId } = req.params;

  try {
    const result = await pool.query(
      `
      WITH RECURSIVE tree AS (
       SELECT 
  s.site_id,
  s.name,
  CASE 
   WHEN s.site_id = $1 THEN 'site'
    ELSE s.type
  END as type,
  s.parent_id
FROM sites s
WHERE s.site_id = $1

        UNION ALL

        SELECT 
          s.site_id,
          s.name,
          s.type,
          s.parent_id
        FROM sites s
        JOIN tree t ON s.parent_id = t.site_id
      )
      SELECT 
        t.site_id,
        t.name,
        t.type,
        t.parent_id,
        d.device_id,
        d.name AS device_name,
        d.status,
        d.model,
        d.serial_number,
        d.ip_address
      FROM tree t
      LEFT JOIN devices d ON d.site_id = t.site_id
      ORDER BY t.parent_id NULLS FIRST, t.type
      `,
      [siteId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Site not found" });
    }

    return res.json({
      data: result.rows,
    });
  } catch (err) {
    console.error("getSiteTree error:", err);
    return res.status(500).json({
      error: "Failed to fetch site tree",
    });
  }
};
exports.createStationBySite = async (req, res) => {
  const { siteId } = req.params;
  const { name, address, image_url } = req.body;

  if (!name) {
    return res.status(400).json({
      error: "Station name is required",
    });
  }

  try {
    // 🔥 lấy customer_id từ site cha
    const parent = await pool.query(
      `SELECT customer_id FROM sites WHERE site_id = $1 AND type = 'site'`,
      [siteId]
    );

    if (parent.rowCount === 0) {
      return res.status(404).json({ error: "Parent site not found" });
    }

    const result = await pool.query(
      `
      INSERT INTO sites (
        site_id,
        customer_id,
        name,
        type,
        parent_id,
        address,
        image_url,
        created_at,
        updated_at
      )
      VALUES (
        gen_random_uuid(),
        $1,
        $2,
        'station',
        $3,
        $4,
        $5,
        NOW(),
        NOW()
      )
      RETURNING *
      `,
      [
        parent.rows[0].customer_id,
        name,
        siteId,
        address || null,
        image_url || null,
      ]
    );

    return res.status(201).json({
      message: "Station created successfully",
      data: result.rows[0],
    });

  } catch (err) {
    console.error("createStationBySite error:", err);
    return res.status(500).json({
      error: "Failed to create station",
    });
  }
};
exports.createClusterByStation = async (req, res) => {
  const { stationId } = req.params;
  const { name, address, image_url } = req.body;

  if (!name) {
    return res.status(400).json({
      error: "Cluster name is required",
    });
  }

  try {
    // 🔥 lấy customer_id từ station cha
    const parent = await pool.query(
      `SELECT customer_id FROM sites WHERE site_id = $1 AND type = 'station'`,
      [stationId]
    );

    if (parent.rowCount === 0) {
      return res.status(404).json({ error: "Parent station not found" });
    }

    const result = await pool.query(
      `
      INSERT INTO sites (
        site_id,
        customer_id,
        name,
        type,
        parent_id,
        address,
        image_url,
        created_at,
        updated_at
      )
      VALUES (
        gen_random_uuid(),
        $1,
        $2,
        'cluster',
        $3,
        $4,
        $5,
        NOW(),
        NOW()
      )
      RETURNING *
      `,
      [
        parent.rows[0].customer_id,
        name,
        stationId,
        address || null,
        image_url || null,
      ]
    );

    return res.status(201).json({
      message: "Cluster created successfully",
      data: result.rows[0],
    });

  } catch (err) {
    console.error("createClusterByStation error:", err);
    return res.status(500).json({
      error: "Failed to create cluster",
    });
  }
};
exports.createNode = async (req, res) => {
  const { siteId } = req.params;
  const { name, type, parent_id } = req.body;

  if (!name || !type) {
    return res.status(400).json({ error: "Missing data" });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO sites (
        site_id,
        name,
        type,
        parent_id,
        customer_id,
        created_at,
        updated_at
      )
      SELECT
        gen_random_uuid(),
        $1,
        $2,
        $3,
        s.customer_id,
        NOW(),
        NOW()
      FROM sites s
      WHERE s.site_id = $4
      RETURNING *
      `,
      [name, type, parent_id || null, siteId]
    );

    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Create node failed" });
  }
};
exports.updateNode = async (req, res) => {
  const { nodeId } = req.params;
  const { name, parent_id } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Name is required" });
  }

  try {
    const result = await pool.query(
      `
      UPDATE sites
      SET 
        name = $1,
        parent_id = COALESCE($2, parent_id),
        updated_at = NOW()
      WHERE site_id = $3
      RETURNING *
      `,
      [name, parent_id || null, nodeId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Node not found" });
    }

    return res.json({
      message: "Node updated successfully",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("updateNode error:", err);
    return res.status(500).json({ error: "Failed to update node" });
  }
};
exports.deleteNode = async (req, res) => {
  const { nodeId } = req.params;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. set device về NULL (tránh orphan)
    await client.query(
      `
      UPDATE devices
      SET site_id = NULL,
          updated_at = NOW()
      WHERE site_id = $1
      `,
      [nodeId]
    );

    // 2. delete child nodes (nếu có) - recursive
    await client.query(
      `
      WITH RECURSIVE children AS (
        SELECT site_id FROM sites WHERE site_id = $1
        UNION ALL
        SELECT s.site_id
        FROM sites s
        INNER JOIN children c ON s.parent_id = c.site_id
      )
      DELETE FROM sites
      WHERE site_id IN (SELECT site_id FROM children)
      `,
      [nodeId]
    );

    await client.query("COMMIT");

    return res.json({
      message: "Node deleted successfully",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("deleteNode error:", err);
    return res.status(500).json({ error: "Failed to delete node" });
  } finally {
    client.release();
  }
};
exports.createDrawing = async (req, res) => {
  try {
    const {
      site_id,
      name,
      background_url,
      data,
    } = req.body;

    if (!site_id) {
      return res.status(400).json({
        success: false,
        message: "site_id is required",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO drawings (
        site_id,
        name,
        background_url,
        data
      )
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [
        site_id,
        name || "Untitled Drawing",
        background_url || null,
        data,
      ]
    );

    return res.status(201).json({
      success: true,
      data: result.rows[0],
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Failed to create drawing",
    });
  }
};
exports.uploadDrawingBackground = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    const fileUrl = `/uploads/drawings/${req.file.filename}`;

    return res.json({
      success: true,
      data: {
        url: fileUrl,
      },
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Upload failed",
    });
  }
};

exports.getSiteDrawing = async (req, res) => {
  const { siteId } = req.params;

  try {
    const { rows } = await pool.query(
      `
      SELECT *
      FROM drawings
      WHERE site_id = $1
      LIMIT 1
      `,
      [siteId]
    );

    if (rows.length === 0) {
      return res.json({
        success: true,
        data: {
          background_url: null,
          objects: [],
          edges: [],
        },
      });
    }

    const drawing = rows[0];

    let data = {};

    try {
      data =
        typeof drawing.data === "string"
          ? JSON.parse(drawing.data || "{}")
          : drawing.data || {};
    } catch (e) {
      console.error("PARSE DRAWING ERROR:", e);
      data = {};
    }

    res.json({
      success: true,
      data: {
        background_url:
          drawing.background_url ||
          data.backgroundUrl ||
          null,

        objects:
          data.objects ||
          data.nodes ||
          [],

        edges:
          data.edges || [],
      },
    });
  } catch (err) {
    console.error("GET DRAWING ERROR:", err);

    res.status(500).json({
      success: false,
      message: "Failed to load drawing",
    });
  }
};
  
exports.saveSiteDrawing = async (req, res) => {
  const { siteId } = req.params;

  const {
    name,
    background_url,
    objects,
  } = req.body;

  try {
    const { rows } = await pool.query(
      `
      SELECT id
      FROM drawings
      WHERE site_id = $1
      LIMIT 1
      `,
      [siteId]
    );

    // UPDATE
    if (rows.length > 0) {
      await pool.query(
        `
        UPDATE drawings
        SET
          name = $1,
          background_url = $2,
          data = $3,
          updated_at = NOW()
        WHERE site_id = $4
        `,
        [
          name || "Main Drawing",
          background_url,
          JSON.stringify({
            objects,
          }),
          siteId,
        ]
      );
    }

    // INSERT
    else {
      await pool.query(
        `
        INSERT INTO drawings (
          site_id,
          name,
          background_url,
          data
        )
        VALUES ($1, $2, $3, $4)
        `,
        [
          siteId,
          name || "Main Drawing",
          background_url,
          JSON.stringify({
            objects,
          }),
        ]
      );
    }

    res.json({
      success: true,
      message: "Drawing saved successfully",
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: "Failed to save drawing",
    });
  }
};

