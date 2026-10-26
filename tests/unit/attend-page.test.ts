import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  submit: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/core/attendanceCheck", () => ({ resolveAttendanceCheckByToken: mocks.resolve }));
vi.mock("@/app/actions/attendance-check", () => ({ submitAttendanceReply: mocks.submit }));

import AttendPage, { metadata } from "@/app/attend/[token]/page";
import { AttendanceReplyForm, type AttendanceReplyFormProps } from "@/components/attendance/AttendanceReplyForm";

const TOKEN = "A".repeat(43);

function view(overrides: Record<string, unknown> = {}) {
  return {
    eventTitle: "Launch night",
    organisationName: "Acme",
    startDateTime: "2026-11-02T18:00:00.000Z",
    endDateTime: "2026-11-02T21:00:00.000Z",
    timezone: "Europe/London",
    location: "The Hall, 1 High Street",
    isOnline: false,
    accentColor: null,
    attendeeName: "Ada Lovelace",
    attendeeEmail: "ada@example.test",
    teamName: null,
    response: null,
    respondedAt: null,
    note: "",
    releaseOnDecline: false,
    closed: null,
    ...overrides,
  };
}

async function renderPage(token: string, answer?: string) {
  const element = (await AttendPage({ params: Promise.resolve({ token }), searchParams: Promise.resolve(answer ? { answer } : {}) })) as ReactElement;
  return renderToStaticMarkup(element);
}

function formProps(overrides: Partial<AttendanceReplyFormProps> = {}): AttendanceReplyFormProps {
  return {
    token: TOKEN,
    attendeeName: "Ada Lovelace",
    attendeeEmail: "ada@example.test",
    teamName: null,
    initialResponse: null,
    initialRespondedAt: null,
    initialNote: "",
    preselect: null,
    releaseOnDecline: false,
    closed: null,
    timeZone: "Europe/London",
    ...overrides,
  };
}

const renderForm = (overrides: Partial<AttendanceReplyFormProps> = {}) => renderToStaticMarkup(createElement(AttendanceReplyForm, formProps(overrides)));

beforeEach(() => {
  mocks.resolve.mockReset();
  mocks.notFound.mockClear();
});

describe("/attend/[token] page", () => {
  it("is never indexed and never leaks its address through Referer", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe("no-referrer");
  });

  it("answers a real 404 for a malformed token without looking it up", async () => {
    for (const token of ["short", "A".repeat(44), "A".repeat(42) + "!", ""]) {
      await expect(renderPage(token), token).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("answers a real 404 for an unknown, rotated or released token", async () => {
    mocks.resolve.mockResolvedValue(null);
    await expect(renderPage(TOKEN)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.resolve).toHaveBeenCalledWith(TOKEN);
  });

  it("shows the event and the attendee's own name and email, preselecting the emailed answer", async () => {
    mocks.resolve.mockResolvedValue(view());
    const html = await renderPage(TOKEN, "no");
    expect(html).toContain("Are you still coming to Launch night?");
    expect(html).toContain("The Hall, 1 High Street");
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("ada@example.test");
    // The "No" button from the email selects No but never submits it.
    expect(html).toMatch(/role="radio"[^>]*aria-checked="true"[^>]*value="NOT_ATTENDING"|value="NOT_ATTENDING"[^>]*aria-checked="true"/);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("shows 'Online' rather than the stored location for an online event", async () => {
    mocks.resolve.mockResolvedValue(view({ isOnline: true, location: "https://call.example.test/secret-room" }));
    const html = await renderPage(TOKEN);
    expect(html).toContain("Online");
    expect(html).not.toContain("secret-room");
  });
});

describe("AttendanceReplyForm", () => {
  it("shows the prefilled details read-only and nothing selected without a preselect", () => {
    const html = renderForm();
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("ada@example.test");
    // Name and email are shown, not editable (Radix adds only hidden radio inputs).
    expect(html).not.toMatch(/<input(?![^>]*type="radio")/);
    expect(html).not.toContain('aria-checked="true"');
    expect(html).toContain("Send my answer");
  });

  it("warns before a No releases the place", () => {
    const html = renderForm({ releaseOnDecline: true, preselect: "NOT_ATTENDING" });
    expect(html).toContain("Answering No releases your place");
    expect(html).toContain("Release my place");
    expect(renderForm({ releaseOnDecline: false, preselect: "NOT_ATTENDING" })).not.toContain("releases your place");
  });

  it("shows a saved answer with a way to change it, and reopens the form for a different emailed answer", () => {
    const saved = { initialResponse: "ATTENDING" as const, initialRespondedAt: "2026-10-30T10:00:00.000Z", initialNote: "Arriving at 7" };
    const answered = renderForm(saved);
    expect(answered).toContain("Yes, I&#x27;ll be there");
    expect(answered).toContain("Arriving at 7");
    expect(answered).toContain("Change my answer");
    expect(renderForm({ ...saved, preselect: "ATTENDING" })).toContain("Change my answer");
    const reopened = renderForm({ ...saved, preselect: "NOT_ATTENDING" });
    expect(reopened).toContain("Send my answer");
    expect(reopened).toContain("Keep my answer");
  });

  it("is closed, without a form, once the event starts, is cancelled, or the registration is no longer confirmed", () => {
    for (const [closed, copy] of [["started", "Answers are closed"], ["cancelled", "This event has been cancelled"], ["notConfirmed", "no longer confirmed"]] as const) {
      const html = renderForm({ closed, preselect: "ATTENDING" });
      expect(html, closed).toContain(copy);
      expect(html, closed).not.toContain("<form");
      expect(html, closed).not.toContain("Change my answer");
    }
  });
});
