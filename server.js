// server.js
// 🔥 MUST BE FIRST LINES 🔥
process.on("unhandledRejection", (reason) => {
  console.error("🔥 Unhandled Rejection:", reason?.message || reason);
});

process.on("uncaughtException", (err) => {
  console.error("🔥 Uncaught Exception:", err.message);
});

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

// Routes
const authRoutes = require('./routes/authRoutes');
const customerRoutes = require('./routes/customerRoutes');
const adminRoutes = require('./routes/adminRoutes')
const { startModbusScheduler } = require("./modbusScheduler");

// Socket handler
const socketHandler = require('./socket');
const { startDeviceMonitor } = require("./deviceMonitor");
const app = express();
const { startAlarmWorker } = require("./alarmWorker");
// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes cơ bản
app.use('/api/customer', customerRoutes);
app.use('/api/admin', adminRoutes);
// Health check
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => {
  res.send('Backend is running');
});
// ---------- Socket.io ----------
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

socketHandler(io);
startAlarmWorker().catch(console.error);
// ---------- Start server ----------
const PORT = process.env.PORT || 3000;

console.log("PORT đang chạy là:", PORT);

server.listen(PORT, "0.0.0.0", () => {
  console.log("Server running...");
  startModbusScheduler();
});
