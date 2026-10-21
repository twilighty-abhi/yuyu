import nodemailer from "nodemailer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ settings: vi.fn() }));
vi.mock("@/lib/instanceSettings", () => ({ getEmailSettings: mocks.settings }));

import { EmailTransportUnavailableError, getEmailTransport } from "@/lib/email/transporter";

describe("production SMTP configuration", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    // CI itself sets the TLS bypass pair; tests opt in to it explicitly.
    vi.stubEnv("CI", "");
    vi.stubEnv("ALLOW_INSECURE_PRODUCTION_TESTS", "");
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

  it("fails closed for unauthenticated production SMTP unless a private relay is explicit", async () => {
    mocks.settings.mockResolvedValue({ host: "relay.internal", port: 25, secure: false, from: "noreply@example.test", allowUnauthenticated: false });
    await expect(getEmailTransport()).rejects.toBeInstanceOf(EmailTransportUnavailableError);
    mocks.settings.mockResolvedValue({ host: "relay.internal", port: 25, secure: false, from: "noreply@example.test", allowUnauthenticated: true });
    const result = await getEmailTransport();
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: "relay.internal", auth: undefined, requireTLS: true }));
    result.transporter?.close();
  });

  it("reads settings on every send, so saved changes apply without a restart", async () => {
    mocks.settings.mockReset();
    mocks.settings
      .mockResolvedValueOnce({ host: "first.example.test", port: 587, secure: false, from: "a@example.test", user: "u", password: "p" })
      .mockResolvedValueOnce({ host: "second.example.test", port: 587, secure: false, from: "a@example.test", user: "u", password: "p" });
    const first = await getEmailTransport();
    const second = await getEmailTransport();
    expect(mocks.settings).toHaveBeenCalledTimes(2);
    expect(nodemailer.createTransport).toHaveBeenNthCalledWith(1, expect.objectContaining({ host: "first.example.test" }));
    expect(nodemailer.createTransport).toHaveBeenNthCalledWith(2, expect.objectContaining({ host: "second.example.test" }));
    first.transporter?.close();
    second.transporter?.close();
  });

  it("caps socket timeouts for operator test sends", async () => {
    mocks.settings.mockResolvedValue({ host: "smtp.example.test", port: 587, secure: false, from: "a@example.test", user: "u", password: "p" });
    const result = await getEmailTransport({ timeoutMs: 15_000 });
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 15_000 }));
    result.transporter?.close();
  });

  it("relaxes TLS only for the explicit CI/staging bypass", async () => {
    vi.stubEnv("CI", "true");
    vi.stubEnv("ALLOW_INSECURE_PRODUCTION_TESTS", "1");
    mocks.settings.mockResolvedValue({ host: "mailpit", port: 1025, secure: false, from: "a@example.test", allowUnauthenticated: true });
    const result = await getEmailTransport();
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: "mailpit", requireTLS: false, tls: undefined }));
    result.transporter?.close();
  });

  it("keeps TLS rules when only one bypass flag is set", async () => {
    vi.stubEnv("CI", "");
    vi.stubEnv("ALLOW_INSECURE_PRODUCTION_TESTS", "1");
    mocks.settings.mockResolvedValue({ host: "mailpit", port: 1025, secure: false, from: "a@example.test", allowUnauthenticated: true });
    const result = await getEmailTransport();
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ requireTLS: true, tls: { minVersion: "TLSv1.2", rejectUnauthorized: true } }));
    result.transporter?.close();
  });
});
