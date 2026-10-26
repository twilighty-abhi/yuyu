import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("@/lib/email/transporter", () => ({
  getEmailTransport: vi.fn().mockResolvedValue({
    transporter: { sendMail: mocks.sendMail },
    from: "Yuyu <noreply@example.test>",
  }),
}));

import { sendCollaboratorInvitation, sendEventBroadcast, sendReminder, sendRSVPConfirmation } from "@/lib/email";
import { RsvpStatus } from "@prisma/client";

describe("email construction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("escapes HTML fields and strips control characters from subjects", async () => {
    await sendReminder({
      to: "person@example.test",
      eventTitle: 'Planning</title><script>alert(1)</script>\r\nBcc: victim@example.test',
      startsAtIso: "2030-01-01T10:00:00.000Z",
      messageId: "<stable@outbox.invalid>",
    });
    const message = mocks.sendMail.mock.calls[0]?.[0];
    expect(message.messageId).toBe("<stable@outbox.invalid>");
    expect(message.subject).not.toMatch(/[\r\n]/);
    expect(message.html).not.toContain("</title><script>");
    expect(message.html).toContain("&lt;script&gt;");
  });

  it("HTML-escapes capability URLs in links and visible content", async () => {
    await sendCollaboratorInvitation({
      to: "person@example.test",
      eventTitle: "Event",
      inviteUrl: "https://events.test/join/token?one=1&two=2",
    });
    const message = mocks.sendMail.mock.calls[0]?.[0];
    expect(message.html).toContain("one=1&amp;two=2");
    expect(message.html).not.toContain('href="https://events.test/join/token?one=1&two=2"');
  });

  it("attaches a portable calendar invite to confirmed RSVP emails", async () => {
    await sendRSVPConfirmation({
      to: "person@example.test",
      eventTitle: "Planning, review; kickoff",
      status: RsvpStatus.CONFIRMED,
      recipientName: "Asha <Admin>",
      messageId: "<stable@outbox.invalid>",
      calendarEvent: {
        startDateTime: new Date("2030-01-01T10:00:00.000Z"),
        endDateTime: new Date("2030-01-01T11:00:00.000Z"),
        timezone: "Asia/Kolkata",
        location: "Room A, HQ",
      },
    });

    const message = mocks.sendMail.mock.calls[0]?.[0];
    expect(message.icalEvent).toEqual(expect.objectContaining({
      filename: "Planning_review_kickoff.ics",
      method: "PUBLISH",
    }));
    expect(message.icalEvent.content).toContain("DTSTART:20300101T100000Z");
    expect(message.icalEvent.content).toContain("SUMMARY:Planning\\, review\\; kickoff");
    expect(message.icalEvent.content).toContain("LOCATION:Room A\\, HQ");
    expect(message.html).toContain("Event details");
    expect(message.html).toContain("Hello Asha &lt;Admin&gt;,");
    expect(message.text).toContain("Hello Asha <Admin>,");
    expect(message.html).toContain("Location:</strong> Room A, HQ");
    expect(message.html).toContain("Add to Google Calendar");
    expect(message.html).toContain("calendar.google.com/calendar/render?action=TEMPLATE");
    expect(message.text).toContain("Starts: Tue, Jan 1, 2030, 3:30 PM GMT+5:30");
    expect(message.text).toContain("Add to Google Calendar: https://calendar.google.com/calendar/render?action=TEMPLATE");
  });

  it("words a crew ticket for the organising team and keeps escaping", async () => {
    await sendRSVPConfirmation({
      to: "crew@example.test",
      eventTitle: "Launch <b>night</b>\r\nBcc: victim@example.test",
      status: RsvpStatus.CONFIRMED,
      checkInToken: "crew-ticket",
      crew: true,
    });
    const message = mocks.sendMail.mock.calls[0]?.[0];
    expect(message.subject).toBe("You're on the crew for Launch <b>night</b> Bcc: victim@example.test");
    expect(message.html).toContain("You're on the crew for <strong>Launch &lt;b&gt;night&lt;/b&gt;");
    expect(message.html).toContain("This is your crew ticket — show it at check-in.");
    expect(message.html).not.toContain("<b>night</b>");
    expect(message.html).not.toContain("Thank you for registering");
    expect(message.text).toContain("This is your crew ticket — show it at check-in.");
    expect(message.html).toContain("/ticket/crew-ticket");
  });

  it("ignores the crew flag on a ticket that is not confirmed", async () => {
    await sendRSVPConfirmation({ to: "person@example.test", eventTitle: "Event", status: RsvpStatus.WAITLISTED, crew: true });
    const message = mocks.sendMail.mock.calls[0]?.[0];
    expect(message.subject).toBe("RSVP Waitlisted: Event");
    expect(message.html).not.toContain("crew ticket");
  });
});

describe("event broadcast email", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inlines email styles, renders buttons, and escapes surrounding text", async () => {
    await sendEventBroadcast({
      to: "person@example.test",
      subject: "Doors\r\nBcc: victim@example.test",
      bodyHtml: '<p>Hello <strong>Priya</strong>,</p><p></p><p><a class="cta" href="https://events.test/ticket/abc?x=1&amp;y=2">View ticket</a></p><ul><li>Bring ID</li></ul>',
      bodyText: "Hello Priya,\n\nView ticket (https://events.test/ticket/abc?x=1&y=2)\n\n• Bring ID",
      eventTitle: "Mixer <script>",
      organisationName: "Org & Co",
      messageId: "<stable@outbox.invalid>",
    });
    const message = mocks.sendMail.mock.calls[0]?.[0];
    expect(message.subject).not.toMatch(/[\r\n]/);
    expect(message.html).toContain('<a href="https://events.test/ticket/abc?x=1&amp;y=2" style="display: inline-block; background-color: #18181B;');
    expect(message.html).toContain('<p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #1c1b1f;"><br></p>');
    expect(message.html).toContain('<li style="');
    expect(message.html).toContain("Org &amp; Co");
    expect(message.html).toContain("Mixer &lt;script&gt;");
    expect(message.html).not.toContain("<script>");
    expect(message.text).toContain("View ticket (https://events.test/ticket/abc?x=1&y=2)");
    expect(message.text).toContain('registered for "Mixer <script>" with Org & Co');
  });
});
