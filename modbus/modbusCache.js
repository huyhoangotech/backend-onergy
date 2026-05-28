// backend/modbusReader/modbusCache.js

const modbusCache = new Map();
/*
deviceId => {
  measurementId: {
    value,
    timestamp
  }
}
*/

module.exports = {
  set(deviceId, data) {
    modbusCache.set(deviceId, data);
  },

  get(deviceId) {
    return modbusCache.get(deviceId) || {};
  }
};
