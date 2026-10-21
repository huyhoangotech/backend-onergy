// backend/modbus/modbusDataDecoder.js

function normalizeDataType(type) {
  if (type == null) return null;

  const t = String(type).trim().toLowerCase();
  if (!t) return null;

  if (["uint16", "int16u", "word"].includes(t)) return "int16u";
  if (["int16", "short"].includes(t)) return "int16";
  if (["uint32", "int32u", "dword"].includes(t)) return "int32u";
  if (["int32", "long"].includes(t)) return "int32";
  if (["int64", "long64"].includes(t)) return "int64";
  if (["float", "float32", "single"].includes(t)) return "float32";
  if (["float64", "double"].includes(t)) return "float64";
  if (["utf8", "string"].includes(t)) return "utf8";

  return null;
}

function normalizeByteOrder(v) {
  return String(v || "BE").toUpperCase() === "LE" ? "LE" : "BE";
}

function normalizeWordOrder(v) {
  return String(v || "BE").toUpperCase() === "LE" ? "LE" : "BE";
}

function getRegisterCountByType(dataType) {
  const t = normalizeDataType(dataType);
  if (!t) return null;

  switch (t) {
    case "int16":
    case "int16u":
      return 1;

    case "int32":
    case "int32u":
    case "float32":
      return 2;

    case "int64":
    case "float64":
      return 4;

    case "utf8":
      return 1;

    default:
      return null;
  }
}

/**
 * regs: mảng số 16-bit đọc từ Modbus
 * byteOrder:
 *   - BE: byte trong từng word giữ nguyên [high, low]
 *   - LE: đảo byte trong từng word [low, high]
 *
 * wordOrder:
 *   - BE: giữ nguyên thứ tự word
 *   - LE: đảo thứ tự các word
 */
function buildBufferFromRegisters(regs, byteOrder = "BE", wordOrder = "BE") {
  let words = [...regs];

  const bo = normalizeByteOrder(byteOrder);
  const wo = normalizeWordOrder(wordOrder);

  if (wo === "LE" && words.length > 1) {
    words.reverse();
  }

  const bytes = [];

  for (const word of words) {
    const hi = (word >> 8) & 0xff;
    const lo = word & 0xff;

    if (bo === "LE") {
      bytes.push(lo, hi);
    } else {
      bytes.push(hi, lo);
    }
  }

  return Buffer.from(bytes);
}

function decodeModbusValue(registers, options = {}) {
  const {
    dataType = "int16u",
    registerCount,
    byteOrder = "BE",
    wordOrder = "BE",
    scaleFactor = 1,
  } = options;

  const type = normalizeDataType(dataType);
  const expectedCount = registerCount || getRegisterCountByType(type);

  if (!Array.isArray(registers) || registers.length < expectedCount) {
    throw new Error(
      `Not enough registers for ${type}. expected=${expectedCount}, actual=${registers?.length || 0}`
    );
  }

  const regs = registers.slice(0, expectedCount);

  // UTF8 xử lý riêng
  if (type === "utf8") {
    const buf = buildBufferFromRegisters(regs, byteOrder, wordOrder);

    return buf
      .toString("utf8")
      .replace(/\0/g, "")
      .trim();
  }

  const buf = buildBufferFromRegisters(regs, byteOrder, wordOrder);

  let value;

  switch (type) {
    case "int16":
      value = buf.readInt16BE(0);
      break;

    case "int16u":
      value = buf.readUInt16BE(0);
      break;

    case "int32":
      value = buf.readInt32BE(0);
      break;

    case "int32u":
      value = buf.readUInt32BE(0);
      break;
case "int64": {
  const rawUnsigned = buf.readBigInt64BE(0);

  // Schneider N/A sentinel
  if (rawUnsigned === 0x8000000000000000n) {
    return null;
  }

  value = Number(buf.readBigInt64BE(0));
  break;
}
    case "float32":
      value = buf.readFloatBE(0);
      break;

    case "float64":
      value = buf.readDoubleBE(0);
      break;

    default:
      value = buf.readUInt16BE(0);
      break;
  }

  const sf = Number(scaleFactor || 1);
  return value * sf;
}

module.exports = {
  normalizeDataType,
  normalizeByteOrder,
  normalizeWordOrder,
  getRegisterCountByType,
  buildBufferFromRegisters,
  decodeModbusValue,
};