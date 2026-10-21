// backend/modbus/ModbusConnectionManager.js
const ModbusRTU = require("modbus-serial");

class ModbusConnectionManager {
  constructor() {
    this.connections = new Map();
  }

  buildKey(config) {
    if (config.protocol === "modbus_tcp") {
      return `tcp:${config.host}:${config.port || 502}`;
    }

    if (config.protocol === "modbus_rtu") {
      return `rtu:${config.comPort}:${config.baudRate || 9600}:${config.parity || "none"}:${config.dataBits || 8}:${config.stopBits || 1}`;
    }

    throw new Error("Unsupported protocol");
  }

  async createConnection(config) {
    const client = new ModbusRTU();

    if (config.protocol === "modbus_tcp") {
      await client.connectTCP(config.host, {
        port: config.port || 502,
      });
    } else if (config.protocol === "modbus_rtu") {
      await client.connectRTUBuffered(config.comPort, {
        baudRate: config.baudRate || 9600,
        parity: config.parity || "none",
        dataBits: config.dataBits || 8,
        stopBits: config.stopBits || 1,
      });
    } else {
      throw new Error("Unsupported protocol");
    }

    client.setTimeout(config.timeout || 2000);

    console.log("✅ Connected:", this.buildKey(config));

    return client;
  }

  async getConnection(config) {
    const key = this.buildKey(config);

    let client = this.connections.get(key);

    if (client && client.isOpen) {
      return client;
    }

    client = await this.createConnection(config);
    this.connections.set(key, client);

    return client;
  }

  async disconnect(config) {
    const key = this.buildKey(config);
    const client = this.connections.get(key);

    if (!client) return;

    try {
      client.close();
    } catch (err) {
      console.error("disconnect error:", err.message);
    }

    this.connections.delete(key);
  }

  async disconnectAll() {
    for (const client of this.connections.values()) {
      try {
        client.close();
      } catch (err) {
        console.error("disconnectAll error:", err.message);
      }
    }

    this.connections.clear();
  }
}

module.exports = new ModbusConnectionManager();