const { Pool } = require("pg");

const {
    processTOU,
    loadPricingCache,
    TOTAL_MEASUREMENT_ID
} =require("../services/touService");

const pool = new Pool({
    user: "postgres",
    host: "171.244.141.14",
    database: "Recloser app",
    password: "1122",
    port: 5432,
});

const DEVICE_ID =
    "8b5ac090-9770-4658-a455-2af25e8fe54e";

let totalEnergy = 1000;
/*
let currentTime =
    new Date("2026-08-03T00:00:00");

const STEP_MINUTE = 15;

const SPEED = 1000;
*/
const SPEED = 15 * 60 * 1000; // 15 phút
function randomPower() {
    return 5 + Math.random() * 45;
}

async function saveInsertValues(
    insertValues,
    timestamp
) {

    if (!insertValues.length) {
        return;
    }

    const sql = `
        INSERT INTO device_logs
        (
            device_id,
            measurement_id,
            value,
            timestamp_ms
        )
        VALUES
        ${insertValues
            .map((_, i) =>
                `($${i * 4 + 1},
                  $${i * 4 + 2},
                  $${i * 4 + 3},
                  $${i * 4 + 4})`
            )
            .join(",")}
    `;

    const params = [];

    for (const row of insertValues) {

        params.push(
            row[0],
            row[1],
            row[2],
            timestamp
        );

    }

    await pool.query(sql, params);

    console.log(
        `✅ Đã lưu ${insertValues.length} TOU record`
    );
}

async function runOneStep() {

    const currentTime = new Date();

    const power = randomPower();

    const delta =
        power * 15 / 60;

    totalEnergy += delta;

    const scanResults = [
        {
            measurementId: TOTAL_MEASUREMENT_ID,
            value: totalEnergy
        }
    ];

    const insertValues = [];

    await processTOU(
        DEVICE_ID,
        scanResults,
        insertValues,
        currentTime
    );

    await saveInsertValues(
        insertValues,
        currentTime
    );

    console.log("================================");
    console.log(
        "Time:",
        currentTime.toLocaleString()
    );
    console.log(
        "Power:",
        power.toFixed(2),
        "kW"
    );
    console.log(
        "Delta:",
        delta.toFixed(3),
        "kWh"
    );
    console.log(
        "Total:",
        totalEnergy.toFixed(3)
    );

    console.table(insertValues);
}
async function start() {

    await loadPricingCache();

    console.log("TOU REAL-TIME TEST START");

    function scheduleNext() {

        const now = new Date();

        const next = new Date(now);

        const minute = now.getMinutes();

        const nextMinute =
            Math.floor(minute / 15) * 15 + 15;

        if (nextMinute >= 60) {

            next.setHours(
                now.getHours() + 1,
                0,
                0,
                0
            );

        } else {

            next.setMinutes(
                nextMinute,
                0,
                0
            );

        }

        const delay =
            next.getTime() - now.getTime();

        console.log(
            `⏰ Next TOU scan: ${next.toLocaleString()}`
        );

        setTimeout(async () => {

            try {

                await runOneStep();

            } catch (err) {

                console.error(
                    "❌ TOU test error:",
                    err
                );
            }
            scheduleNext(); 
        }, delay);

    }

    scheduleNext();
}

start();

