const { Pool } = require("pg");

const pool = new Pool({
  user: "postgres",
   host: "171.244.141.14",
  database: "Recloser app",
  password: "1122",
  port: 5432,
});
const PRICING_PLAN_ID =
  "f37a868d-f6dd-47ec-8eb8-c06811a9eea8";

const TOTAL_MEASUREMENT_ID =
  "1e9c2fed-54ca-4f5c-a594-27553384b5fa";

const TariffType = {
  PEAK: 1,
  NORMAL: 2,
  OFFPEAK: 3,
};

const TariffMeasurement = {
  [TariffType.PEAK]:
    "1dfbe3ba-d5ce-425a-90fb-a4b866aca029",

  [TariffType.NORMAL]:
    "4fb6378f-fa58-4efc-ac60-d390bf6415c0",

  [TariffType.OFFPEAK]:
    "42a4ef8e-72ac-4cff-ba51-faa156b0db0a",
};

const pricingCache = new Map();

const lastTotalMap = new Map();

async function loadPricingCache() {

    const sql = `
        SELECT

            pr.tariff_type,
            pr.price,

            prs.days,
            prs.start_min,
            prs.end_min

        FROM pricing_rules pr

        JOIN pricing_rule_schedule prs
        ON prs.pricing_rule_id = pr.pricing_rule_id

        WHERE
            pr.pricing_plan_id = $1
            AND pr.rule_type = 1

        ORDER BY
            prs.start_min
    `;

    const { rows } = await pool.query(sql, [
        PRICING_PLAN_ID
    ]);

    pricingCache.set(
        PRICING_PLAN_ID,
        rows.map(r => ({

            tariff_type: Number(r.tariff_type),

            days: Number(r.days),

            start_min: Number(r.start_min),

            end_min: Number(r.end_min),

            price: Number(r.price)

        }))
    );

}

/**
 * Reload cache
 */

async function reloadPricingCache() {

  pricingCache.clear();

  return loadPricingCache();

}

function getPricingRules() {

  return pricingCache.get(
    PRICING_PLAN_ID
  ) || [];

}

function getMeasurementId(tariffType) {

  return TariffMeasurement[
    tariffType
  ] || null;

}
function getCurrentTariff(now){

    const schedules =
        getPricingRules();

    if(!schedules.length){

        return null;

    }

    const date =
        new Date(now);

    let weekday =
        date.getDay();

    weekday =
        weekday === 0
            ? 6
            : weekday - 1;

    const minute =

        date.getHours() * 60 +

        date.getMinutes();

    for(const rule of schedules){

        const validDay =

            (rule.days & (1 << weekday)) !== 0;

        if(!validDay){

            continue;

        }

        const validTime =

            rule.start_min < rule.end_min

            ?

            (

                minute >= rule.start_min &&

                minute < rule.end_min

            )

            :

            (

                minute >= rule.start_min ||

                minute < rule.end_min

            );

        if(validTime){

            return rule;

        }

    }

    return null;

}
async function getLatestTariffValue(
    deviceId,
    tariffType
){

    const measurementId =
        getMeasurementId(tariffType);

    const { rows } = await pool.query(
        `
        SELECT value
        FROM device_logs
        WHERE
            device_id=$1
            AND measurement_id=$2
        ORDER BY timestamp_ms DESC
        LIMIT 1
        `,
        [
            deviceId,
            measurementId
        ]
    );

    if(!rows.length){

        return 0;

    }

    return Number(rows[0].value);

}
function getDelta(
    deviceId,
    currentTotal
){

    const previous =
        lastTotalMap.get(deviceId);

    lastTotalMap.set(
        deviceId,
        currentTotal
    );

    if(previous == null){

        return null;
    }

    return currentTotal - previous;

}
async function loadLastTotal(
    deviceId
){

    const { rows } = await pool.query(
        `
        SELECT value
        FROM device_logs
        WHERE
            device_id=$1
            AND measurement_id=$2
        ORDER BY timestamp_ms DESC
        LIMIT 1
        `,
        [
            deviceId,
            TOTAL_MEASUREMENT_ID
        ]
    );

    if(rows.length){

        lastTotalMap.set(
            deviceId,
            Number(rows[0].value)
        );

    }

}
 async function getLatestMeasurementValue(
    deviceId,
    measurementId
) {

    const { rows } = await pool.query(
        `
        SELECT value
        FROM device_logs
        WHERE
            device_id = $1
            AND measurement_id = $2
        ORDER BY timestamp_ms DESC
        LIMIT 1
        `,
        [
            deviceId,
            measurementId
        ]
    );

    if (!rows.length) {

        return 0;

    }

    return Number(rows[0].value);

}
async function processTOU(
    deviceId,
    scanResults,
    insertValues,
    now = new Date()
) {

    console.log("\n========== PROCESS TOU ==========");
    console.log("Device:", deviceId);
    console.log("Time:", now);
    console.log("Scan:", scanResults);

    // 1. Total Active Energy

    const totalItem = scanResults.find(
        x => x.measurementId === TOTAL_MEASUREMENT_ID
    );

    if (!totalItem) {

        console.log("❌ Không tìm thấy Total Active Energy");

        return;
    }

    const currentTotal = Number(totalItem.value);

    console.log("Total:", currentTotal);

    if (isNaN(currentTotal)) {

        console.log("❌ Total không hợp lệ");

        return;
    }


    // 2. Load previous Total

    if (!lastTotalMap.has(deviceId)) {

        console.log("Loading last Total...");

        await loadLastTotal(deviceId);
    }


    // 3. Delta

    const delta = getDelta(
        deviceId,
        currentTotal
    );

    console.log("Delta:", delta);

    if (delta == null) {

        console.log(
            "⏭️ Lần đầu -> chưa có delta"
        );

        return;
    }


    // 4. Delta <= 0

    if (delta <= 0) {

        console.log(
            "⏭️ Delta <= 0"
        );

        return;
    }


    // 5. Tariff

    const tariff = getCurrentTariff(now);

    console.log(
        "Tariff:",
        tariff
    );

    if (!tariff) {

        console.log(
            "❌ Không tìm thấy TOU rule"
        );

        return;
    }


    // 6. Measurement

    const measurementId =
        getMeasurementId(
            tariff.tariff_type
        );

    console.log(
        "Tariff type:",
        tariff.tariff_type
    );

    console.log(
        "Measurement:",
        measurementId
    );

    if (!measurementId) {

        console.log(
            "❌ Không có measurement cho tariff này"
        );

        return;
    }


    // 7. Current tariff value

    const currentTariffValue =
        await getLatestMeasurementValue(
            deviceId,
            measurementId
        );

    console.log(
        "Current tariff value:",
        currentTariffValue
    );


    // 8. New value

    const newValue =
        currentTariffValue + delta;


    // 9. INSERT

    insertValues.push([
        deviceId,
        measurementId,
        newValue
    ]);

    console.log(
        "✅ TOU INSERT:",
        {
            deviceId,
            measurementId,
            tariffType: tariff.tariff_type,
            delta,
            oldValue: currentTariffValue,
            newValue
        }
    );

    console.log(
        "================================\n"
    );
}
module.exports = {
    TOTAL_MEASUREMENT_ID,
    
  getLatestTariffValue,
 processTOU,
getDelta,

loadLastTotal,

  loadPricingCache,

  reloadPricingCache,

  getPricingRules,

  getMeasurementId,

};