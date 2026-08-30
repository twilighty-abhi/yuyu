import { randomUUID } from "node:crypto";
import { EventPrivacyType, EventStatus, RsvpStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { submitFeedback } from "@/lib/feedback";

const suffix = randomUUID().replace(/-/g, "");
let organisationId: string;
let orgSlug: string;
let eventSlug: string;
let anonymousEventSlug: string;
let anonymousFieldId: string;

describe.sequential("event feedback integration", () => {
  beforeAll(async () => {
    orgSlug = `feedback-test-${suffix}`;
    eventSlug = `event-${suffix}`;
    anonymousEventSlug = `anonymous-${suffix}`;
    const organisation = await prisma.organisation.create({ data: { name: "Feedback test", slug: orgSlug } });
    organisationId = organisation.id;
    const event = await prisma.event.create({ data: { organisationId, title: "Feedback event", slug: eventSlug, startDateTime: new Date("2030-01-01T10:00:00Z"), endDateTime: new Date("2030-01-01T11:00:00Z"), timezone: "UTC", status: EventStatus.PUBLISHED, privacyType: EventPrivacyType.PUBLIC } });
    const form = await prisma.eventFeedbackForm.create({ data: { eventId: event.id, isOpen: true, certificateEnabled: true } });
    await prisma.eventFeedbackField.create({ data: { formId: form.id, key: "comment", label: "Your feedback", type: "TEXTAREA", required: true, sortOrder: 1 } });
    await prisma.rSVP.create({ data: { eventId: event.id, attendeeKey: `feedback:${suffix}`, guestEmail: `attendee-${suffix}@example.test`, guestName: "Feedback attendee", status: RsvpStatus.CONFIRMED } });
    await prisma.rSVP.create({ data: { eventId: event.id, attendeeKey: `feedback-wait:${suffix}`, guestEmail: `wait-${suffix}@example.test`, guestName: "Waitlisted attendee", status: RsvpStatus.WAITLISTED } });
    const anonymousEvent = await prisma.event.create({ data: { organisationId, title: "Anonymous feedback", slug: anonymousEventSlug, startDateTime: new Date("2030-01-02T10:00:00Z"), endDateTime: new Date("2030-01-02T11:00:00Z"), timezone: "UTC", status: EventStatus.PUBLISHED, privacyType: EventPrivacyType.PUBLIC } });
    const anonymousForm = await prisma.eventFeedbackForm.create({ data: { eventId: anonymousEvent.id, isOpen: true, certificateEnabled: false } });
    const anonymousField = await prisma.eventFeedbackField.create({ data: { formId: anonymousForm.id, key: "comment", label: "Comment", type: "TEXTAREA", required: true } });
    anonymousFieldId = anonymousField.id;
  });
  afterAll(async () => { if (organisationId) await prisma.organisation.delete({ where: { id: organisationId } }); await prisma.$disconnect(); });
  it("accepts one completed feedback response and creates a certificate token", async () => {
    const result = await submitFeedback({ orgSlug, eventSlug, email: `ATTENDEE-${suffix}@example.test`, answers: { comment: "Great event" } });
    expect(result).toMatchObject({ ok: true, data: { certificateToken: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    await expect(prisma.eventFeedbackResponse.count()).resolves.toBeGreaterThan(0);
  });
  it("allows repeat certificate feedback but excludes waitlisted registrations", async () => {
    await expect(submitFeedback({ orgSlug, eventSlug, email: `attendee-${suffix}@example.test`, answers: { comment: "Again" } })).resolves.toMatchObject({ ok: true, data: { certificateToken: expect.any(String) } });
    await expect(submitFeedback({ orgSlug, eventSlug, email: `wait-${suffix}@example.test`, answers: { comment: "Please" } })).resolves.toMatchObject({ ok: false, error: "Certificate verification failed." });
  });
  it("accepts repeat anonymous feedback without collecting an RSVP identity", async () => {
    await expect(submitFeedback({ orgSlug, eventSlug: anonymousEventSlug, email: `attendee-${suffix}@example.test`, answers: { comment: "First" } })).resolves.toEqual({ ok: true, data: { certificateToken: null } });
    await expect(submitFeedback({ orgSlug, eventSlug: anonymousEventSlug, answers: { comment: "Second" } })).resolves.toEqual({ ok: true, data: { certificateToken: null } });
    const responses = await prisma.eventFeedbackResponse.findMany({ where: { form: { event: { slug: anonymousEventSlug } } } });
    expect(responses).toHaveLength(2);
    expect(responses.every((response) => response.rsvpId === null && response.certificateToken === null)).toBe(true);
  });
  it("retains immutable answer semantics if a live form field is later removed", async () => {
    const answerBefore = await prisma.eventFeedbackAnswer.findFirstOrThrow({ where: { fieldId: anonymousFieldId } });
    expect(answerBefore).toMatchObject({ fieldKey: "comment", fieldLabel: "Comment", fieldType: "TEXTAREA" });
    await prisma.eventFeedbackField.delete({ where: { id: anonymousFieldId } });
    const answerAfter = await prisma.eventFeedbackAnswer.findUniqueOrThrow({ where: { id: answerBefore.id } });
    expect(answerAfter).toMatchObject({ fieldId: null, fieldKey: "comment", fieldLabel: "Comment", fieldType: "TEXTAREA", valueText: "First" });
  });
});
