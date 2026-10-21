const ModbusRTU = require("modbus-serial");

const client = new ModbusRTU();

const IP = "192.168.1.100";
const PORT = 502;
const SLAVE_ID = 2;

async function test() {
  try {
    console.log("Connecting...");

    await client.connectTCP(IP, { port: PORT });

    console.log("Connected");

    client.setID(SLAVE_ID);

    // Các register trong tài liệu
    const registers = [
      2999, // Current A (Register No.3000)
      3001, // Current B
      3003, // Current C
      3019, // Voltage AB
      3021, // Voltage BC
      3023, // Voltage CA
      3027, // Voltage AN
      3029, // Voltage BN
      3031, // Voltage CN
      3053, // Active Power A
      3055, // Active Power B
      3057, // Active Power C
      3059, // Total Active Power
      3075, // Total Apparent Power
      3083, // Total Power Factor
    ];

    for (const addr of registers) {
      try {
        const res = await client.readHoldingRegisters(addr, 2);

        console.log(
          `Register ${addr} -> [${res.data[0]}, ${res.data[1]}]`
        );
      } catch (err) {
        console.log(`Register ${addr}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    client.close();
  }
}

test();