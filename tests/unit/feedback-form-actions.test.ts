import { beforeEach, describe, expect, it, vi } from "vitest";
import { RegistrationFieldType } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(), limited: vi.fn(), eventFind: vi.fn(), transaction: vi.fn(),
  formUpsert: vi.fn(), formFind: vi.fn(), fieldFind: vi.fn(), fieldUpdate: vi.fn(),
  fieldDelete: vi.fn(), fieldCount: vi.fn(), fieldAggregate: vi.fn(), fieldCreate: vi.fn(),
  fieldDeleteMany: vi.fn(), responseCount: vi.fn(), query: vi.fn(), audit: vi.fn(), assetCount: vi.fn(),
  auth: vi.fn(), membership: vi.fn(), orgFind: vi.fn(), listResponses: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({ requireOrgRole: mocks.requireRole, getMembership: mocks.membership, isOrgAdmin: (role: string) => role === "OWNER" || role === "ADMIN" }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/eventDashboard/feedbackResponses", () => ({ listFeedbackResponsesPage: mocks.listResponses }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.limited }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const tx = {
  $queryRaw: mocks.query,
  eventFeedbackForm: { upsert: mocks.formUpsert, findUnique: mocks.formFind },
  eventFeedbackField: { findFirst: mocks.fieldFind, update: mocks.fieldUpdate, delete: mocks.fieldDelete, deleteMany: mocks.fieldDeleteMany, count: mocks.fieldCount, aggregate: mocks.fieldAggregate, create: mocks.fieldCreate },
  eventFeedbackResponse: { count: mocks.responseCount },
};
vi.mock("@/lib/db", () => ({ prisma: {
  event: { findFirst: mocks.eventFind },
  organisation: { findUnique: mocks.orgFind },
  asset: { count: mocks.assetCount },
  $transaction: mocks.transaction,
} }));

import { applyFeedbackTemplate, deleteFeedbackField, loadFeedbackResponsesPage, saveFeedbackField, saveFeedbackSettings } from "@/app/actions/feedback-form";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ organisation: { id: "org_1", slug: "org" }, userId: "admin_1" });
  mocks.limited.mockResolvedValue(false);
  mocks.eventFind.mockResolvedValue({ id: "event_1", slug: "event" });
  mocks.formUpsert.mockResolvedValue({ id: "form_1", isOpen: true, certificateEnabled: false });
  mocks.formFind.mockResolvedValue({ id: "form_1" });
  mocks.fieldCount.mockResolvedValue(1);
  mocks.responseCount.mockResolvedValue(0);
  mocks.fieldCreate.mockImplementation(async ({ data }: { data: { key: string; label: string; type: RegistrationFieldType; required: boolean; options: string[] } }) => ({ id: `field_${data.key}`, ...data }));
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
});

describe("feedback form maintenance", () => {
  it("rejects certificate artwork from another organisation before saving", async () => {
    const result = await saveFeedbackSettings({ organisationSlug: "org", eventId: "event_1", isOpen: true, title: "Feedback", thankYouMessage: "Thanks", certificateEnabled: true, certificateTemplate: {
      backgroundKey: "organisations/other/certificate-backgrounds/12345678-1234-4123-8123-123456789abc.webp",
      x: 10, y: 40, width: 80, height: 15, font: "serif", fontSize: 48, color: "#000000", bold: false, align: "center",
    } });
    expect(result.ok).toBe(false);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("rejects a certificate image layer that the organisation did not upload", async () => {
    mocks.assetCount.mockResolvedValue(1);
    const result = await saveFeedbackSettings({ organisationSlug: "org", eventId: "event_1", isOpen: true, title: "Feedback", thankYouMessage: "Thanks", certificateEnabled: true, certificateTemplate: {
      version: 2,
      backgroundKey: "organisations/org_1/certificate-backgrounds/12345678-1234-4123-8123-123456789abc.webp",
      elements: [{ id: "logo", type: "image", key: "organisations/org_1/certificate-assets/12345678-1234-4123-8123-123456789abd.webp", label: "Logo", x: 0, y: 0, width: 10, height: 10 }],
    } });
    expect(result.ok).toBe(false);
    expect(mocks.assetCount).toHaveBeenCalledWith({ where: expect.objectContaining({ organisationId: "org_1", contentType: "image/webp" }) });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("saves a legacy name area in the layered format", async () => {
    mocks.assetCount.mockResolvedValue(1);
    const result = await saveFeedbackSettings({ organisationSlug: "org", eventId: "event_1", isOpen: true, title: "Feedback", thankYouMessage: "Thanks", certificateEnabled: true, certificateTemplate: {
      backgroundKey: "organisations/org_1/certificate-backgrounds/12345678-1234-4123-8123-123456789abc.webp",
      x: 10, y: 40, width: 80, height: 15, font: "serif", fontSize: 48, color: "#000000", bold: false, align: "center",
    } });
    expect(result.ok).toBe(true);
    expect(mocks.formUpsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ certificateTemplate: expect.objectContaining({ version: 2, elements: [expect.objectContaining({ text: "{{name}}" })] }) }) }));
  });

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

  it("applies a starter template atomically only before feedback is submitted", async () => {
    const result = await applyFeedbackTemplate({ organisationSlug: "org", eventId: "event_1", templateId: "QUICK_PULSE" });
    expect(result).toMatchObject({ ok: true, data: { fields: [{ key: "overall_experience" }, { key: "comments" }] } });
    expect(mocks.fieldDeleteMany).toHaveBeenCalledWith({ where: { formId: "form_1" } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "FEEDBACK_TEMPLATE_APPLIED", metadata: expect.objectContaining({ templateId: "QUICK_PULSE", fieldCount: 2 }) }));
  });

  it("does not replace a form that already has feedback responses", async () => {
    mocks.responseCount.mockResolvedValue(1);
    const result = await applyFeedbackTemplate({ organisationSlug: "org", eventId: "event_1", templateId: "QUICK_PULSE" });
    expect(result).toEqual({ ok: false, error: "A template cannot replace a feedback form that already has responses." });
    expect(mocks.formUpsert).not.toHaveBeenCalled();
    expect(mocks.fieldDeleteMany).not.toHaveBeenCalled();
  });
});

describe("loadFeedbackResponsesPage", () => {
  const input = { organisationSlug: "org", eventId: "event_1", page: 2 };
  beforeEach(() => {
    mocks.auth.mockResolvedValue({ user: { id: "admin_1" } });
    mocks.orgFind.mockResolvedValue({ id: "org_1" });
    mocks.membership.mockResolvedValue({ role: "ADMIN" });
    mocks.listResponses.mockResolvedValue({ responses: [], page: 2, pageCount: 2, total: 30, pageSize: 25 });
  });

  it("reads one page for an organisation admin, scoped to the event in that organisation", async () => {
    expect(await loadFeedbackResponsesPage(input)).toMatchObject({ ok: true, data: { page: 2 } });
    expect(mocks.eventFind).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "event_1", organisationId: "org_1" } }));
    expect(mocks.listResponses).toHaveBeenCalledWith({ eventId: "event_1", organisationId: "org_1" }, { page: 2 });
    expect(mocks.limited).toHaveBeenCalledWith("search", "admin_1");
  });

  it("refuses members, signed-out callers, other organisations' events and bad input", async () => {
    mocks.membership.mockResolvedValue({ role: "MEMBER" });
    expect((await loadFeedbackResponsesPage(input)).ok).toBe(false);
    mocks.membership.mockResolvedValue({ role: "ADMIN" });
    mocks.eventFind.mockResolvedValue(null);
    expect(await loadFeedbackResponsesPage(input)).toEqual({ ok: false, error: "Event not found." });
    mocks.auth.mockResolvedValue(null);
    expect((await loadFeedbackResponsesPage(input)).ok).toBe(false);
    expect((await loadFeedbackResponsesPage({ ...input, page: 0 })).ok).toBe(false);
    expect((await loadFeedbackResponsesPage({ ...input, extra: true })).ok).toBe(false);
    expect(mocks.listResponses).not.toHaveBeenCalled();
  });
});
