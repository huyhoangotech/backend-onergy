const path = require("path");
const PDFDocument = require("pdfkit");
const FONT_REGULAR = path.join(
  __dirname,
  "../fonts/NotoSans-Regular.ttf"
);

const FONT_BOLD = path.join(
  __dirname,
  "../fonts/NotoSans-Bold.ttf"
);
exports.generateMonthlyReportPDF = async ({
  pool,
  userId,
  month,
  data,
  pricing,
}) => {
  return new Promise(async (resolve, reject) => {
    try {
      // =========================================
      // GET USER
      // =========================================

      const userResult = await pool.query(
        `
        SELECT
          user_id,
          name,
          email
        FROM users
        WHERE user_id = $1
        LIMIT 1
        `,
        [userId]
      );

      if (userResult.rows.length === 0) {
        return reject(new Error("User not found"));
      }

      const user = userResult.rows[0];

      // =========================================
      // PDF
      // =========================================

      const doc = new PDFDocument({
        size: "A4",
        margin: 50,
      });

      const chunks = [];

      doc.on("data", (chunk) => chunks.push(chunk));

      doc.on("end", () => {
        const pdfBuffer = Buffer.concat(chunks);
        resolve(pdfBuffer);
      });

      doc.on("error", reject);
doc.registerFont("NotoSans", FONT_REGULAR);
doc.registerFont("NotoSans-Bold", FONT_BOLD);
      // ==============================
      // HEADER
      // ==============================

      doc
        .fontSize(20)
     .font("NotoSans-Bold")
        .text("SaiGonCenTre", {
          align: "center",
        });

      doc
        .moveDown(0.5)
          .font("NotoSans-Bold")
        .fontSize(16)
        .text("BÁO CÁO TIÊU THỤ ĐIỆN NĂNG", {
          align: "center",
        });

      doc
        .moveDown(0.3)
        .fontSize(12)
        .font("NotoSans")
        .text(`Kỳ báo cáo: ${month}`, {
          align: "center",
        });

      doc.moveDown(2);

      // ==============================
      // CUSTOMER
      // ==============================

      doc
        .fontSize(12)
.font("NotoSans-Bold")
        .text("Thông tin khách hàng");

      doc
        .moveDown(0.5)
       .font("NotoSans")
        .text(`Khách hàng: ${user.name || "-"}`)
        .text(`Email: ${user.email || "-"}`);

      doc.moveDown(1.5);

      // ==============================
      // SUMMARY
      // ==============================

      const peak = Number(data.peak || 0);
      const normal = Number(data.normal || 0);
      const offpeak = Number(data.offpeak || 0);

      const totalEnergy =
        peak +
        normal +
        offpeak;

      const peakCost =
        peak * Number(pricing.peak || 0);

      const normalCost =
        normal * Number(pricing.normal || 0);

      const offpeakCost =
        offpeak * Number(pricing.offPeak || 0);

      const totalCost =
        peakCost +
        normalCost +
        offpeakCost;

      doc
        .fontSize(12)
        .font("NotoSans-Bold")
        .text("Tổng hợp tiêu thụ");

      doc.moveDown(0.7);

      doc
       .font("NotoSans")
        .text(`Peak:       ${peak.toFixed(2)} kWh`)
        .text(`Normal:     ${normal.toFixed(2)} kWh`)
        .text(`OffPeak:    ${offpeak.toFixed(2)} kWh`)
        .moveDown(0.5)
        .font("NotoSans-Bold")
        .text(`Tổng:       ${totalEnergy.toFixed(2)} kWh`);

      doc.moveDown(1.5);

      // ==============================
      // COST
      // ==============================

      doc
        .fontSize(12)
          .font("NotoSans-Bold")
        .text("Chi phí điện năng");

      doc.moveDown(0.7);

      doc
        .font("NotoSans")
        .text(
          `Peak:       ${peakCost.toLocaleString("vi-VN")} VND`
        )
        .text(
          `Normal:     ${normalCost.toLocaleString("vi-VN")} VND`
        )
        .text(
          `OffPeak:    ${offpeakCost.toLocaleString("vi-VN")} VND`
        )
        .moveDown(0.5)
      .font("NotoSans-Bold")
        .text(
          `Tổng tiền:  ${totalCost.toLocaleString("vi-VN")} VND`
        );

      doc.moveDown(2);

      // ==============================
      // PRICING
      // ==============================

      doc
        .fontSize(12)
         .font("NotoSans-Bold")
        .text("Đơn giá áp dụng");

      doc.moveDown(0.7);

      doc
        .font("NotoSans-Bold")
        .text(
          `Peak:       ${Number(
            pricing.peak || 0
          ).toLocaleString("vi-VN")} VND/kWh`
        )
        .text(
          `Normal:     ${Number(
            pricing.normal || 0
          ).toLocaleString("vi-VN")} VND/kWh`
        )
        .text(
          `OffPeak:    ${Number(
            pricing.offPeak || 0
          ).toLocaleString("vi-VN")} VND/kWh`
        );

      doc.moveDown(3);

      // ==============================
      // FOOTER
      // ==============================

      doc
        .fontSize(10)
        .font("NotoSans")
        .text(
          "Báo cáo được tạo tự động bởi hệ thống SaiGonCenTre.",
          {
            align: "center",
          }
        );

      doc.end();

    } catch (error) {
      reject(error);
    }
  });
};