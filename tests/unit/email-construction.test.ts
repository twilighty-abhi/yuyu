import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("@/lib/email/transporter", () => ({
  getEmailTransport: vi.fn().mockResolvedValue({
    transporter: { sendMail: mocks.sendMail },
    from: "Yuyu <noreply@example.test>",
  }),
}));

import { sendCollaboratorInvitation, sendReminder } from "@/lib/email";

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
});
