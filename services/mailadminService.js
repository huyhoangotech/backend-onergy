const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

transporter.verify((error, success) => {
  if (error) {
    console.error("❌ SMTP VERIFY ERROR:", error);
  } else {
    console.log("✅ SMTP READY – Gmail login OK");
  }
});

/**
 * Gửi email cấp tài khoản ADMIN (nhân viên công ty)
 */
exports.sendAdminAccountCreatedEmail = async ({ to, password, role = "ADMIN" }) => {
  const html = `
    <p>Kính gửi anh/chị,</p>

    <p>
      Anh/chị đã được <b>OTECH</b> cấp tài khoản <b>nhân viên quản trị hệ thống</b>
      để sử dụng nền tảng quản lý thiết bị nội bộ.
    </p>

    <p>
      Thông tin đăng nhập ban đầu của anh/chị:
    </p>

    <blockquote>
      <p><b>Email:</b> ${to}</p>
      <p><b>Mật khẩu tạm thời:</b> <code>${password}</code></p>
      <p><b>Vai trò:</b> ${role}</p>
    </blockquote>

    <p>
      ⚠️ Vì lý do bảo mật:
    </p>
    <ul>
      <li>Vui lòng <b>đổi mật khẩu ngay</b> sau lần đăng nhập đầu tiên</li>
      <li>Không chia sẻ thông tin đăng nhập cho người khác</li>
    </ul>

    <p>
      Tài khoản ADMIN cho phép truy cập các chức năng quản lý quan trọng.
      Anh/chị vui lòng sử dụng đúng mục đích công việc.
    </p>

    <br />

    <p>Trân trọng,</p>
    <p><b>OTECH Technical Team</b></p>
    <p>📧 support@otech.com</p>
    <p>🌐 https://otech.com</p>
  `;

  await transporter.sendMail({
    from: `"OTECH Technical Team" <${process.env.MAIL_USER}>`,
    to,
    subject: "Cấp tài khoản quản trị hệ thống OTECH",
    html,
  });
};
