import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

const suffix = randomUUID().replace(/-/g, "");
let organisationId: string;

describe.sequential("production database invariants", () => {
  beforeAll(async () => {
    const organisation = await prisma.organisation.create({
      data: { name: "Schema invariant org", slug: `schema-invariants-${suffix}` },
    });
    organisationId = organisation.id;
  });

  afterAll(async () => {
    if (organisationId) await prisma.organisation.deleteMany({ where: { id: organisationId } });
    await prisma.$disconnect();
  });

  it("rejects invalid event time ranges and capacities at the database layer", async () => {
    await expect(prisma.event.create({
      data: {
        organisationId,
        title: "Invalid time range",
        slug: `invalid-time-${suffix}`,
        startDateTime: new Date("2030-01-01T11:00:00.000Z"),
        endDateTime: new Date("2030-01-01T10:00:00.000Z"),
        timezone: "UTC",
      },
    })).rejects.toThrow();

    await expect(prisma.event.create({
      data: {
        organisationId,
        title: "Invalid capacity",
        slug: `invalid-capacity-${suffix}`,
        startDateTime: new Date("2030-01-01T10:00:00.000Z"),
        endDateTime: new Date("2030-01-01T11:00:00.000Z"),
        timezone: "UTC",
        capacity: 0,
      },
    })).rejects.toThrow();
  });

  it("rejects collaborator records without exactly one target", async () => {
    const user = await prisma.user.create({ data: { email: `schema-user-${suffix}@example.test` } });
    try {
      await expect(prisma.eventCollaborator.create({
        data: { userId: user.id, permissions: ["EDIT_DETAILS"] },
      })).rejects.toThrow();
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it("rejects partial feedback identity linkage and mismatched typed answers", async () => {
    const event = await prisma.event.create({ data: {
      organisationId,
      title: "Feedback constraints",
      slug: `feedback-constraints-${suffix}`,
      startDateTime: new Date("2030-01-01T10:00:00.000Z"),
      endDateTime: new Date("2030-01-01T11:00:00.000Z"),
      timezone: "UTC",
    } });
    const form = await prisma.eventFeedbackForm.create({ data: { eventId: event.id } });
    const field = await prisma.eventFeedbackField.create({ data: { formId: form.id, key: "rating", label: "Rating", type: "NUMBER" } });
    const rsvp = await prisma.rSVP.create({ data: { eventId: event.id, attendeeKey: `feedback-constraint:${suffix}`, guestEmail: `feedback-constraint-${suffix}@example.test` } });
    await expect(prisma.eventFeedbackResponse.create({ data: { formId: form.id, rsvpId: rsvp.id, certificateToken: null } })).rejects.toThrow();

    const response = await prisma.eventFeedbackResponse.create({ data: { formId: form.id, rsvpId: rsvp.id, certificateToken: randomUUID().replaceAll("-", "") } });
    await expect(prisma.eventFeedbackAnswer.create({ data: {
      responseId: response.id,
      fieldId: field.id,
      fieldKey: field.key,
      fieldLabel: field.label,
      fieldType: "NUMBER",
      valueText: "not a numeric column",
    } })).rejects.toThrow();
  });

  it("rejects impossible outbox states and negative attempts", async () => {
    await expect(prisma.outboxMessage.create({ data: {
      kind: "event-invite",
      payload: {},
      status: "SENT",
      sentAt: null,
    } })).rejects.toThrow();
    await expect(prisma.outboxMessage.create({ data: {
      kind: "event-invite",
      payload: {},
      attempts: -1,
    } })).rejects.toThrow();
  });
});
