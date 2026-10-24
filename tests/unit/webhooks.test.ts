import { afterEach, describe, expect, it } from "vitest";
import {
  computeWebhookSignature,
  generateWebhookSecret,
  isWebhookSecretShape,
  verifyWebhookSignature,
  webhookSignatureHeader,
} from "@/lib/webhooks/signature";
import {
  isBlockedWebhookAddress,
  parseIpv6,
  parseWebhookUrl,
  pinnedLookup,
  resolveWebhookTarget,
  setWebhookResolverForTests,
  webhookHostLabel,
  webhookPrivateTargetsAllowed,
  WebhookTargetBlockedError,
} from "@/lib/webhooks/urlSafety";
import { buildWebhookEnvelope, webhookEventRef, webhookRegistration } from "@/lib/webhooks/payloads";
import { decryptWebhookSecret, encryptWebhookSecret, WebhookSecretUnreadableError } from "@/lib/webhooks/secrets";
import { decryptInstanceConfigSecret, encryptInstanceConfigSecret } from "@/lib/instanceConfigSecrets";
import { WEBHOOK_MAX_ATTEMPTS, WEBHOOK_RETRY_DELAYS_MS, describeWebhookFailure, webhookRetryDelayMs } from "@/lib/webhooks/delivery";
import { WEBHOOK_EVENT_TYPES, isWebhookEventType } from "@/lib/webhooks/eventTypes";

const strict = { allowPrivate: false };

describe("webhook signatures", () => {
  const secret = "whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const body = '{"id":"evt_00000000000000000000000000000000","type":"ping"}';

  it("matches a fixed HMAC-SHA256 vector over `<t>.<body>`", () => {
    // Computed independently: printf '%s' "1700000000.$body" | openssl dgst -sha256 -hmac "$secret"
    expect(computeWebhookSignature(secret, 1700000000, body)).toBe("7f0318ef388628a7960cec37512946979befef296cf1da4198cce59d12a85144");
    expect(webhookSignatureHeader(secret, 1700000000, body)).toBe("t=1700000000,v1=7f0318ef388628a7960cec37512946979befef296cf1da4198cce59d12a85144");
  });

  it("verifies a good signature and rejects tampering, staleness, wrong secrets and bad headers", () => {
    const header = webhookSignatureHeader(secret, 1700000000, body);
    expect(verifyWebhookSignature({ secret, header, body, now: 1700000100 })).toBe(true);
    expect(verifyWebhookSignature({ secret, header, body: body.replace("ping", "pong"), now: 1700000100 })).toBe(false);
    expect(verifyWebhookSignature({ secret, header, body, now: 1700000000 + 301 })).toBe(false);
    expect(verifyWebhookSignature({ secret: generateWebhookSecret(), header, body, now: 1700000100 })).toBe(false);
    for (const bad of [null, "", "v1=abc", "t=1700000000", "t=x,v1=" + "0".repeat(64), "t=1700000000,v1=zz"]) {
      expect(verifyWebhookSignature({ secret, header: bad, body, now: 1700000100 })).toBe(false);
    }
  });

  it("generates whsec_ secrets from 32 random bytes", () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(isWebhookSecretShape(a)).toBe(true);
    expect(Buffer.from(a.slice("whsec_".length), "base64url")).toHaveLength(32);
    expect(a).not.toBe(b);
  });
});

describe("webhook secret encryption", () => {
  const previous = process.env.MFA_ENCRYPTION_KEY;
  afterEach(() => {
    process.env.MFA_ENCRYPTION_KEY = previous;
  });

  it("round-trips with AES-GCM under a key separate from instance settings", () => {
    process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const secret = generateWebhookSecret();
    const ciphertext = encryptWebhookSecret(secret);
    expect(ciphertext).not.toContain(secret.slice(6));
    expect(decryptWebhookSecret(ciphertext)).toBe(secret);
    // Domain separation: neither ciphertext opens with the other key.
    expect(() => decryptInstanceConfigSecret(ciphertext)).toThrow();
    expect(() => decryptWebhookSecret(encryptInstanceConfigSecret(secret))).toThrow(WebhookSecretUnreadableError);
    process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64");
    expect(() => decryptWebhookSecret(ciphertext)).toThrow(WebhookSecretUnreadableError);
  });
});

describe("webhook target rules", () => {
  afterEach(() => setWebhookResolverForTests(null));

  it.each([
    "0.0.0.0", "10.1.2.3", "100.64.0.1", "100.127.255.254", "127.0.0.1", "127.255.255.255", "169.254.169.254", "169.254.0.1",
    "172.16.0.1", "172.31.255.255", "192.0.0.8", "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.7", "203.0.113.9",
    "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "::ffff:10.0.0.1", "::127.0.0.1",
    "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%en0", "fec0::1", "ff02::1", "100::1", "2001:db8::1", "2001::1",
    "64:ff9b::7f00:1", "64:ff9b:1::1", "2002:7f00:1::1", "3fff::1", "[::1]", "not-an-ip",
  ])("blocks %s", (address) => {
    expect(isBlockedWebhookAddress(address)).toBe(true);
  });

  it.each(["93.184.216.34", "1.1.1.1", "8.8.8.8", "2606:4700:4700::1111", "::ffff:93.184.216.34", "64:ff9b::808:808", "2002:5db8:d822::1"])(
    "allows public %s",
    (address) => {
      expect(isBlockedWebhookAddress(address)).toBe(false);
    },
  );

  it("parses IPv6 including embedded IPv4 and zones", () => {
    expect(parseIpv6("::ffff:127.0.0.1")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    expect(parseIpv6("[fe80::1%eth0]")).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6("1::2::3")).toBeNull();
  });

  it.each([
    ["http://example.com/hook", /https/],
    ["ftp://example.com/hook", /https/],
    ["https://user:pass@example.com/hook", /user name or password/],
    ["https://example.com:8080/hook", /443 or 8443/],
    ["https://example.com:80/hook", /443 or 8443/],
    ["https://localhost/hook", /public host/],
    ["https://localhost./hook", /public host/],
    ["https://app.localhost/hook", /public host/],
    ["https://printer.local/hook", /public host/],
    ["https://metadata.google.internal/hook", /public host/],
    ["https://intranet/hook", /public host/],
    ["https://127.0.0.1/hook", /private or reserved/],
    ["https://2130706433/hook", /private or reserved/], // decimal 127.0.0.1
    ["https://0x7f000001/hook", /private or reserved/], // hex 127.0.0.1
    ["https://0x7f.1/hook", /private or reserved/],
    ["https://0177.0.0.1/hook", /private or reserved/], // octal
    ["https://169.254.169.254/latest/meta-data", /private or reserved/],
    ["https://[::1]/hook", /private or reserved/],
    ["https://[::ffff:127.0.0.1]/hook", /private or reserved/],
    ["https://[::ffff:a9fe:a9fe]/hook", /private or reserved/],
    ["https://[fd00::1]/hook", /private or reserved/],
    ["not a url", /valid URL/],
    ["", /2,048/],
  ])("rejects %s", (url, message) => {
    const parsed = parseWebhookUrl(url, strict);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(message);
  });

  it("accepts public https URLs on 443 and 8443 and drops the fragment", () => {
    expect(parseWebhookUrl("https://hooks.example.com/yuyu?x=1#frag", strict)).toEqual({ ok: true, url: "https://hooks.example.com/yuyu?x=1", host: "hooks.example.com" });
    expect(parseWebhookUrl("https://hooks.example.com:8443/yuyu", strict).ok).toBe(true);
    expect(parseWebhookUrl("https://hooks.example.com:443/yuyu", strict).ok).toBe(true);
    expect(parseWebhookUrl("https://93.184.216.34/yuyu", strict).ok).toBe(true);
  });

  it("allows http and loopback only with the development/test flag", () => {
    expect(parseWebhookUrl("http://127.0.0.1:4010/hook", { allowPrivate: true }).ok).toBe(true);
    expect(parseWebhookUrl("http://localhost:4010/hook", { allowPrivate: true }).ok).toBe(true);
    // Credentials stay forbidden even with the flag.
    expect(parseWebhookUrl("http://a:b@127.0.0.1:4010/hook", { allowPrivate: true }).ok).toBe(false);
  });

  it("never honours the flag in production outside the CI production-build test mode", () => {
    expect(webhookPrivateTargetsAllowed({ NODE_ENV: "development", WEBHOOKS_ALLOW_PRIVATE_TARGETS: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(webhookPrivateTargetsAllowed({ NODE_ENV: "test", WEBHOOKS_ALLOW_PRIVATE_TARGETS: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(webhookPrivateTargetsAllowed({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBe(false);
    expect(webhookPrivateTargetsAllowed({ NODE_ENV: "production", WEBHOOKS_ALLOW_PRIVATE_TARGETS: "1" } as NodeJS.ProcessEnv)).toBe(false);
    expect(webhookPrivateTargetsAllowed({ NODE_ENV: "production", WEBHOOKS_ALLOW_PRIVATE_TARGETS: "1", CI: "true" } as NodeJS.ProcessEnv)).toBe(false);
    expect(webhookPrivateTargetsAllowed({ NODE_ENV: "production", WEBHOOKS_ALLOW_PRIVATE_TARGETS: "1", CI: "true", ALLOW_INSECURE_PRODUCTION_TESTS: "1" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("refuses a host when any resolved address is private (DNS rebinding)", async () => {
    setWebhookResolverForTests(async (host) =>
      host === "mixed.example.com"
        ? [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]
        : host === "mapped.example.com"
          ? [{ address: "::ffff:10.0.0.5", family: 6 }]
          : [{ address: "93.184.216.34", family: 4 }],
    );
    await expect(resolveWebhookTarget("https://mixed.example.com/x", strict)).rejects.toBeInstanceOf(WebhookTargetBlockedError);
    await expect(resolveWebhookTarget("https://mapped.example.com/x", strict)).rejects.toBeInstanceOf(WebhookTargetBlockedError);
    await expect(resolveWebhookTarget("https://ok.example.com/x", strict)).resolves.toEqual([{ address: "93.184.216.34", family: 4 }]);
    await expect(resolveWebhookTarget("https://mixed.example.com/x", { allowPrivate: true })).resolves.toHaveLength(2);
  });

  it("pins the socket to the vetted addresses", () => {
    const lookup = pinnedLookup([{ address: "93.184.216.34", family: 4 }, { address: "2606:4700::1", family: 6 }]);
    const single: unknown[] = [];
    lookup("evil.example.com", {}, (...args) => single.push(...args));
    expect(single).toEqual([null, "93.184.216.34", 4]);
    const all: unknown[] = [];
    lookup("evil.example.com", { all: true, family: 6 }, (...args) => all.push(...args));
    expect(all).toEqual([null, [{ address: "2606:4700::1", family: 6 }]]);
  });

  it("labels audit metadata with the host only", () => {
    expect(webhookHostLabel("https://hooks.example.com:8443/secret-path?token=abc")).toBe("hooks.example.com:8443");
  });
});

describe("webhook payload DTOs", () => {
  const rsvpRow = {
    id: "rsvp_1",
    guestName: "  Ada Lovelace ",
    createdAt: new Date("2030-01-01T10:00:00.000Z"),
    checkedInAt: null,
    user: null,
    // Wider Prisma rows must never leak these.
    checkInToken: "tok_secret_checkin",
    guestEmail: "ada@example.com",
    attendeeKey: "guest:ada@example.com",
    answers: [{ valueText: "private answer" }],
    certificateToken: "cert_secret",
  };
  const eventRef = webhookEventRef({
    kind: "event",
    event: { id: "evt1", title: "Demo", slug: "demo", startDateTime: new Date("2030-01-02T09:00:00Z"), endDateTime: new Date("2030-01-02T17:00:00Z"), timezone: "UTC", ...{ checkInStationPinHash: "x", description: "long" } } as never,
  });

  it("copies only allow-listed registration fields", () => {
    const registration = webhookRegistration(rsvpRow, "CONFIRMED");
    expect(Object.keys(registration).sort()).toEqual(["checkedInAt", "displayName", "id", "registeredAt", "status"]);
    expect(registration.displayName).toBe("Ada Lovelace");
    expect(webhookRegistration({ ...rsvpRow, guestName: null }, "WAITLISTED").displayName).toBe("Participant");
    expect(Object.keys(eventRef).sort()).toEqual(["endDateTime", "id", "kind", "occurrenceId", "slug", "startDateTime", "timezone", "title"]);
  });

  it("never serialises tokens, emails or answers in any envelope", () => {
    const registration = webhookRegistration(rsvpRow, "CONFIRMED");
    const envelopes = [
      buildWebhookEnvelope({ id: `evt_${"a".repeat(32)}`, type: "registration.created", createdAt: new Date(), organisation: { id: "org1", slug: "acme" }, data: { event: eventRef, registration } }),
      buildWebhookEnvelope({ id: `evt_${"b".repeat(32)}`, type: "registration.status_changed", createdAt: new Date(), organisation: { id: "org1", slug: "acme" }, data: { event: eventRef, registration, previousStatus: "PENDING_APPROVAL" } }),
      buildWebhookEnvelope({ id: `evt_${"c".repeat(32)}`, type: "checkin.created", createdAt: new Date(), organisation: { id: "org1", slug: "acme" }, data: { event: eventRef, registration, checkedInAt: new Date().toISOString() } }),
      buildWebhookEnvelope({ id: `evt_${"d".repeat(32)}`, type: "feedback.submitted", createdAt: new Date(), organisation: { id: "org1", slug: "acme" }, data: { event: eventRef, feedback: { id: "fb1", submittedAt: new Date().toISOString() } } }),
    ];
    for (const envelope of envelopes) {
      const json = JSON.stringify(envelope);
      for (const forbidden of ["checkInToken", "tok_secret", "certificate", "cert_secret", "@", "answer", "attendeeKey", "guestEmail", "email", "userId", "secret", "Pin"]) {
        expect(json).not.toContain(forbidden);
      }
    }
  });

  it("rejects any extra field through the strict schemas", () => {
    const registration = webhookRegistration(rsvpRow, "CONFIRMED");
    expect(() => buildWebhookEnvelope({ id: `evt_${"e".repeat(32)}`, type: "registration.created", createdAt: new Date(), organisation: { id: "o", slug: "s" }, data: { event: eventRef, registration: { ...registration, checkInToken: "x" } } })).toThrow();
    expect(() => buildWebhookEnvelope({ id: `evt_${"e".repeat(32)}`, type: "registration.created", createdAt: new Date(), organisation: { id: "o", slug: "s" }, data: { event: eventRef, registration, answers: [] } })).toThrow();
    expect(() => buildWebhookEnvelope({ id: `evt_${"e".repeat(32)}`, type: "feedback.submitted", createdAt: new Date(), organisation: { id: "o", slug: "s" }, data: { event: eventRef, feedback: { id: "f", submittedAt: new Date().toISOString(), answers: [] } } })).toThrow();
    expect(() => buildWebhookEnvelope({ id: "not-an-event-id", type: "ping", createdAt: new Date(), organisation: { id: "o", slug: "s" }, data: { endpointId: "e", message: "m" } })).toThrow();
  });

  it("documents a known set of event types", () => {
    expect(WEBHOOK_EVENT_TYPES).toEqual([
      "registration.created",
      "registration.status_changed",
      "checkin.created",
      "checkin.undone",
      "event.published",
      "event.cancelled",
      "feedback.submitted",
    ]);
    expect(isWebhookEventType("ping")).toBe(false);
  });
});

describe("webhook retry policy", () => {
  it("makes 8 attempts over roughly a day with growing delays", () => {
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(8);
    expect(WEBHOOK_RETRY_DELAYS_MS).toHaveLength(WEBHOOK_MAX_ATTEMPTS - 1);
    for (let index = 1; index < WEBHOOK_RETRY_DELAYS_MS.length; index += 1) {
      expect(WEBHOOK_RETRY_DELAYS_MS[index]!).toBeGreaterThan(WEBHOOK_RETRY_DELAYS_MS[index - 1]!);
    }
    const nominal = WEBHOOK_RETRY_DELAYS_MS.reduce((sum, value) => sum + value, 0);
    expect(nominal / 3_600_000).toBeGreaterThan(20);
    expect(nominal / 3_600_000).toBeLessThan(26);
  });

  it("applies ±20% jitter and clamps out-of-range attempts", () => {
    expect(webhookRetryDelayMs(1, () => 0)).toBe(48_000);
    expect(webhookRetryDelayMs(1, () => 1)).toBe(72_000);
    expect(webhookRetryDelayMs(1, () => 0.5)).toBe(60_000);
    expect(webhookRetryDelayMs(7, () => 0.5)).toBe(12 * 3_600_000);
    expect(webhookRetryDelayMs(99, () => 0.5)).toBe(12 * 3_600_000);
    expect(webhookRetryDelayMs(0, () => 0.5)).toBe(60_000);
  });

  it("describes failures without URLs or secrets", () => {
    expect(describeWebhookFailure(Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:443 https://x/secret"), { code: "ECONNREFUSED" }))).toBe("Connection refused");
    expect(describeWebhookFailure(Object.assign(new Error("boom"), { code: "CERT_HAS_EXPIRED" }))).toBe("TLS error (CERT_HAS_EXPIRED)");
    expect(describeWebhookFailure(new WebhookTargetBlockedError())).toMatch(/^Blocked/);
    expect(describeWebhookFailure(new Error("https://user:pw@host/path"))).toBe("Network error");
  });
});
