import nodemailer from "nodemailer";

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]!);
}

function getTransporter() {
  const service = process.env.SMTP_SERVICE;
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const secure = process.env.SMTP_SECURE === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const tls = process.env.NODE_ENV === "production" ? { minVersion: "TLSv1.2" as const, rejectUnauthorized: true } : undefined;
  const requireTLS = process.env.NODE_ENV === "production" && !secure;

  if (service) {
    return nodemailer.createTransport({ service, auth: user && pass ? { user, pass } : undefined, disableFileAccess: true, disableUrlAccess: true, requireTLS, tls });
  }
  if (!host) return null;
  return nodemailer.createTransport({ host, port, secure, auth: user && pass ? { user, pass } : undefined, disableFileAccess: true, disableUrlAccess: true, requireTLS, tls });
}

export async function sendEmailVerificationEmail(params: {
  to: string;
  verificationUrl: string;
}): Promise<void> {
  const transporter = getTransporter();
  const from = process.env.EMAIL_FROM || "Yuyu Events <noreply@localhost>";
  const safeUrl = escapeHtml(params.verificationUrl);
  const text = `Verify your email address\n\nOpen this link to activate your Yuyu account (it expires in 1 hour):\n\n${params.verificationUrl}\n\nIf you did not create an account, you can safely ignore this email.`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Verify your email</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f8f9fa;margin:0;padding:20px;color:#1c1b1f"><div style="max-width:600px;margin:40px auto;background:#fff;border:1px solid #e0e0e0;border-radius:16px;overflow:hidden"><div style="background:#6750A4;padding:24px;text-align:center;color:#fff"><strong>Yuyu Events</strong></div><div style="padding:32px"><h2 style="margin-top:0;color:#6750A4">Verify your email</h2><p>Thanks for creating a Yuyu account. Verify that you control this email address to activate your account.</p><p style="text-align:center;margin:32px 0"><a href="${safeUrl}" style="background:#6750A4;color:#fff;padding:14px 28px;border-radius:100px;text-decoration:none;font-weight:600;display:inline-block">Verify email</a></p><p style="font-size:13px;color:#666;overflow-wrap:anywhere">This link expires in 1 hour. If you did not create an account, you can safely ignore this email.</p></div></div></body></html>`;

  if (!transporter) {
    // Do not print the bearer link, even in development logs.
    console.log("[EMAIL MOCK] Verification email queued");
    return;
  }
  await transporter.sendMail({ from, to: params.to, subject: "Verify your Yuyu email", text, html });
}
