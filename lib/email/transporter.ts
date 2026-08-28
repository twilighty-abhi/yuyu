import "server-only";

import nodemailer from "nodemailer";
import { getEmailSettings } from "@/lib/instanceSettings";

export async function getEmailTransport() {
  const settings = await getEmailSettings();
  const tls = process.env.NODE_ENV === "production" ? { minVersion: "TLSv1.2" as const, rejectUnauthorized: true } : undefined;
  const requireTLS = process.env.NODE_ENV === "production" && !settings.secure;
  if (settings.service) {
    return {
      from: settings.from,
      transporter: nodemailer.createTransport({
        service: settings.service, auth: settings.user && settings.password ? { user: settings.user, pass: settings.password } : undefined,
        disableFileAccess: true, disableUrlAccess: true, requireTLS, tls,
      }),
    };
  }
  if (!settings.host) return { from: settings.from, transporter: null };
  return {
    from: settings.from,
    transporter: nodemailer.createTransport({
      host: settings.host, port: settings.port, secure: settings.secure,
      auth: settings.user && settings.password ? { user: settings.user, pass: settings.password } : undefined,
      disableFileAccess: true, disableUrlAccess: true, requireTLS, tls,
    }),
  };
}
