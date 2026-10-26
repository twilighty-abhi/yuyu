import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  rateLimited: vi.fn(),
  orgFind: vi.fn(),
  membership: vi.fn(),
  eventFind: vi.fn(),
  userFind: vi.fn(),
  broadcastCreate: vi.fn(),
  rsvpFindMany: vi.fn(),
  outboxCreateMany: vi.fn(),
  outboxCreate: vi.fn(),
  audit: vi.fn(),
  startWorker: vi.fn(),
  draftDeleteMany: vi.fn(),
  draftUpsert: vi.fn(),
  draftFindUnique: vi.fn(),
}));

const tx = {
  rSVP: { findMany: mocks.rsvpFindMany },
  eventBroadcast: { create: mocks.broadcastCreate },
  eventBroadcastDraft: { deleteMany: mocks.draftDeleteMany },
  outboxMessage: { createMany: mocks.outboxCreateMany, create: mocks.outboxCreate },
};

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.rateLimited }));
vi.mock("@/lib/permissions", () => ({
  getMembership: mocks.membership,
  canManageEvents: (m: { role: string } | null) => m?.role === "OWNER" || m?.role === "ADMIN",
}));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("@/lib/outboxWorker", () => ({ startOutboxWorker: mocks.startWorker }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {
  organisation: { findUnique: mocks.orgFind },
  event: { findFirst: mocks.eventFind },
  user: { findUnique: mocks.userFind },
  rSVP: { findMany: mocks.rsvpFindMany },
  outboxMessage: { createMany: mocks.outboxCreateMany, create: mocks.outboxCreate },
  eventBroadcastDraft: { deleteMany: mocks.draftDeleteMany, upsert: mocks.draftUpsert, findUnique: mocks.draftFindUnique },
  $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
} }));

import {
  countBroadcastRecipients,
  discardEventBroadcastDraft,
  loadEventBroadcastDraft,
  previewEventBroadcast,
  saveEventBroadcastDraft,
  sendEventBroadcast,
  sendEventBroadcastTest,
} from "@/app/actions/broadcasts";
import { sendEventBroadcastForUser } from "@/lib/core/broadcasts";

// Expected links below use this base URL; pin it so a release environment's
// NEXT_PUBLIC_BASE_URL cannot change them.
beforeAll(() => {
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "http://localhost:3000");
});
afterAll(() => {
  vi.unstubAllEnvs();
});

const baseInput = {
  organisationSlug: "org-a",
  eventId: "event_1",
  statuses: ["CONFIRMED", "WAITLISTED"],
  attendance: "ANY",
  subject: "Doors open at 6",
  body: '<p onclick="x()">Hello {{name}}, see you at <strong>{{event}}</strong>.</p><script>alert(1)</script><p><a class="cta" href="{{ticketLink}}">Ticket</a></p>',
};
const cleanedBody = '<p>Hello {{name}}, see you at <strong>{{event}}</strong>.</p><p><a class="cta" href="{{ticketLink}}">Ticket</a></p>';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "admin_1" } });
  mocks.rateLimited.mockResolvedValue(false);
  mocks.orgFind.mockResolvedValue({ id: "org_a", slug: "org-a" });
  mocks.membership.mockResolvedValue({ role: "ADMIN" });
  mocks.eventFind.mockResolvedValue({
    id: "event_1", title: "Mixer", slug: "mixer", startDateTime: new Date("2030-03-07T12:30:00.000Z"), timezone: "Asia/Kolkata",
    location: "Hall A", isOnline: false, organisation: { name: "Org", slug: "org" },
  });
  mocks.rsvpFindMany.mockResolvedValue([
    { id: "rsvp_1", guestEmail: "a@example.test", user: null },
    { id: "rsvp_2", guestEmail: null, user: { email: "b@example.test" } },
  ]);
  mocks.broadcastCreate.mockResolvedValue({ id: "broadcast_1" });
  mocks.outboxCreateMany.mockResolvedValue({ count: 2 });
  mocks.outboxCreate.mockResolvedValue({ id: "msg_1" });
  mocks.userFind.mockResolvedValue({ email: "admin@example.test", emailVerified: new Date(), name: "Admin" });
  mocks.draftDeleteMany.mockResolvedValue({ count: 1 });
  mocks.draftUpsert.mockResolvedValue({ updatedAt: new Date("2030-01-01T10:00:00.000Z") });
  mocks.draftFindUnique.mockResolvedValue(null);
});

describe("event broadcast actions", () => {
  it("binds the event lookup to the authorised organisation", async () => {
    await expect(sendEventBroadcast(baseInput)).resolves.toEqual({ ok: true, data: { broadcastId: "broadcast_1", recipientCount: 2 } });
    expect(mocks.eventFind).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "event_1", organisationId: "org_a" } }));
    expect(mocks.broadcastCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      eventId: "event_1",
      createdByUserId: "admin_1",
      statuses: ["CONFIRMED", "WAITLISTED"],
      attendance: "ANY",
      recipientCount: 2,
      body: cleanedBody,
    }) }));
    expect(mocks.outboxCreateMany).toHaveBeenCalledWith({ data: [
      { kind: "event-broadcast", payload: { to: "a@example.test", broadcastId: "broadcast_1", rsvpId: "rsvp_1" } },
      { kind: "event-broadcast", payload: { to: "b@example.test", broadcastId: "broadcast_1", rsvpId: "rsvp_2" } },
    ] });
    expect(mocks.startWorker).toHaveBeenCalled();
  });

  it("writes an audit event without recipient addresses or message text", async () => {
    await sendEventBroadcast(baseInput);
    const call = mocks.audit.mock.calls[0]?.[0];
    expect(call).toEqual(expect.objectContaining({ action: "EVENT_BROADCAST_QUEUED", organisationId: "org_a", targetId: "broadcast_1" }));
    const serialized = JSON.stringify(call);
    expect(serialized).not.toContain("example.test");
    expect(serialized).not.toContain("Doors open");
  });

  it("refuses members who cannot manage events", async () => {
    mocks.membership.mockResolvedValue({ role: "MEMBER" });
    await expect(sendEventBroadcast(baseInput)).resolves.toEqual({ ok: false, error: "You do not have permission to email attendees." });
    expect(mocks.outboxCreateMany).not.toHaveBeenCalled();
    await expect(countBroadcastRecipients(baseInput)).resolves.toEqual({ ok: false, error: "You do not have permission to email attendees." });
  });

  it("refuses an event that belongs to another organisation", async () => {
    mocks.eventFind.mockResolvedValue(null);
    await expect(sendEventBroadcast(baseInput)).resolves.toEqual({ ok: false, error: "Event not found." });
    expect(mocks.broadcastCreate).not.toHaveBeenCalled();
  });

  it("does not create a broadcast when nobody matches the audience", async () => {
    mocks.rsvpFindMany.mockResolvedValue([]);
    await expect(sendEventBroadcast(baseInput)).resolves.toEqual({ ok: false, error: "No registrations match the selected audience." });
    expect(mocks.broadcastCreate).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("rejects empty audiences and oversized messages before touching the database", async () => {
    const noStatus = await sendEventBroadcast({ ...baseInput, statuses: [] });
    expect(noStatus.ok).toBe(false);
    const tooLong = await sendEventBroadcast({ ...baseInput, body: "x".repeat(20001) });
    expect(tooLong.ok).toBe(false);
    expect(mocks.orgFind).not.toHaveBeenCalled();
  });

  it("applies the broadcast rate limit", async () => {
    mocks.rateLimited.mockResolvedValue(true);
    const result = await sendEventBroadcast(baseInput);
    expect(result.ok).toBe(false);
    expect(mocks.orgFind).not.toHaveBeenCalled();
  });

  it("limits test sends in their own bucket so testing never blocks the real send", async () => {
    mocks.rateLimited.mockImplementation(async (bucket: string) => bucket === "broadcastTest");
    expect((await sendEventBroadcastTest(baseInput)).ok).toBe(false);
    expect(mocks.orgFind).not.toHaveBeenCalled();
    expect(mocks.rateLimited).toHaveBeenCalledWith("broadcastTest", expect.any(String));
    expect(mocks.rateLimited).not.toHaveBeenCalledWith("broadcast", expect.any(String));
  });

  it("reports the deduplicated recipient count", async () => {
    mocks.rsvpFindMany.mockResolvedValue([
      { id: "rsvp_1", guestEmail: "same@example.test", user: null },
      { id: "rsvp_2", guestEmail: null, user: { email: "SAME@example.test" } },
    ]);
    await expect(countBroadcastRecipients(baseInput)).resolves.toEqual({ ok: true, data: { count: 1 } });
  });

  it("sends a test only to the organiser's own verified address", async () => {
    await expect(sendEventBroadcastTest(baseInput)).resolves.toEqual({ ok: true, data: { to: "admin@example.test" } });
    expect(mocks.outboxCreate).toHaveBeenCalledWith({ data: { kind: "event-broadcast-test", payload: {
      to: "admin@example.test",
      eventId: "event_1",
      subject: "Doors open at 6",
      body: cleanedBody,
      design: "classic",
      recipientName: "Admin",
    } } });

    mocks.userFind.mockResolvedValue({ email: "admin@example.test", emailVerified: null, name: null });
    await expect(sendEventBroadcastTest(baseInput)).resolves.toEqual({ ok: false, error: "Verify your own email address before sending a test." });
  });

  it("rejects a message that is empty after sanitising", async () => {
    await expect(sendEventBroadcast({ ...baseInput, body: "<p></p><script>alert(1)</script>" })).resolves.toEqual({ ok: false, error: "The message is empty." });
    expect(mocks.broadcastCreate).not.toHaveBeenCalled();
  });

  it("previews the exact email with sample values and the event's own links", async () => {
    const result = await previewEventBroadcast(baseInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data?.subject).toBe("Doors open at 6");
    expect(result.data?.html).toContain("Hello Priya, see you at <strong>Mixer</strong>.");
    expect(result.data?.html).toContain('href="http://localhost:3000/org/mixer" style="display: inline-block;');
    expect(result.data?.html).not.toContain("onclick");
    expect(result.data?.text).toContain("Ticket (http://localhost:3000/org/mixer)");
  });

  it("clears the sender's own draft inside the send transaction from the dashboard only", async () => {
    await sendEventBroadcast(baseInput);
    expect(mocks.draftDeleteMany).toHaveBeenCalledWith({ where: { eventId: "event_1", userId: "admin_1" } });

    mocks.draftDeleteMany.mockClear();
    expect((await sendEventBroadcastForUser("admin_1", baseInput)).ok).toBe(true);
    expect(mocks.draftDeleteMany).not.toHaveBeenCalled();

    mocks.rsvpFindMany.mockResolvedValue([]);
    await sendEventBroadcast(baseInput);
    expect(mocks.draftDeleteMany).not.toHaveBeenCalled();
  });
});

const draftInput = {
  organisationSlug: "org-a",
  eventId: "event_1",
  subject: "Half-written",
  body: baseInput.body,
  design: "letter",
  statuses: ["CONFIRMED"],
  attendance: "CHECKED_IN",
  templateId: "reminder",
};

describe("event broadcast drafts", () => {
  it("saves the sanitised body for the signed-in organiser only", async () => {
    await expect(saveEventBroadcastDraft(draftInput)).resolves.toEqual({ ok: true, data: { updatedAt: "2030-01-01T10:00:00.000Z" } });
    const content = { subject: "Half-written", body: cleanedBody, design: "letter", statuses: ["CONFIRMED"], attendance: "CHECKED_IN", templateId: "reminder" };
    expect(mocks.draftUpsert).toHaveBeenCalledWith({
      where: { eventId_userId: { eventId: "event_1", userId: "admin_1" } },
      create: { eventId: "event_1", userId: "admin_1", ...content },
      update: content,
      select: { updatedAt: true },
    });
    expect(mocks.eventFind).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "event_1", organisationId: "org_a" } }));
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("accepts work in progress but keeps the send schema's length limits", async () => {
    expect((await saveEventBroadcastDraft({ ...draftInput, subject: "", body: "", statuses: [] })).ok).toBe(true);
    expect((await saveEventBroadcastDraft({ ...draftInput, subject: "x".repeat(151) })).ok).toBe(false);
    expect((await saveEventBroadcastDraft({ ...draftInput, body: "x".repeat(20001) })).ok).toBe(false);
    expect((await saveEventBroadcastDraft({ ...draftInput, design: "neon" })).ok).toBe(false);
    expect((await saveEventBroadcastDraft({ ...draftInput, recipientCount: 5 })).ok).toBe(false);
    expect(mocks.draftUpsert).toHaveBeenCalledTimes(1);
  });

  it("drops unknown template ids and duplicate statuses", async () => {
    await saveEventBroadcastDraft({ ...draftInput, templateId: "not-a-template", statuses: ["CONFIRMED", "CONFIRMED", "WAITLISTED"] });
    expect(mocks.draftUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ templateId: null, statuses: ["CONFIRMED", "WAITLISTED"] }) }));
  });

  it("uses its own autosave rate-limit bucket", async () => {
    mocks.rateLimited.mockImplementation(async (bucket: string) => bucket === "broadcastDraft");
    expect((await saveEventBroadcastDraft(draftInput)).ok).toBe(false);
    expect((await discardEventBroadcastDraft(draftInput)).ok).toBe(false);
    expect(mocks.orgFind).not.toHaveBeenCalled();
    expect(mocks.rateLimited).not.toHaveBeenCalledWith("broadcast", expect.any(String));
    // Loading is read-only and not limited.
    expect((await loadEventBroadcastDraft(draftInput)).ok).toBe(true);
  });

  it("refuses members, signed-out callers, and other organisations' events", async () => {
    mocks.membership.mockResolvedValue({ role: "MEMBER" });
    for (const call of [saveEventBroadcastDraft, loadEventBroadcastDraft, discardEventBroadcastDraft]) {
      await expect(call(draftInput)).resolves.toEqual({ ok: false, error: "You do not have permission to email attendees." });
    }
    mocks.membership.mockResolvedValue({ role: "OWNER" });
    mocks.eventFind.mockResolvedValue(null);
    await expect(saveEventBroadcastDraft(draftInput)).resolves.toEqual({ ok: false, error: "Event not found." });
    mocks.auth.mockResolvedValue(null);
    await expect(loadEventBroadcastDraft(draftInput)).resolves.toEqual({ ok: false, error: "You must be signed in." });
    expect(mocks.draftUpsert).not.toHaveBeenCalled();
    expect(mocks.draftFindUnique).not.toHaveBeenCalled();
    expect(mocks.draftDeleteMany).not.toHaveBeenCalled();
  });

  it("loads and discards only the caller's own draft", async () => {
    mocks.draftFindUnique.mockResolvedValue({ subject: "S", body: "<p>B</p>", design: "retired-design", statuses: ["CONFIRMED"], attendance: "ANY", templateId: null, updatedAt: new Date("2030-01-01T10:00:00.000Z") });
    await expect(loadEventBroadcastDraft(draftInput)).resolves.toEqual({ ok: true, data: { draft: {
      subject: "S", body: "<p>B</p>", design: "classic", statuses: ["CONFIRMED"], attendance: "ANY", templateId: null, updatedAt: "2030-01-01T10:00:00.000Z",
    } } });
    expect(mocks.draftFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { eventId_userId: { eventId: "event_1", userId: "admin_1" } } }));
    await expect(discardEventBroadcastDraft(draftInput)).resolves.toEqual({ ok: true, data: { discarded: true } });
    expect(mocks.draftDeleteMany).toHaveBeenCalledWith({ where: { eventId: "event_1", userId: "admin_1" } });
  });

  it("returns a UI-safe error when the database write fails", async () => {
    mocks.draftUpsert.mockRejectedValue(new Error("connection reset with secret detail"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(saveEventBroadcastDraft(draftInput)).resolves.toEqual({ ok: false, error: "Could not save the draft. Please try again." });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("secret detail");
    errorLog.mockRestore();
  });
});
