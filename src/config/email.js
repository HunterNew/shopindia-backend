const nodemailer = require('nodemailer');
require('dotenv').config();

// Create reusable transporter
const transporter = nodemailer.createTransport({
  host:   process.env.EMAIL_HOST  || 'smtp.gmail.com',
  port:   Number(process.env.EMAIL_PORT) || 587,
  secure: false, // true for port 465, false for 587
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Verify connection on startup (only in dev)
if (process.env.NODE_ENV !== 'production') {
  transporter.verify((err) => {
    if (err) console.warn('⚠️  Email not configured:', err.message);
    else     console.log('✅ Email service ready');
  });
}

/**
 * Send OTP email for password reset
 */
const sendOTPEmail = async (toEmail, otp, userName) => {
  const mailOptions = {
    from:    process.env.EMAIL_FROM || `ShopIndia <${process.env.EMAIL_USER}>`,
    to:      toEmail,
    subject: '🔐 Your Password Reset OTP — ShopIndia',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
      </head>
      <body style="margin:0;padding:0;background:#f9fafb;font-family:Inter,Arial,sans-serif;">
        <div style="max-width:480px;margin:40px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          
          <!-- Header -->
          <div style="background:#f97316;padding:32px 40px;text-align:center;">
            <div style="width:48px;height:48px;background:rgba(255,255,255,0.2);border-radius:12px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px;">
              <span style="color:white;font-size:24px;">🛍️</span>
            </div>
            <h1 style="margin:0;color:white;font-size:22px;font-weight:700;">ShopIndia</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Password Reset Request</p>
          </div>

          <!-- Body -->
          <div style="padding:36px 40px;">
            <p style="margin:0 0 8px;font-size:16px;color:#111827;">Hi <strong>${userName || 'there'}</strong>,</p>
            <p style="margin:0 0 28px;font-size:14px;color:#6b7280;line-height:1.6;">
              We received a request to reset your ShopIndia password. Use the OTP below to continue. 
              This code is valid for <strong>10 minutes</strong>.
            </p>

            <!-- OTP Box -->
            <div style="background:#fff7ed;border:2px dashed #fed7aa;border-radius:12px;padding:24px;text-align:center;margin-bottom:28px;">
              <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#ea580c;text-transform:uppercase;letter-spacing:1px;">Your OTP Code</p>
              <div style="font-size:42px;font-weight:800;color:#c2410c;letter-spacing:12px;font-family:monospace;">${otp}</div>
              <p style="margin:8px 0 0;font-size:12px;color:#9ca3af;">Expires in 10 minutes</p>
            </div>

            <p style="margin:0 0 8px;font-size:13px;color:#9ca3af;line-height:1.6;">
              If you didn't request a password reset, you can safely ignore this email. 
              Your password will remain unchanged.
            </p>
          </div>

          <!-- Footer -->
          <div style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #f3f4f6;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">
              © ${new Date().getFullYear()} ShopIndia. All rights reserved.
            </p>
          </div>
        </div>
      </body>
      </html>
    `,
  };

  await transporter.sendMail(mailOptions);
};

module.exports = { sendOTPEmail };
