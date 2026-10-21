// backend/modbus/readDeviceRegisters.js
const deviceClientFactory = require("./DeviceClientFactory");

async function readDeviceRegisters(deviceId, start, count) {
  const { client, slaveId, config } =
    await deviceClientFactory.getDeviceClient(deviceId);

  console.log("Gateway config:", config);
  console.log("Slave ID:", slaveId);
  console.log(`Reading ${count} regs from ${start}`);

  const res = await client.readHoldingRegisters(start, count);

  return res.data;
}

module.exports = { readDeviceRegisters };