const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticateToken');
const adminController = require('../controllers/adminController');
const deviceController = require('../controllers/admin/deviceController')
const customerController = require('../controllers/admin/customerController')
const userController = require('../controllers/admin/userController')
const siteController = require('../controllers/admin/siteController')
const typeController = require('../controllers/admin/typeController')
const productController = require('../controllers/admin/productController')
const historyController = require('../controllers/admin/historyController')
const gatewayController = require("../controllers/admin/gatewayController")
const touController = require("../controllers/admin/touController");
const monthlyReportController = require("../controllers/admin/monthlyReportController");
// LOGIN
router.post('/login', touController.login);
router.post('/login-admin', adminController.loginAdmin);
router.use(authenticateToken);
// GET /api/admin/devices
router.get('/devices', deviceController.getDevices);
router.get("/dashboards",authenticateToken,touController.getDashboard);
// routes/admin.js
router.get("/devices/unassign",gatewayController.getUnassignedDevices);
router.get('/devices/unassigned', siteController.getUnassignedDevices);
router.get("/devices/:deviceId", deviceController.getDeviceDetail);

router.get("/devices/:device_id/export-history",deviceController.exportMeasurementHistory);
// POST /api/admin/devices
router.post('/devices', deviceController.createDevice);
// PUT /api/admin/devices/:id
router.put('/devices/:device_id', deviceController.updateDevice);
// DELETE /api/admin/devices/:id
router.delete('/devices/:id', deviceController.deleteDevice);
router.get("/device-types", deviceController.getDeviceTypes);
router.get("/devices/:deviceId/alarm-logs",deviceController.getAdminDeviceAlarmLogs);
router.get("/customers", customerController.getAllCustomers);
router.get("/customers/:customerId/users",customerController.getUsersByCustomer);
router.get("/customers/:customerId/sites",customerController.getSitesByCustomer);
router.get("/customers/:customerId",customerController.getCustomerById);
router.post("/customers/:customerId/sites",customerController.createSiteByCustomer);
router.get("/customers/:customer_id/devices",customerController.getDevicesByCustomer);
router.get("/customers/:customer_id/product-lines",customerController.getProductLinesByCustomer);
router.get("/sites/:siteId", siteController.getSiteById);
router.delete("/sites/:siteId", siteController.deleteSiteById);
router.put("/sites/:siteId", siteController.updateSite);
router.get("/sites/:siteId/tree", siteController.getSiteTree);
// Gán thiết bị vào site
router.post('/nodes/:nodeId/devices/assign', siteController.assignDeviceToSite);
// routes/admin/siteRoutes.js
router.delete('/nodes/:nodeId/devices/:deviceId', siteController.unassignDevices);
router.get("/sites/:siteId/devices", siteController.getDevicesBySite);
router.post('/sites/:siteId/stations', siteController.createStationBySite);
router.post('/stations/:stationId/clusters', siteController.createClusterByStation);
router.post("/sites/:siteId/nodes", siteController.createNode);
router.get( "/sites/:site_id/devices",siteController.getDevicesBySite);
router.put("/nodes/:nodeId", siteController.updateNode);
router.delete("/nodes/:nodeId", siteController.deleteNode);
router.post("/drawings",siteController.createDrawing);
router.get( "/sites/:siteId/drawing", siteController.getSiteDrawing ); 
router.put( "/sites/:siteId/drawing", siteController.saveSiteDrawing );
// routes/adminRoutes.js
router.get("/sites", siteController.getAllSites);
router.get("/users", userController.getAllUsers);
router.get("/users/:userId", userController.getUserById);
router.put("/users/:userId", userController.updateUser);
router.get("/accounts", adminController.getAllAdmins);
router.post("/accounts", adminController.createAdmin);
router.put("/accounts/:adminId", adminController.updateAdmin);
router.delete("/accounts/:adminId", authenticateToken,adminController.deleteAdmin );
router.put("/accounts/:adminId/password", adminController.updateAdminPassword);
router.post("/customers", customerController.createCustomer);
// routes/admin.js
router.post("/users", userController.createUser);
// admin.routes.js
const uploadAvatar = require("../middleware/uploads");
const upload = require("../middleware/uploads");
router.post("/customers/:customerId/users",uploadAvatar.single("avatar"), customerController.createUserForCustomer);
router.put("/users/:userId/avatar",uploadAvatar.single("avatar"),userController.updateUserAvatar);
router.post("/drawings/upload-background",upload.single("file"),siteController.uploadDrawingBackground);
router.delete("/users/:userId", userController.deleteUser);
router.delete("/customers/:customerId", customerController.deleteCustomer);
router.put("/customers/:id", customerController.updateCustomer);
router.get("/dashboard/summary", adminController.getDashboardSummary);
router.get("/dashboard/recent-alarms", adminController.getRecentAlarms);
// Lấy tất cả device types
router.get("/device-types", typeController.getDeviceTypes);
// Lấy thiết bị theo type
router.get("/device-types/:id/devices", typeController.getDevicesByType);
router.post("/product-lines", productController.createProductLine);
router.get("/device-types/:id/product-lines",productController.getProductLinesByDeviceType);
// GET all
router.get("/measurements", adminController.getMeasurements);
// CREATE
router.post("/measurements", adminController.createMeasurement);
router.put("/measurements/:id", adminController.updateMeasurement);
router.delete("/measurements/:id", adminController.deleteMeasurement);
router.get("/device-types/:id/measurements",typeController.getMeasurementsByDeviceType);
router.post("/device-types/:id/measurements",typeController.addMeasurementToDeviceType);
router.get(
  "/device-types/:id/available-measurements",
  typeController.getAvailableMeasurementsForDeviceType
);
router.delete("/device-types/:id/measurements/:measurement_id",typeController.removeMeasurementFromDeviceType);
router.get("/product-lines/:productLineId/measurements",productController.getMeasurementsWithModbus);
// POST: Thêm modbus address cho measurement trong product line
router.post("/product-lines/:productLineId/measurements",productController.addModbusAddress);
// PUT: Cập nhật modbus address
router.put("/product-lines/:productLineId/measurements/:modbusId",productController.updateModbusAddress);
// DELETE: Xóa modbus address
router.delete("/product-lines/:productLineId/measurements/:modbusId",productController.deleteModbusAddress);
router.get("/product-lines", productController.getAllProducts); 
// adminRoutes.js
router.get("/devices/:deviceId/measurements-tree",adminController.getMeasurementsTree);
router.get("/devices/:deviceId/measurements",deviceController.getDeviceMeasurements);
router.put('/users/:userId/reset_password',authenticateToken,userController.resetUserPassword);
router.put("/product-lines/:id",productController.updateProductLine);
router.delete("/product-lines/:id",productController.deleteProductLine);
router.post("/users/send-account-email",authenticateToken,userController.sendAccountEmail);
router.post("/devices/:deviceId/live-scan",productController.runLiveScan);
router.get("/customers/:customerId/storage",authenticateToken,historyController.getCustomerStorage);
router.put("/customers/:customerId/storage/toggle",authenticateToken,historyController.toggleHistoryConfig);
router.get("/customers/:customerId/storage-summary",authenticateToken,historyController.getCustomerStorageSummary);
router.get("/devices/:deviceId/history-config",historyController.getHistoryConfigByDeviceAdmin);
router.post("/history-config/:deviceId",historyController.adminCreateHistoryConfig);
router.post("/history-config/product-line/:productLineId",historyController.adminCreateHistoryConfigByProductLine);
router.patch("/history-config/:id",historyController.adminUpdateHistoryConfig);
router.delete("/history-config/:id",historyController.adminDeleteHistoryConfig);
router.get("/devices/:device_id/measurements/:measurement_id/history",historyController.getMeasurementHistory);
router.get("/customers/:customerId/max-config",historyController.getCustomerStorageQuota);
router.post("/customers/:customerId/max-config", historyController.saveCustomerStorageQuota);
router.delete("/storage-quota/:id", historyController.deleteCustomerStorageQuotaRow);
router.get("/gateways", gatewayController.getAllGateways);
router.get("/site/:site_id", gatewayController.getGatewaysBySite);
router.post("/gateways", gatewayController.createGateway);
router.put("/gateways/:gateway_id", gatewayController.updateGateway);
router.delete("/gateways/:gateway_id", gatewayController.deleteGateway);
router.get("/gateways/:gatewayId/devices",gatewayController.getDevicesByGateway);
router.put("/devices/:deviceId/assign",gatewayController.assignDeviceToGateway);
router.put("/devices/:deviceId/unassign",gatewayController.unassignDevice);
router.post("/heartbeat", gatewayController.heartbeat);
router.post("/device/register", gatewayController.registerDevice);
router.get("/protocol-types", siteController.getProtocolTypes);
router.get("/protocol-types/:code",siteController.getProtocolType);
router.post("/groups", siteController.createGroup);
router.get("/groups/:id", siteController.getGroup);
router.put("/groups/:id", siteController.updateGroup);
router.delete("/groups/:id",siteController.deleteGroup);
router.post("/sites/:siteId/assign-user",siteController.assignUserToSite);
router.get("/sites/:siteId/available-users",siteController.getAvailableUsersForSite);
router.get("/sites/:siteId/users",siteController.getUsersBySite);
router.delete("/sites/:siteId/users/:userId",siteController.removeUserFromSite);
router.get("/profile",authenticateToken,touController.getProfile);
router.get("/custom-report",authenticateToken,touController.getCustomReport);
router.get("/custom-report/export",authenticateToken,touController.exportCustomReport);
router.get("/tou_users", touController.getAllUsers);
router.post("/tou_users", touController.createUser);
router.get("/tou_devices", touController.getDevices);
router.get("/my-sites",authenticateToken,touController.getMySites);
router.post("/my-sites",authenticateToken,touController.createSite);
router.post("/tou_devices/add", touController.addDevice);
router.get("/tou_devices/:device_id",touController.getDeviceById);
router.put("/tou_devices/:device_id",touController.updateDevice);
router.get("/tou_users/:userId", touController.getUserById);
router.put("/tou_users/:userId", touController.updateUser);
router.get("/tou_users/:userId/devices", touController.getUserDevices);
router.get("/pricing_plans", touController.getPricingPlans);
router.post("/pricing_plans", touController.createPricingPlan);
router.get("/pricing_plans/:pricing_plan_id",  touController.getPricingPlanById);
router.put("/pricing_plans/:pricing_plan_id",  touController.updatePricingPlan);
router.delete("/pricing_plans/:pricing_plan_id",  touController.deletePricingPlan);
router.post("/pricing_plans/:pricing_plan_id/rules",  touController.createPricingRule);
router.put("/pricing_rules/:pricing_rule_id",  touController.updatePricingRule);
router.delete("/pricing_rules/:pricing_rule_id", touController.deletePricingRule);
router.get("/tou_users/:userId/available-devices",touController.getAvailableDevicesForUser);
router.put("/pricing_plans/:pricing_plan_id/activate",touController.activatePricingPlan);
router.post( "/tou_users/:userId/devices",touController.assignDeviceToUser);
router.delete("/tou_users/:userId/devices/:deviceId",touController.removeDeviceFromUser);
router.get("/gateways/:gateway_id", gatewayController.getGatewayById);
router.get("/monthly-report/:userId/preview",authenticateToken,monthlyReportController.previewMonthlyReport);
router.get("/monthly-report/:userId/pdf",authenticateToken,monthlyReportController.getMonthlyReportPDF);
router.post("/monthly-report/:userId/send",authenticateToken,monthlyReportController.sendMonthlyReport);
module.exports = router;
