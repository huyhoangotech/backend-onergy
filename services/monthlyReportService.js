
const PEAK_ID =
  "1dfbe3ba-d5ce-425a-90fb-a4b866aca029";

const NORMAL_ID =
  "4fb6378f-fa58-4efc-ac60-d390bf6415c0";

const OFFPEAK_ID =
  "42a4ef8e-72ac-4cff-ba51-faa156b0db0a";


// =====================================================
// GET MONTHLY REPORT DATA
// =====================================================

exports.getMonthlyReportData = async ({
     pool,
  userId,
  year,
  month,
}) => {

  // ===================================================
  // DATE RANGE
  // ===================================================

  const fromDate = new Date(
    Number(year),
    Number(month) - 1,
    1,
    0,
    0,
    0,
    0
  );

  const toDate = new Date(
    Number(year),
    Number(month),
    0,
    23,
    59,
    59,
    999
  );

  // ===================================================
  // CUSTOMER
  // ===================================================

  const userResult = await pool.query(
    `
    SELECT
      user_id,
      name,
      email
    FROM users
    WHERE user_id = $1
    `,
    [userId]
  );

  if (!userResult.rows.length) {
    throw new Error("Customer not found");
  }

  const customer = userResult.rows[0];


  // ===================================================
  // DEVICE
  // ===================================================

  const deviceResult = await pool.query(
    `
    SELECT
      d.device_id,
      d.name,
      d.serial_number
    FROM users_devices ud

    JOIN devices d
      ON d.device_id = ud.device_id

    WHERE ud.user_id = $1

    ORDER BY ud.pinned DESC

    LIMIT 1
    `,
    [userId]
  );

  if (!deviceResult.rows.length) {
    throw new Error("No device assigned to customer");
  }

  const device = deviceResult.rows[0];


  // ===================================================
  // GET FIRST + LAST COUNTER OF MONTH
  // ===================================================

  const energyResult = await pool.query(
    `
    WITH first_values AS (

      SELECT DISTINCT ON (measurement_id)
        measurement_id,
        value,
        timestamp_ms

      FROM device_logs

      WHERE device_id = $1

        AND measurement_id IN (
          $2,
          $3,
          $4
        )

        AND timestamp_ms < $5

      ORDER BY
        measurement_id,
        timestamp_ms DESC
    ),

    last_values AS (

      SELECT DISTINCT ON (measurement_id)
        measurement_id,
        value,
        timestamp_ms

      FROM device_logs

      WHERE device_id = $1

        AND measurement_id IN (
          $2,
          $3,
          $4
        )

        AND timestamp_ms <= $6

      ORDER BY
        measurement_id,
        timestamp_ms DESC
    )

    SELECT
      COALESCE(
        (
          SELECT value
          FROM first_values
          WHERE measurement_id = $2
        ),
        0
      ) AS peak_start,

      COALESCE(
        (
          SELECT value
          FROM last_values
          WHERE measurement_id = $2
        ),
        0
      ) AS peak_end,

      COALESCE(
        (
          SELECT value
          FROM first_values
          WHERE measurement_id = $3
        ),
        0
      ) AS normal_start,

      COALESCE(
        (
          SELECT value
          FROM last_values
          WHERE measurement_id = $3
        ),
        0
      ) AS normal_end,

      COALESCE(
        (
          SELECT value
          FROM first_values
          WHERE measurement_id = $4
        ),
        0
      ) AS offpeak_start,

      COALESCE(
        (
          SELECT value
          FROM last_values
          WHERE measurement_id = $4
        ),
        0
      ) AS offpeak_end
    `,
    [
      device.device_id,
      PEAK_ID,
      NORMAL_ID,
      OFFPEAK_ID,
      fromDate,
      toDate,
    ]
  );

  const row = energyResult.rows[0];


  // ===================================================
  // ENERGY
  // ===================================================

  const peakStart = Number(row.peak_start) || 0;
  const peakEnd = Number(row.peak_end) || 0;

  const normalStart = Number(row.normal_start) || 0;
  const normalEnd = Number(row.normal_end) || 0;

  const offpeakStart =
    Number(row.offpeak_start) || 0;

  const offpeakEnd =
    Number(row.offpeak_end) || 0;


  const peak =
    Math.max(0, peakEnd - peakStart);

  const normal =
    Math.max(0, normalEnd - normalStart);

  const offPeak =
    Math.max(0, offpeakEnd - offpeakStart);

  const total =
    peak +
    normal +
    offPeak;


  // ===================================================
  // ACTIVE PRICING PLAN
  // ===================================================

  const pricingPlanResult = await pool.query(
    `
    SELECT pricing_plan_id
    FROM pricing_plans
    WHERE is_active = true
    ORDER BY created_at DESC
    LIMIT 1
    `
  );

  if (!pricingPlanResult.rows.length) {
    throw new Error("No active pricing plan");
  }

  const pricingPlanId =
    pricingPlanResult.rows[0].pricing_plan_id;


  // ===================================================
  // PRICES
  // ===================================================

  const pricingResult = await pool.query(
    `
    SELECT
      tariff_type,
      price

    FROM pricing_rules

    WHERE pricing_plan_id = $1
      AND rule_type = 1

    ORDER BY tariff_type
    `,
    [pricingPlanId]
  );


  const pricing = {
    peak: 0,
    normal: 0,
    offPeak: 0,
  };


  for (const item of pricingResult.rows) {

    const tariffType =
      Number(item.tariff_type);

    const price =
      Number(item.price) || 0;


    if (tariffType === 1) {
      pricing.peak = price;
    }

    if (tariffType === 2) {
      pricing.normal = price;
    }

    if (tariffType === 3) {
      pricing.offPeak = price;
    }
  }


  // ===================================================
  // COST
  // ===================================================

  const peakCost =
    peak * pricing.peak;

  const normalCost =
    normal * pricing.normal;

  const offPeakCost =
    offPeak * pricing.offPeak;

  const totalCost =
    peakCost +
    normalCost +
    offPeakCost;


  // ===================================================
  // RETURN
  // ===================================================

  return {

    customer: {
      userId: customer.user_id,
      name: customer.name,
      email: customer.email,
    },

    device: {
      deviceId: device.device_id,
      name: device.name,
      serialNumber: device.serial_number,
    },

    period: {
      year: Number(year),
      month: Number(month),

      label: `${String(month).padStart(2, "0")}/${year}`,

      from: fromDate.toISOString(),

      to: toDate.toISOString(),
    },

    energy: {

      peak,
      normal,
      offPeak,

      total,
    },

    pricing: {

      pricingPlanId,

      peak: pricing.peak,
      normal: pricing.normal,
      offPeak: pricing.offPeak,
    },

    cost: {

      peak: peakCost,

      normal: normalCost,

      offPeak: offPeakCost,

      total: totalCost,
    },

  };
};