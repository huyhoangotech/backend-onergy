const connectionManager = require("./ModbusConnectionManager");
const { getDeviceConnection } = require("./DeviceConnectionService");

class DeviceClientFactory {
  async getDeviceClient(deviceId) {
    const device = await getDeviceConnection(deviceId);

    if (!device) {
      throw new Error("Device not found");
    }

    const config =
      typeof device.connection_config === "string"
        ? JSON.parse(device.connection_config)
        : device.connection_config;

    const client = await connectionManager.getConnection(config);

    // Mỗi lần dùng cho 1 device thì set slave_id theo device đó
    client.setID(device.slave_id);

    return {
      client,
      config,
      slaveId: device.slave_id,
      gatewayId: device.gateway_id,
      deviceId: device.device_id,
    };
  }
}

module.exports = new DeviceClientFactory();