import { beforeEach, describe, expect, it, vi } from "vitest";
import { RegistrationFieldType } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(), limited: vi.fn(), eventFind: vi.fn(), transaction: vi.fn(),
  formUpsert: vi.fn(), formFind: vi.fn(), fieldFind: vi.fn(), fieldUpdate: vi.fn(),
  fieldDelete: vi.fn(), fieldCount: vi.fn(), fieldAggregate: vi.fn(), fieldCreate: vi.fn(),
  query: vi.fn(), audit: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({ requireOrgRole: mocks.requireRole }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.limited }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const tx = {
  $queryRaw: mocks.query,
  eventFeedbackForm: { upsert: mocks.formUpsert, findUnique: mocks.formFind },
  eventFeedbackField: { findFirst: mocks.fieldFind, update: mocks.fieldUpdate, delete: mocks.fieldDelete, count: mocks.fieldCount, aggregate: mocks.fieldAggregate, create: mocks.fieldCreate },
};
vi.mock("@/lib/db", () => ({ prisma: {
  event: { findFirst: mocks.eventFind },
  $transaction: mocks.transaction,
} }));

import { deleteFeedbackField, saveFeedbackField, saveFeedbackSettings } from "@/app/actions/feedback-form";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ organisation: { id: "org_1", slug: "org" }, userId: "admin_1" });
  mocks.limited.mockResolvedValue(false);
  mocks.eventFind.mockResolvedValue({ id: "event_1", slug: "event" });
  mocks.formUpsert.mockResolvedValue({ id: "form_1", isOpen: true, certificateEnabled: false });
  mocks.formFind.mockResolvedValue({ id: "form_1" });
  mocks.fieldCount.mockResolvedValue(1);
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
});

describe("feedback form maintenance", () => {
  it("commits privacy settings and their audit record together", async () => {
    const result = await saveFeedbackSettings({ organisationSlug: "org", eventId: "event_1", isOpen: true, title: "Feedback", thankYouMessage: "Thanks", certificateEnabled: false });
    expect(result).toEqual({ ok: true, data: { formId: "form_1" } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ client: tx, action: "FEEDBACK_FORM_UPDATED", metadata: expect.objectContaining({ certificateEnabled: false }) }));
  });

  it("cannot publish an empty feedback form", async () => {
    mocks.formFind.mockResolvedValue({ id: "form_1" });
    mocks.fieldCount.mockResolvedValue(0);
    const result = await saveFeedbackSettings({ organisationSlug: "org", eventId: "event_1", isOpen: true, title: "Feedback", thankYouMessage: "Thanks", certificateEnabled: true });
    expect(result).toEqual({ ok: false, error: "Add at least one feedback question before opening the form." });
    expect(mocks.formUpsert).not.toHaveBeenCalled();
  });

  it("does not reinterpret an answered field", async () => {
    mocks.fieldFind.mockResolvedValue({ id: "field_1", key: "rating", label: "Rating", type: RegistrationFieldType.SELECT, required: true, options: ["Good", "Bad"], _count: { answers: 2 } });
    const result = await saveFeedbackField({ organisationSlug: "org", eventId: "event_1", fieldId: "field_1", key: "rating", label: "Rating", type: RegistrationFieldType.SELECT, required: true, options: ["Excellent", "Poor"] });
    expect(result).toEqual({ ok: false, error: "Answered feedback fields cannot change key, type, or options." });
    expect(mocks.fieldUpdate).not.toHaveBeenCalled();
  });

  it("does not delete fields that still have historical answers", async () => {
    mocks.fieldFind.mockResolvedValue({ id: "field_1", _count: { answers: 1 } });
    const result = await deleteFeedbackField({ organisationSlug: "org", eventId: "event_1", fieldId: "field_1" });
    expect(result).toEqual({ ok: false, error: "Answered feedback fields cannot be deleted." });
    expect(mocks.fieldDelete).not.toHaveBeenCalled();
  });
});
