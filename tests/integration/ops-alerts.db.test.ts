import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { OutboxStatus } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Real database, encryption, outbox, webhook delivery and SMTP. Only the
// super-admin MFA step-up cookie and the per-admin action limiter are mocked.
const env = vi.hoisted(() => {
  process.env.MFA_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");
  process.env.TRUSTED_PROXY_IP_HEADER = "x-forwarded-for";
  return { superAdmin: { id: "", email: "" } };
});
vi.mock("@/lib/permissions", () => ({ requireSuperAdminMfa: async () => ({ user: env.superAdmin }) }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { INSTANCE_SETTINGS_ID, getEmailSettingsStatus } from "@/lib/instanceSettings";
import { invalidateOpsAlertSettings } from "@/lib/opsAlerts";
import { deliverOutboxBatch } from "@/lib/outbox";
import { saveInstanceServiceSettings, saveOpsWebhookSettings, sendInstanceTestEmail, sendOpsWebhookTest } from "@/app/actions/instance-settings";
import { retryFailedOutboxMessages } from "@/app/actions/instance";
import { POST as reportClientError } from "@/app/api/client-errors/route";

const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
// Per-run client addresses (IPv6 documentation prefix), so the per-IP
// limiter's Redis counters from an earlier run within the minute don't apply.
const runIp = (n: number) => `2001:db8:${n.toString(16)}::${suffix.slice(0, 4)}:${suffix.slice(4, 8)}:${suffix.slice(8, 12)}`;
const SMTP_USER = "relay-user@example.test";
const SMTP_PASSWORD = `app-password-${suffix}`;

// ---- local webhook receiver ----
const posts: string[] = [];
let webhookUrl = "";
const webhook = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    posts.push(JSON.parse(body).text as string);
    res.writeHead(200).end("ok");
  });
});

// ---- local SMTP server that only accepts SMTP_USER / SMTP_PASSWORD ----
const mails: { to: string; data: string }[] = [];
let smtpPort = 0;
const smtp = net.createServer((sock) => {
  let authed = false, inData = false, data = "", to = "", buffer = "", login: string | null = null, stage = "";
  const reply = (line: string) => sock.write(`${line}\r\n`);
  const check = (user: string, pass: string) => {
    authed = user === SMTP_USER && pass === SMTP_PASSWORD;
    reply(authed ? "235 2.7.0 Authentication successful" : "535 5.7.8 Username and Password not accepted");
  };
  reply("220 test ESMTP");
  sock.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let index;
    while ((index = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      if (inData) {
        if (line === ".") { inData = false; mails.push({ to, data }); data = ""; reply("250 queued"); } else data += `${line}\n`;
        continue;
      }
      if (stage === "user") { login = Buffer.from(line, "base64").toString(); stage = "pass"; reply("334 UGFzc3dvcmQ6"); continue; }
      if (stage === "pass") { stage = ""; check(login ?? "", Buffer.from(line, "base64").toString()); continue; }
      const cmd = line.toUpperCase();
      if (cmd.startsWith("EHLO")) sock.write("250-test\r\n250 AUTH PLAIN LOGIN\r\n");
      else if (cmd.startsWith("AUTH PLAIN")) { const [, u, p] = Buffer.from(line.split(" ")[2] ?? "", "base64").toString().split("\0"); check(u ?? "", p ?? ""); }
      else if (cmd.startsWith("AUTH LOGIN")) { stage = "user"; reply("334 VXNlcm5hbWU6"); }
      else if (cmd.startsWith("MAIL FROM")) reply(authed ? "250 OK" : "530 5.7.0 Authentication required");
      else if (cmd.startsWith("RCPT TO")) { to = line.slice(8); reply("250 OK"); }
      else if (cmd === "DATA") { inData = true; reply("354 go"); }
      else if (cmd === "QUIT") { reply("221 bye"); sock.end(); }
      else reply("250 OK");
    }
  });
  sock.on("error", () => undefined);
});

const listen = (server: net.Server) => new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
const waitFor = async (predicate: () => boolean, ms = 5_000) => {
  const end = Date.now() + ms;
  while (!predicate() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  return predicate();
};
const settingsRow = () => prisma.instanceSetting.findUnique({ where: { id: INSTANCE_SETTINGS_ID } });
const audits = (action: string) => prisma.auditEvent.findMany({ where: { action, actorUserId: env.superAdmin.id }, orderBy: { createdAt: "asc" } });

function clientErrorRequest(body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("http://127.0.0.1/api/client-errors", {
    method: "POST",
    body: text,
    headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(text)), "sec-fetch-site": "same-origin", "x-forwarded-for": "198.51.100.10", ...headers },
  });
}

const outboxIds: string[] = [];
const smtpBase = { smtpHost: "127.0.0.1", smtpSecure: false, smtpUser: SMTP_USER, smtpAllowUnauthenticated: false, emailFrom: "Yuyu Tests <noreply@example.test>" };

beforeAll(async () => {
  webhookUrl = `http://127.0.0.1:${await listen(webhook)}/hooks/${suffix}`;
  smtpPort = await listen(smtp);
  const user = await prisma.user.create({ data: { email: `ops-admin-${suffix}@example.test`, name: "Ops admin" } });
  env.superAdmin = { id: user.id, email: user.email! };
  await prisma.instanceSetting.deleteMany({ where: { id: INSTANCE_SETTINGS_ID } });
});

beforeEach(() => {
  posts.length = 0;
  mails.length = 0;
  invalidateOpsAlertSettings();
});

afterAll(async () => {
  await prisma.outboxMessage.deleteMany({ where: { id: { in: outboxIds } } });
  await prisma.instanceSetting.deleteMany({ where: { id: INSTANCE_SETTINGS_ID } });
  await prisma.user.delete({ where: { id: env.superAdmin.id } });
  await prisma.$disconnect();
  webhook.close();
  smtp.close();
});

describe("alert webhook settings (super-admin)", () => {
  it("rejects invalid URLs and turning alerts on without a URL", async () => {
    expect(await saveOpsWebhookSettings({ enabled: true, includeWarnings: true, url: "ftp://example.test/x" })).toMatchObject({ ok: false });
    expect(await saveOpsWebhookSettings({ enabled: true, includeWarnings: true, url: "https://user:pw@example.test/x" })).toMatchObject({ ok: false });
    expect(await saveOpsWebhookSettings({ enabled: true, includeWarnings: true })).toMatchObject({ ok: false, error: expect.stringMatching(/webhook URL/i) });
  });

  it("stores the URL encrypted only, audits booleans only, and sends a test to the saved URL", async () => {
    expect(await saveOpsWebhookSettings({ enabled: true, includeWarnings: true, url: webhookUrl })).toEqual({ ok: true });
    const row = await settingsRow();
    expect(row?.opsWebhookEnabled).toBe(true);
    expect(row?.opsWebhookUrlEncrypted).toBeTruthy();
    expect(row?.opsWebhookUrlEncrypted).not.toContain(suffix);
    const [audit] = await audits("OPS_WEBHOOK_SETTINGS_UPDATED");
    expect(JSON.stringify(audit?.metadata)).not.toContain(suffix);

    expect(await sendOpsWebhookTest({})).toEqual({ ok: true });
    expect(posts.at(-1)).toMatch(/Test alert/);
  });

  it("removing the URL also turns alerts off", async () => {
    expect(await saveOpsWebhookSettings({ enabled: true, includeWarnings: true, removeUrl: true })).toMatchObject({ ok: false });
    expect(await saveOpsWebhookSettings({ enabled: false, includeWarnings: true, removeUrl: true })).toEqual({ ok: true });
    const row = await settingsRow();
    expect(row).toMatchObject({ opsWebhookEnabled: false, opsWebhookUrlEncrypted: null });
    expect(await saveOpsWebhookSettings({ enabled: true, includeWarnings: true, url: webhookUrl })).toEqual({ ok: true });
  });
});

describe("POST /api/client-errors (public)", () => {
  it("always answers an empty 204 and ignores cross-site, oversized and malformed reports", async () => {
    for (const request of [
      clientErrorRequest({ boundary: "route", message: `cross ${suffix}` }, { "sec-fetch-site": "cross-site" }),
      clientErrorRequest({ boundary: "route", message: "x".repeat(5_000) }),
      clientErrorRequest("{not json"),
      clientErrorRequest({ boundary: "elsewhere", message: `bad boundary ${suffix}` }),
    ]) {
      const response = await reportClientError(request);
      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
    }
    await new Promise((r) => setTimeout(r, 300));
    expect(posts).toEqual([]);
  });

  it("forwards a crash with the attendee email redacted and the ticket token stripped from the path", async () => {
    const token = `tkt${suffix}${"a".repeat(24)}`;
    const response = await reportClientError(clientErrorRequest({
      boundary: "route", name: "TypeError", message: `Cannot read x for attendee@example.org ${suffix}`, path: `/ticket/${token}?ref=mail`,
    }, { "x-forwarded-for": runIp(11) }));
    expect(response.status).toBe(204);
    expect(await waitFor(() => posts.length > 0)).toBe(true);
    const text = posts.join("\n");
    expect(text).toMatch(/Page crashed in the browser/);
    expect(text).toContain("/ticket/:id");
    expect(text).toContain("[redacted email]");
    expect(text).not.toContain(token);
    expect(text).not.toContain("attendee@example.org");
    expect(text).not.toContain("ref=mail");
  });

  it("rate limits reports per client IP (10 per minute)", async () => {
    for (let i = 0; i < 14; i++) {
      expect((await reportClientError(clientErrorRequest({ boundary: "global", message: `burst ${i} ${suffix}` }, { "x-forwarded-for": runIp(12) }))).status).toBe(204);
    }
    await waitFor(() => posts.length >= 10);
    await new Promise((r) => setTimeout(r, 300));
    expect(posts.length).toBe(10);
  });
});

describe("panel SMTP settings and the test email", () => {
  it("saves SMTP write-only and replaces the environment as a whole", async () => {
    const before = { ...process.env };
    process.env.SMTP_SERVICE = "gmail";
    process.env.SMTP_USER = "env-user@example.test";
    process.env.SMTP_PASSWORD = "env-password";
    try {
      expect(await saveInstanceServiceSettings({ ...smtpBase, smtpPort: smtpPort, smtpPassword: SMTP_PASSWORD })).toEqual({ ok: true });
      const row = await settingsRow();
      expect(row?.smtpPasswordEncrypted).toBeTruthy();
      expect(row?.smtpPasswordEncrypted).not.toContain(SMTP_PASSWORD);
      const status = await getEmailSettingsStatus();
      expect(status).toMatchObject({ source: "database", host: "127.0.0.1", port: smtpPort, user: SMTP_USER, hasPassword: true, passwordUnreadable: false });
      expect(status.service).toBeUndefined();
      expect(JSON.stringify(status)).not.toContain(SMTP_PASSWORD);
    } finally {
      process.env = before;
    }
  });

  it("sends the test email to the signed-in super-admin with the saved credentials", async () => {
    expect(await sendInstanceTestEmail()).toEqual({ ok: true });
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toContain(env.superAdmin.email);
    const [audit] = (await audits("INSTANCE_TEST_EMAIL_SENT")).slice(-1);
    expect(audit?.metadata).toMatchObject({ delivered: true, source: "database" });
  });

  it("explains a rejected password (the revoked app-password case) without leaking it, and alerts", async () => {
    expect(await saveInstanceServiceSettings({ ...smtpBase, smtpPort: smtpPort, smtpPassword: "revoked-app-password" })).toEqual({ ok: true });
    const result = await sendInstanceTestEmail();
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/rejected the username or password/) });
    expect(JSON.stringify(result)).not.toContain("revoked-app-password");
    expect(await waitFor(() => posts.some((p) => /test email failed/i.test(p)))).toBe(true);
    expect(posts.join("\n")).not.toContain("revoked-app-password");
  });

  it("keeps the stored password when the field is left blank, and clears it with the SMTP config", async () => {
    expect(await saveInstanceServiceSettings({ ...smtpBase, smtpPort: smtpPort, smtpPassword: SMTP_PASSWORD })).toEqual({ ok: true });
    const stored = (await settingsRow())?.smtpPasswordEncrypted;
    expect(await saveInstanceServiceSettings({ ...smtpBase, smtpPort: smtpPort, smtpPassword: "" })).toEqual({ ok: true });
    expect((await settingsRow())?.smtpPasswordEncrypted).toBe(stored);
    expect(await sendInstanceTestEmail()).toEqual({ ok: true });

    expect(await saveInstanceServiceSettings({ smtpSecure: false, smtpAllowUnauthenticated: false, smtpHost: "", smtpUser: "", smtpPassword: "" })).toEqual({ ok: true });
    expect(await settingsRow()).toMatchObject({ smtpHost: null, smtpUser: null, smtpPasswordEncrypted: null });
  });

  it("rejects header injection in the sender", async () => {
    expect(await saveInstanceServiceSettings({ ...smtpBase, smtpPort: smtpPort, emailFrom: "Ops <ops@example.test>\r\nBcc: x@evil.test" })).toMatchObject({ ok: false });
  });
});

describe("outbox failures, alerts and requeue", () => {
  it("alerts on a failed delivery without the recipient address, then requeue resets attempts", async () => {
    expect(await saveInstanceServiceSettings({ ...smtpBase, smtpPort: smtpPort, smtpPassword: "wrong-password" })).toEqual({ ok: true });
    const recipient = `recipient-${suffix}@example.org`;
    const message = await prisma.outboxMessage.create({ data: { kind: "collaborator-invite", payload: { to: recipient, eventTitle: "Ops test", inviteUrl: "https://example.test/i/x" } } });
    outboxIds.push(message.id);
    await deliverOutboxBatch(100);
    expect(await waitFor(() => posts.some((p) => /Email delivery failed/.test(p)))).toBe(true);
    const alert = posts.find((p) => /Email delivery failed/.test(p))!;
    expect(alert).toContain("collaborator-invite");
    expect(alert).not.toContain(recipient);

    await prisma.outboxMessage.update({ where: { id: message.id }, data: { status: OutboxStatus.FAILED, attempts: 8, lockedAt: null, availableAt: new Date(Date.now() + 3_600_000) } });
    const retried = await retryFailedOutboxMessages();
    expect(retried.ok && retried.data!.retried).toBeGreaterThanOrEqual(1);
    expect(await prisma.outboxMessage.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({ status: OutboxStatus.PENDING, attempts: 0, lastError: null });

    expect(await saveInstanceServiceSettings({ ...smtpBase, smtpPort: smtpPort, smtpPassword: SMTP_PASSWORD })).toEqual({ ok: true });
    await deliverOutboxBatch(100);
    expect(mails.some((m) => m.to.includes(recipient))).toBe(true);
  });
});
