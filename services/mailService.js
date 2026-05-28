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
console.log("MAIL_PASS =", process.env.MAIL_PASS ? "LOADED" : "MISSING");
transporter.verify((error, success) => {
  if (error) {
    console.error("❌ SMTP VERIFY ERROR:", error);
  } else {
    console.log("✅ SMTP READY – Gmail login OK");
  }
});
exports.sendAccountCreatedEmail = async ({ to, password }) => {
  const html = `
    <p>Kính gửi anh/chị,</p>

    <p>
      Công ty <b>OTECH</b> đã tạo cho anh/chị một tài khoản người dùng
      trên hệ thống quản lý thiết bị của chúng tôi.
    </p>

    <p>
      Thông tin đăng nhập ban đầu của anh/chị:
    </p>

    <blockquote>
      <p><b>Email:</b> ${to}</p>
      <p><b>Mật khẩu tạm thời:</b> <code>${password}</code></p>
    </blockquote>

    <p>
      ⚠️ Vì lý do bảo mật, vui lòng <b>đăng nhập và đổi mật khẩu ngay</b>
      sau lần đăng nhập đầu tiên.
    </p>

    <p>
      Nếu anh/chị không yêu cầu tạo tài khoản này, vui lòng bỏ qua email
      hoặc liên hệ lại với chúng tôi.
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
    subject: "Thông tin tài khoản OTECH",
    html,
  });
};

