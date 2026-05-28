// middleware/authenticateToken.js
const jwt = require('jsonwebtoken');

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Lấy token sau "Bearer"

    if (!token) {
        return res.status(403).json({ error: 'Access denied, no token provided' });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }

        // ✅ Gắn thông tin user đã giải mã vào req.user
        req.user = user;
        next();
    });
}

module.exports = authenticateToken;
