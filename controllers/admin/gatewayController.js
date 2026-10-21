const { Pool } = require("pg");

const pool = new Pool({
  user: "postgres",
host: "171.244.141.14",
  database: "Recloser app",
  password: "1122",
  port: 5432,
});

/* =========================
GET ALL GATEWAYS
========================= */
exports.getAllGateways = async (req, res) => {
  try {

    const { site_id } = req.query;

    let result;

    if (site_id) {
      result = await pool.query(
        `
        SELECT 
          g.*,
          s.name AS site_name
        FROM gateways g
        LEFT JOIN sites s ON g.site_id = s.site_id
        WHERE g.site_id = $1
        `,
        [site_id]
      );
    } else {
      result = await pool.query(
        `
        SELECT 
          g.*,
          s.name AS site_name
        FROM gateways g
        LEFT JOIN sites s ON g.site_id = s.site_id
        ORDER BY g.created_at DESC
        `
      );
    }

    res.json(result.rows);

  } catch (err) {
    console.error("Gateway error:", err);
    res.status(500).json({ message: "Error fetching gateways" });
  }
};



/* =========================
GET GATEWAYS BY SITE
========================= */
exports.getGatewaysBySite = async (req, res) => {
  try {
    const { site_id } = req.params;

    const { rows } = await pool.query(
      `SELECT * FROM gateways WHERE site_id=$1`,
      [site_id]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching site gateways" });
  }
};

/* =========================
CREATE GATEWAY
========================= */
exports.createGateway = async (req, res) => {
  try {

    const {
      site_id,
      name,
      protocol_code,
      connection_config
    } = req.body;

    const { rows } = await pool.query(
      `
      INSERT INTO gateways
      (
        site_id,
        name,
        protocol_code,
        connection_config,
        status
      )
      VALUES
      (
        $1,
        $2,
        $3,
        $4,
        0
      )
      RETURNING *
      `,
      [
        site_id,
        name,
        protocol_code,
        connection_config
      ]
    );

    res.status(201).json(rows[0]);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      message: "Error creating gateway"
    });

  }
};

/* =========================
UPDATE GATEWAY
========================= */
exports.updateGateway = async (req, res) => {
  try {

    const { gateway_id } = req.params;

    const {
      site_id,
      name,
      protocol_code,
      connection_config
    } = req.body;

    const { rows } = await pool.query(
      `
      UPDATE gateways
      SET
        site_id = $1,
        name = $2,
        protocol_code = $3,
        connection_config = $4,
        updated_at = NOW()
      WHERE gateway_id = $5
      RETURNING *
      `,
      [
        site_id,
        name,
        protocol_code,
        connection_config,
        gateway_id
      ]
    );

    if (!rows.length) {
      return res.status(404).json({
        message: "Gateway not found"
      });
    }

    res.json(rows[0]);

  } catch (err) {

    console.error(
      "🔥 Update gateway error:",
      err
    );

    res.status(500).json({
      message: "Error updating gateway"
    });

  }
};
exports.getGatewayById = async (req, res) => {
  try {

    const { gateway_id } = req.params;

    const { rows } = await pool.query(
      `
      SELECT
        g.gateway_id,
        g.site_id,
        s.name AS site_name,
        g.name,
        g.protocol_code,
        g.connection_config,
        g.status,
        g.created_at,
        g.updated_at
      FROM gateways g
      LEFT JOIN sites s
        ON s.site_id = g.site_id
      WHERE g.gateway_id = $1
      `,
      [gateway_id]
    );

    if (!rows.length) {
      return res.status(404).json({
        message: "Gateway not found"
      });
    }

    return res.json(rows[0]);

  } catch (err) {

    console.error(
      "🔥 Get gateway error:",
      err
    );

    return res.status(500).json({
      message: "Error fetching gateway"
    });

  }
};
/* =========================
DELETE GATEWAY
========================= */
exports.deleteGateway = async (req, res) => {
  try {
    const { gateway_id } = req.params;

    await pool.query(
      `DELETE FROM gateways WHERE gateway_id=$1`,
      [gateway_id]
    );

    res.json({ message: "Gateway deleted" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error deleting gateway" });
  }
};

exports.savePushToken = async (req, res) => {
  const { token } = req.body;

  // user_id lấy từ JWT (chuẩn nhất)
  const user_id = req.user?.id;

  if (!token) {
    return res.status(400).json({ error: "Missing token" });
  }

  try {
    await pool.query(`
      INSERT INTO user_push_tokens (user_id, push_token)
      VALUES ($1, $2)
      ON CONFLICT (push_token) DO NOTHING
    `, [user_id, token]);

    res.json({ success: true });

  } catch (err) {
    console.error("Save token error:", err);
    res.status(500).json({ error: "Server error" });
  }
};
exports.getDevicesByGateway = async (req, res) => {
  const { gatewayId } = req.params;

  try {
    const { rows } = await pool.query(
      `
      SELECT 
        d.device_id,
        d.name,
        d.slave_id,
        COALESCE(ds.status, 0) AS status
      FROM devices d
      LEFT JOIN LATERAL (
        SELECT status
        FROM device_status
        WHERE device_id = d.device_id
        ORDER BY created_at DESC
        LIMIT 1
      ) ds ON true
      WHERE d.gateway_id = $1
      ORDER BY d.created_at DESC
      `,
      [gatewayId]
    );

    res.json(rows);

  } catch (err) {
    console.error("Get devices error:", err);
    res.status(500).json({ error: "Failed to load devices" });
  }
};
exports.assignDeviceToGateway = async (req, res) => {
  const { deviceId } = req.params;
  const { gateway_id, slave_id } = req.body;

  try {
    // 1. Lấy thông tin device
    const { rows } = await pool.query(
      `
      SELECT gateway_id, slave_id
      FROM devices
      WHERE device_id = $1
      `,
      [deviceId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Device not found" });
    }

    const device = rows[0];

    // 2. Đã thuộc gateway khác
    if (device.gateway_id && device.gateway_id !== gateway_id) {
      return res.status(400).json({
        error: "Device already assigned to another gateway",
      });
    }

    // 3. Nếu slave_id đang null thì bắt frontend truyền lên
    const finalSlaveId =
      device.slave_id == null ? slave_id : device.slave_id;

    if (finalSlaveId == null) {
      return res.status(400).json({
        error: "Slave ID is required",
      });
    }

    // 4. Check duplicate slave trong gateway
    const duplicate = await pool.query(
      `
      SELECT 1
      FROM devices
      WHERE gateway_id = $1
        AND slave_id = $2
        AND device_id <> $3
      `,
      [gateway_id, finalSlaveId, deviceId]
    );

    if (duplicate.rowCount > 0) {
      return res.status(400).json({
        error: "Duplicate slave_id in this gateway",
      });
    }

    // 5. Assign + chỉ update slave_id nếu đang null
    const result = await pool.query(
      `
      UPDATE devices
      SET
        gateway_id = $1,
        slave_id = COALESCE(slave_id, $2)
      WHERE device_id = $3
      RETURNING *
      `,
      [gateway_id, finalSlaveId, deviceId]
    );

    res.json(result.rows[0]);

  } catch (err) {
    console.error("Assign error:", err);
    res.status(500).json({ error: "Assign failed" });
  }
};
exports.unassignDevice = async (req, res) => {
  const { deviceId } = req.params;

  try {
    await pool.query(
      `
      UPDATE devices
      SET gateway_id = NULL
      WHERE device_id = $1
      `,
      [deviceId]
    );

    res.json({ success: true });

  } catch (err) {
    console.error("Unassign error:", err);
    res.status(500).json({ error: "Unassign failed" });
  }
};
exports.getUnassignedDevices = async (req, res) => {
  try {

    const { rows } = await pool.query(`
      SELECT device_id, name, slave_id
      FROM devices
      WHERE gateway_id IS NULL
    `);

    res.json(rows);

  } catch (err) {
    console.error("Get unassigned devices error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
exports.heartbeat = async (req, res) => {
  const { device_id, lan_ip, public_ip, status, timestamp } = req.body;

  if (!device_id) {
    return res.status(400).json({
      success: false,
      message: "device_id is required",
    });
  }

  try {
    await pool.query(
      `
      INSERT INTO device_heartbeat (
        device_id,
        lan_ip,
        public_ip,
        status,
        updated_at
      )
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (device_id)
      DO UPDATE SET
        lan_ip = EXCLUDED.lan_ip,
        public_ip = EXCLUDED.public_ip,
        status = EXCLUDED.status,
        updated_at = NOW()
      `,
      [device_id, lan_ip, public_ip, status || "ONLINE"]
    );

    return res.json({
      success: true,
      message: "Heartbeat received",
    });
  } catch (err) {
    console.error("Heartbeat error:", err.message);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
exports.registerDevice = async (req, res) => {
  try {
    const { device_id, public_ip, local_ips } = req.body;

    // Validate
    if (!device_id) {
      return res.status(400).json({
        success: false,
        message: "device_id is required",
      });
    }

    console.log("📡 Device register:", {
      device_id,
      public_ip,
      local_ips,
    });

    // 🔥 Upsert (tránh trùng device)
    const existingIndex = devices.findIndex(
      (d) => d.device_id === device_id
    );

    if (existingIndex !== -1) {
      devices[existingIndex] = {
        ...devices[existingIndex],
        public_ip,
        local_ips,
        last_seen: new Date(),
      };
    } else {
      devices.push({
        device_id,
        public_ip,
        local_ips,
        last_seen: new Date(),
      });
    }

    return res.json({
      success: true,
      message: "Device registered",
    });
  } catch (error) {
    console.error("❌ Register device error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};