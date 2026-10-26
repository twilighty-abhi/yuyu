import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  audit: vi.fn(),
  rateLimit: vi.fn(),
  user: vi.fn(),
  accounts: vi.fn(),
  memberships: vi.fn(),
  rsvps: vi.fn(),
  responses: vi.fn(),
  collaborators: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimitById: mocks.rateLimit }));
vi.mock("@/lib/db", () => ({ prisma: {
  user: { findUnique: mocks.user },
  account: { findMany: mocks.accounts },
  membership: { findMany: mocks.memberships },
  rSVP: { findMany: mocks.rsvps },
  eventFeedbackResponse: { findMany: mocks.responses },
  eventCollaborator: { findMany: mocks.collaborators },
} }));

import { GET } from "@/app/api/exports/account/route";
import { buildAccountDataExport, type AccountExportSource } from "@/lib/accountDataExport";

const SECRETS = {
  passwordHash: "$2b$12$secret-password-hash",
  mfaSecretEncrypted: "enc:mfa-seed-value",
  recoveryCodeHashes: ["recovery-hash-1"],
  sessionVersion: 7,
  checkInToken: "ticket-token-value",
  certificateToken: "certificate-token-value",
  access_token: "oauth-access-token",
  refresh_token: "oauth-refresh-token",
  id_token: "oauth-id-token",
};

/** Source rows polluted with secret columns, as if a loader over-selected. */
function pollutedSource(): AccountExportSource {
  const source = {
    user: {
      name: "Ada Lovelace",
      email: "ada@example.test",
      emailVerified: new Date("2030-01-01T00:00:00Z"),
      createdAt: new Date("2029-12-01T00:00:00Z"),
      mfaEnabledAt: new Date("2030-01-02T00:00:00Z"),
      passwordHash: SECRETS.passwordHash,
      mfaSecretEncrypted: SECRETS.mfaSecretEncrypted,
      recoveryCodeHashes: SECRETS.recoveryCodeHashes,
      sessionVersion: SECRETS.sessionVersion,
    },
    signInProviders: [{ provider: "google", access_token: SECRETS.access_token, refresh_token: SECRETS.refresh_token, id_token: SECRETS.id_token }],
    memberships: [{ role: "OWNER", createdAt: new Date("2030-01-03T00:00:00Z"), organisation: { name: "Analytical Society", slug: "analytical" } }],
    registrations: [{
      status: "CONFIRMED",
      createdAt: new Date("2030-02-01T00:00:00Z"),
      checkedInAt: new Date("2030-03-01T10:05:00Z"),
      checkInToken: SECRETS.checkInToken,
      event: { title: "Engines Meetup", startDateTime: new Date("2030-03-01T10:00:00Z"), endDateTime: new Date("2030-03-01T12:00:00Z"), timezone: "Europe/London", organisation: { name: "Analytical Society" } },
      eventInstance: null,
      answers: [{ valueText: "Analytical Engines", valueBool: null, valueNumber: null, valueDate: null, field: { label: "Company" } }],
    }],
    feedback: [{
      submittedAt: new Date("2030-03-02T00:00:00Z"),
      certificateToken: SECRETS.certificateToken,
      form: { event: { title: "Engines Meetup", organisation: { name: "Analytical Society" } } },
      answers: [{ fieldLabel: "Rating", valueText: null, valueBool: null, valueNumber: 5, valueDate: null }],
    }],
    collaborations: [{ permissions: ["CHECK_IN"], createdAt: new Date("2030-02-05T00:00:00Z"), event: { title: "Engines Meetup", organisation: { name: "Analytical Society" } }, series: null }],
  };
  return source as unknown as AccountExportSource;
}

describe("account data export shaping", () => {
  it("includes the user's own attendance confirmation reply, never its token hash", () => {
    const source = pollutedSource();
    // A loader that over-selected the token hash must still not leak it.
    (source.registrations[0] as unknown as { attendanceCheck: unknown }).attendanceCheck = {
      sentAt: new Date("2030-02-27T09:00:00Z"),
      response: "NOT_ATTENDING",
      respondedAt: new Date("2030-02-27T10:00:00Z"),
      note: "Train strike",
      tokenHash: "a".repeat(64),
    };
    const data = buildAccountDataExport(source, new Date("2030-04-01T00:00:00Z"));
    expect(data.registrations[0]!.attendanceConfirmation).toEqual({
      askedAt: "2030-02-27T09:00:00.000Z",
      response: "NOT_ATTENDING",
      respondedAt: "2030-02-27T10:00:00.000Z",
      note: "Train strike",
    });
    expect(JSON.stringify(data)).not.toContain("a".repeat(64));
    expect(buildAccountDataExport(pollutedSource()).registrations[0]!.attendanceConfirmation).toBeNull();
  });

  it("includes the user's own data", () => {
    const data = buildAccountDataExport(pollutedSource(), new Date("2030-04-01T00:00:00Z"));
    expect(data.profile).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.test",
      emailVerified: true,
      emailVerifiedAt: "2030-01-01T00:00:00.000Z",
      accountCreatedAt: "2029-12-01T00:00:00.000Z",
      twoFactorAuthenticationEnabled: true,
      linkedSignInProviders: ["google"],
    });
    expect(data.memberships).toEqual([{ organisation: "Analytical Society", organisationSlug: "analytical", role: "OWNER", joinedAt: "2030-01-03T00:00:00.000Z" }]);
    expect(data.registrations[0]).toMatchObject({
      event: "Engines Meetup",
      organisation: "Analytical Society",
      type: "event",
      status: "CONFIRMED",
      checkedInAt: "2030-03-01T10:05:00.000Z",
      answers: [{ question: "Company", answer: "Analytical Engines" }],
    });
    expect(data.feedback[0]).toMatchObject({ certificateIssued: true, answers: [{ question: "Rating", answer: 5 }] });
    expect(data.eventCollaborations[0]).toMatchObject({ event: "Engines Meetup", type: "event", permissions: ["CHECK_IN"] });
  });

  it("never copies secrets, hashes, or bearer tokens into the file", () => {
    const json = JSON.stringify(buildAccountDataExport(pollutedSource()));
    for (const value of [SECRETS.passwordHash, SECRETS.mfaSecretEncrypted, SECRETS.recoveryCodeHashes[0], SECRETS.checkInToken, SECRETS.certificateToken, SECRETS.access_token, SECRETS.refresh_token, SECRETS.id_token]) {
      expect(json).not.toContain(value);
    }
    for (const key of ["passwordHash", "mfaSecret", "recoveryCode", "sessionVersion", "checkInToken", "certificateToken", "access_token", "refresh_token", "id_token"]) {
      expect(json).not.toContain(`"${key}`);
    }
  });
});

describe("account data export route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user_1" } });
    mocks.rateLimit.mockResolvedValue(true);
    mocks.user.mockResolvedValue({ name: "Ada", email: "ada@example.test", emailVerified: null, createdAt: new Date("2030-01-01T00:00:00Z"), mfaEnabledAt: null });
    mocks.accounts.mockResolvedValue([]);
    mocks.memberships.mockResolvedValue([]);
    mocks.rsvps.mockResolvedValue([]);
    mocks.responses.mockResolvedValue([]);
    mocks.collaborators.mockResolvedValue([]);
  });

  it("requires a signed-in user and reads nothing otherwise", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    for (const query of [mocks.user, mocks.memberships, mocks.rsvps, mocks.responses, mocks.collaborators]) expect(query).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("is rate limited per user before any data is read", async () => {
    mocks.rateLimit.mockResolvedValue(false);
    const response = await GET();
    expect(response.status).toBe(429);
    expect(mocks.rateLimit).toHaveBeenCalledWith("dataExport", "user:user_1");
    expect(mocks.rsvps).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("queries only the session user's rows and returns an audited, private attachment", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="yuyu-account-data-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(response.headers.get("cache-control")).toBe("private, no-store");

    expect(mocks.user.mock.calls[0][0].where).toEqual({ id: "user_1" });
    expect(mocks.accounts.mock.calls[0][0].where).toEqual({ userId: "user_1" });
    expect(mocks.memberships.mock.calls[0][0].where).toEqual({ userId: "user_1" });
    expect(mocks.rsvps.mock.calls[0][0].where).toEqual({ userId: "user_1" });
    expect(mocks.responses.mock.calls[0][0].where).toEqual({ rsvp: { is: { userId: "user_1" } } });
    expect(mocks.collaborators.mock.calls[0][0].where).toEqual({ userId: "user_1" });

    // Explicit selects never request secret columns.
    expect(mocks.user.mock.calls[0][0].select).not.toHaveProperty("passwordHash");
    expect(mocks.user.mock.calls[0][0].select).not.toHaveProperty("mfaSecretEncrypted");
    expect(mocks.user.mock.calls[0][0].select).not.toHaveProperty("recoveryCodeHashes");
    expect(mocks.accounts.mock.calls[0][0].select).toEqual({ provider: true });
    expect(mocks.rsvps.mock.calls[0][0].select).not.toHaveProperty("checkInToken");
    expect(mocks.rsvps.mock.calls[0][0].select.attendanceCheck).toEqual({ select: { sentAt: true, response: true, respondedAt: true, note: true } });

    expect(mocks.audit).toHaveBeenCalledWith({ action: "ACCOUNT_DATA_EXPORTED", actorUserId: "user_1", targetType: "User", targetId: "user_1" });
    const body = JSON.parse(await response.text());
    expect(body.profile.email).toBe("ada@example.test");
  });
});
