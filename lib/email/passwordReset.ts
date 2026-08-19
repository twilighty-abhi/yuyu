import nodemailer from "nodemailer";

function getTransporter() {
  const service = process.env.SMTP_SERVICE;
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const secure = process.env.SMTP_SECURE === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  if (service) {
    return nodemailer.createTransport({
      service,
      auth: user && pass ? { user, pass } : undefined,
    });
  }

  if (!host) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });
}

function getFromAddress(): string {
  return process.env.EMAIL_FROM || "Yuyu Events <noreply@localhost>";
}

export async function sendPasswordResetEmail(params: {
  to: string;
  resetUrl: string;
}): Promise<void> {
  const transporter = getTransporter();
  const from = getFromAddress();

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Reset Your Password</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8f9fa; margin: 0; padding: 20px; color: #1c1b1f;">
        <div style="max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #e0e0e0; box-shadow: 0 4px 12px rgba(0,0,0,0.05); overflow: hidden;">
          <div style="background-color: #6750A4; padding: 24px; text-align: center; color: #ffffff;">
            <h1 style="margin: 0; font-size: 24px; font-weight: 600; letter-spacing: 0.5px;">Yuyu Events</h1>
          </div>
          <div style="padding: 32px;">
            <h2 style="margin-top: 0; color: #6750A4; font-size: 20px; font-weight: 600;">Reset Your Password</h2>
            <p style="font-size: 16px; line-height: 1.5; color: #49454f; margin-bottom: 24px;">
              Hello,<br><br>
              We received a request to reset the password for your account. Click the button below to set a new password. This link will expire in 1 hour.
            </p>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${params.resetUrl}" style="background-color: #6750A4; color: #ffffff; padding: 14px 28px; border-radius: 100px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                Reset Password
              </a>
            </div>
            <p style="font-size: 14px; text-align: center; color: #79747e; margin-bottom: 24px;">
              Or copy and paste this link: <br>
              <a href="${params.resetUrl}" style="color: #6750A4; text-decoration: underline; word-break: break-all;">${params.resetUrl}</a>
            </p>
            <p style="font-size: 13px; color: #79747e; line-height: 1.5;">
              If you didn't request a password reset, you can safely ignore this email. Your password will not be changed.
            </p>
          </div>
          <div style="background-color: #f3edf7; padding: 16px; text-align: center; font-size: 12px; color: #79747e; border-top: 1px solid #e0e0e0;">
            This email was sent by Yuyu Events.<br>
            &copy; ${new Date().getFullYear()} Yuyu. All rights reserved.
          </div>
        </div>
      </body>
    </html>
  `;

  const text = `Reset Your Password\n\nHello,\n\nWe received a request to reset your password. Visit the following link to set a new password (expires in 1 hour):\n\n${params.resetUrl}\n\nIf you didn't request this, you can safely ignore this email.\n\nBest regards,\nYuyu Events`;

  if (!transporter) {
    console.log("========================================");
    console.log(`[EMAIL MOCK] To: ${params.to}`);
    console.log(`[EMAIL MOCK] Subject: Reset your Yuyu password`);
    console.log(`[EMAIL MOCK] Reset URL: ${params.resetUrl}`);
    console.log(`[EMAIL MOCK] Text:\n${text}`);
    console.log("========================================");
    return;
  }

  await transporter.sendMail({
    from,
    to: params.to,
    subject: "Reset your Yuyu password",
    text,
    html,
  });
}
