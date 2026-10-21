// routes/customerRoutes.js
const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const historyController = require('../controllers/customer/historyController')
// import controller mới
const authenticateToken = require('../middleware/authenticateToken');
// Route đăng nhập cho customer
router.post('/login-customer', customerController.loginCustomer);

router.get('/sites/:siteId/recent-alerts', customerController.getRecentAlerts);
// Lấy tất cả devices của user
router.get('/all-devices', authenticateToken, customerController.getAllDevices);


router.get("/all-devices-tree",authenticateToken,customerController.getAllDevicesTree);
// ----- Thêm route lấy parent measurements cho 1 thiết bị -----

router.get('/devices/:deviceId/parent-measurements',authenticateToken,customerController.getParentMeasurements);
router.get("/devices/:deviceId/measurements/:parentId",authenticateToken,customerController.getDeviceMeasurements);
router.post("/alarms/check", authenticateToken, customerController.checkDeviceAlarms);
router.get("/alarms/logs",authenticateToken,customerController.getAlarmLogs);
// Lấy chi tiết 1 alarm theo ID
router.get("/alarms/logs/:id",authenticateToken,customerController.GetAlarmDetail);
router.get('/devices/:id', authenticateToken, customerController.getDeviceById);
router.put('/devices/:deviceId/rename', authenticateToken, customerController.renameDevice);
router.get("/profile",authenticateToken, customerController.getProfile);
router.put("/change-password",authenticateToken,customerController.changePassword);
  const uploadAvatar = require("../middleware/uploads");
  router.put("/profile", authenticateToken, uploadAvatar.single("avatar"), customerController.updateProfile);
  router.post("/alarms", authenticateToken, customerController.saveAlarm);
  // routes/alarmRoutes.js
  router.get("/alarms/device/:deviceId/measurement/:measurementId",authenticateToken,customerController.getAlarmByDeviceMeasurement);
router.get("/history-config",authenticateToken,customerController.getHistoryConfigByDevice);

router.post( "/devices/:deviceId/history-config", authenticateToken, customerController.createHistoryConfig);

router.patch("/devices/:deviceId/history-config/:id",authenticateToken,customerController.updateHistoryConfig);

router.delete("/devices/:deviceId/history-config/:id",authenticateToken,customerController.deleteHistoryConfig);
router.get("/devices/:device_id/measurements/:measurement_id/history/1h",historyController.getMeasurementHistory1H);
router.get("/devices/:device_id/measurements/:measurement_id/infor",historyController.getDeviceMeasurementInfo );
router.get("/devices/:device_id/measurements/:measurement_id/history",historyController.getMeasurementHistory);
router.get("/devices/:deviceId/alarms",authenticateToken,customerController.getDeviceAlarmLogs)
router.get("/user-devices", authenticateToken, customerController.getUserDevices);
router.post("/config", authenticateToken, customerController.upsertUserDeviceConfig);
router.get("/storage-quota",authenticateToken,historyController.getMobileStorageQuota);
router.post("/save-token",authenticateToken,customerController.savePushToken);
router.post("/claim", authenticateToken, customerController.claimDeviceBySerial);
router.get("/by-serial/:serial",authenticateToken,customerController.getDeviceBySerial);
router.get("/my-sites", authenticateToken, customerController.getSitesByUser);
  module.exports = router;
  