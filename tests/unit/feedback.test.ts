import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventStatus, RegistrationFieldType } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  eventFind: vi.fn(),
  formFind: vi.fn(),
  rsvpFind: vi.fn(),
  responseCreate: vi.fn(),
  transaction: vi.fn(),
  query: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: {
  event: { findFirst: mocks.eventFind },
  $transaction: mocks.transaction,
} }));

const tx = {
  $queryRaw: mocks.query,
  event: { findUnique: vi.fn() },
  eventFeedbackForm: { findUnique: mocks.formFind },
  rSVP: { findFirst: mocks.rsvpFind },
  eventFeedbackResponse: { create: mocks.responseCreate },
};

import { submitFeedback } from "@/lib/feedback";

const commentField = { id: "field_1", key: "comment", label: "Comment", type: RegistrationFieldType.TEXTAREA, required: true, options: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.eventFind.mockResolvedValue({ id: "event_1", feedbackForm: { id: "form_1" } });
  tx.event.findUnique.mockResolvedValue({ status: EventStatus.PUBLISHED });
  mocks.formFind.mockResolvedValue({ id: "form_1", isOpen: true, certificateEnabled: false, fields: [commentField] });
  mocks.responseCreate.mockResolvedValue({ id: "response_1" });
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
});

describe("feedback privacy and validation", () => {
  it("uses the privacy mode read under the form lock and ignores identity in anonymous mode", async () => {
    const result = await submitFeedback({ orgSlug: "org", eventSlug: "event", email: "person@example.test", answers: { comment: "Useful" } });
    expect(result).toEqual({ ok: true, data: { certificateToken: null } });
    expect(mocks.rsvpFind).not.toHaveBeenCalled();
    expect(mocks.responseCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ rsvpId: null, certificateToken: null }) }));
  });

  it("links only a current confirmed registration and issues a 256-bit certificate capability", async () => {
    mocks.formFind.mockResolvedValue({ id: "form_1", isOpen: true, certificateEnabled: true, fields: [commentField] });
    mocks.rsvpFind.mockResolvedValue({ id: "rsvp_1" });
    const result = await submitFeedback({ orgSlug: "org", eventSlug: "event", email: "person@example.test", answers: { comment: "Useful" } });
    expect(result).toMatchObject({ ok: true, data: { certificateToken: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    expect(mocks.rsvpFind).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ eventId: "event_1", status: "CONFIRMED" }) }));
    expect(mocks.responseCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ rsvpId: "rsvp_1", certificateToken: expect.stringMatching(/^[a-f0-9]{64}$/) }) }));
  });

  it("rejects unknown fields and amplification through oversized multi-select arrays", async () => {
    await expect(submitFeedback({ orgSlug: "org", eventSlug: "event", answers: { comment: "Okay", smuggled: "value" } }))
      .resolves.toEqual({ ok: false, error: "The feedback form has changed. Reload and try again." });
    mocks.formFind.mockResolvedValue({ id: "form_1", isOpen: true, certificateEnabled: false, fields: [{ ...commentField, type: RegistrationFieldType.MULTI_SELECT, options: ["A"] }] });
    await expect(submitFeedback({ orgSlug: "org", eventSlug: "event", answers: { comment: Array.from({ length: 51 }, () => "A") } }))
      .resolves.toEqual({ ok: false, error: "Comment has too many or invalid options." });
    expect(mocks.responseCreate).not.toHaveBeenCalled();
  });
});
