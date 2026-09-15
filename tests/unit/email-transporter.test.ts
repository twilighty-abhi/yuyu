import nodemailer from "nodemailer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ settings: vi.fn() }));
vi.mock("@/lib/instanceSettings", () => ({ getEmailSettings: mocks.settings }));

import { EmailTransportUnavailableError, getEmailTransport } from "@/lib/email/transporter";

describe("production SMTP configuration", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(nodemailer, "createTransport");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([
    { name: "service preset", service: "gmail", host: undefined, port: 587, secure: false },
    { name: "SMTP with STARTTLS", service: undefined, host: "smtp.example.test", port: 587, secure: false },
    { name: "SMTP with implicit TLS", service: undefined, host: "smtp.example.test", port: 465, secure: true },
  ])("preserves authentication and restrictions for $name", async settings => {
    mocks.settings.mockResolvedValue({ ...settings, from: "noreply@example.test", user: "fixture-user", password: "fixture-password" });
    const result = await getEmailTransport();
    expect(result.from).toBe("noreply@example.test");
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      auth: { user: "fixture-user", pass: "fixture-password" },
      disableFileAccess: true, disableUrlAccess: true,
      requireTLS: !settings.secure,
      tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
      connectionTimeout: 30_000, greetingTimeout: 30_000, socketTimeout: 60_000,
      ...(settings.service ? { service: settings.service } : { host: settings.host, port: settings.port, secure: settings.secure }),
    }));
    result.transporter?.close();
  });

  it("fails closed when production SMTP is missing", async () => {
    mocks.settings.mockResolvedValue({ service: undefined, host: undefined, secure: false });
    await expect(getEmailTransport()).rejects.toBeInstanceOf(EmailTransportUnavailableError);
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });
});
