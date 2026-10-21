const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const monthlyReportService = require("../../services/monthlyReportService");
const {
  generateMonthlyReportPDF,
} = require("../../services/reportPdfService");
const {
  sendMonthlyEnergyReportEmail,
} = require("../../services/mailService");
const pool = new Pool({
  user: "postgres",
  host: "171.244.141.14",
  database: "Recloser app",
  password: "1122",
  port: 5432,
});

exports.previewMonthlyReport = async (req, res) => {

  try {

    const { userId } = req.params;

    const year =
      Number(req.query.year);

    const month =
      Number(req.query.month);


    if (
      !year ||
      !month ||
      month < 1 ||
      month > 12
    ) {

      return res.status(400).json({
        error: "Invalid year or month",
      });

    }


    const report =
      await monthlyReportService.getMonthlyReportData({
          pool,
        userId,
        year,
        month,
      });


    // =================================================
    // EMAIL PREVIEW
    // =================================================

    const email = {

      to: report.customer.email,

      subject:
        `SaiGonCenTre - Báo cáo tiêu thụ điện năng tháng ${report.period.label}`,

      html: `
        <div style="font-family: Arial, sans-serif;">

          <h2>
            SaiGonCenTre - Báo cáo tiêu thụ điện năng
          </h2>

          <p>
            Kính gửi
            <b>${report.customer.name}</b>,
          </p>

          <p>
            SaigonCentre xin gửi đến Quý khách
            báo cáo tiêu thụ điện năng
            tháng <b>${report.period.label}</b>.
          </p>

          <h3>
            Tổng hợp điện năng
          </h3>

          <table
            style="
              border-collapse: collapse;
              width: 100%;
            "
          >

            <tr>
              <td>Peak</td>
              <td>
                ${report.energy.peak.toFixed(2)} kWh
              </td>
            </tr>

            <tr>
              <td>Normal</td>
              <td>
                ${report.energy.normal.toFixed(2)} kWh
              </td>
            </tr>

            <tr>
              <td>OffPeak</td>
              <td>
                ${report.energy.offPeak.toFixed(2)} kWh
              </td>
            </tr>

            <tr>
              <td>
                <b>Tổng</b>
              </td>

              <td>
                <b>
                  ${report.energy.total.toFixed(2)}
                  kWh
                </b>
              </td>
            </tr>

          </table>

          <h3>
            Chi phí
          </h3>

          <p>
            Peak:
            ${report.cost.peak.toLocaleString("vi-VN")}
            VND
          </p>

          <p>
            Normal:
            ${report.cost.normal.toLocaleString("vi-VN")}
            VND
          </p>

          <p>
            OffPeak:
            ${report.cost.offPeak.toLocaleString("vi-VN")}
            VND
          </p>

          <p>
            <b>
              Tổng tiền:
              ${report.cost.total.toLocaleString("vi-VN")}
              VND
            </b>
          </p>

          <p>
            File báo cáo chi tiết được đính kèm
            trong email này.

          <br />

          <p>
            Trân trọng,
          </p>

          <p>
            <b>SaiGonCenTre</b>
          </p>

        </div>
      `,
    };


    return res.json({

      success: true,

      report,

      email,

    });

  } catch (err) {

    console.error(
      "previewMonthlyReport error:",
      err
    );

    return res.status(500).json({
      error: err.message,
    });

  }

};
exports.getMonthlyReportPDF = async (
  req,
  res
) => {

  try {

    const { userId } =
      req.params;

    const year =
      Number(req.query.year);

    const month =
      Number(req.query.month);


    if (
      !year ||
      !month ||
      month < 1 ||
      month > 12
    ) {

      return res.status(400).json({
        error: "Invalid year or month",
      });

    }


    const report =
      await monthlyReportService
        .getMonthlyReportData({
              pool,
          userId,
          year,
          month,
        });


  const pdfBuffer = await generateMonthlyReportPDF({
  pool,
  userId,
  month: report.period.label,
  data: report.energy,
  pricing: report.pricing,
});

    res.setHeader(
      "Content-Type",
      "application/pdf"
    );
    res.setHeader(
      "Content-Disposition",
      `inline; filename="Saigoncentre_Report_${year}_${String(month).padStart(2, "0")}.pdf"`
    );
    return res.send(pdfBuffer);

  } catch (err) {

    console.error(
      "getMonthlyReportPDF error:",
      err
    );

    return res.status(500).json({
      error: err.message,
    });

  }

};
exports.sendMonthlyReport = async (
  req,
  res
) => {

  try {

    const { userId } =
      req.params;

    const {
      year,
      month,
    } = req.body;


    if (
      !year ||
      !month ||
      month < 1 ||
      month > 12
    ) {

      return res.status(400).json({
        error: "Invalid year or month",
      });

    }


    // =============================================
    // GET REPORT
    // =============================================

    const report =
      await monthlyReportService
        .getMonthlyReportData({
        pool,
          userId,
          year,
          month,
        });
    // =============================================
    // GENERATE PDF
    // =============================================
const pdfBuffer = await generateMonthlyReportPDF({
  pool,
  userId,
  month: report.period.label,
  data: report.energy,
  pricing: report.pricing,
});
    // =============================================
    // SEND EMAIL
    // =============================================
    await sendMonthlyEnergyReportEmail({

      to: report.customer.email,

      customerName:
        report.customer.name,

      month:
        report.period.label,

      pdfBuffer,

    });
    return res.json({

      success: true,

      message:
        "Monthly report sent successfully",

      to:
        report.customer.email,

      period:
        report.period.label,

    });


  } catch (err) {

    console.error(
      "sendMonthlyReport error:",
      err
    );


    return res.status(500).json({

      error: err.message,

    });

  }

};