import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RsvpStatus } from "@prisma/client";

vi.mock("@/lib/email/transporter", () => ({
  getEmailTransport: vi.fn().mockResolvedValue({
    transporter: null,
    from: "Yuyu <noreply@example.test>",
  }),
}));

import {
  sendApprovalNotification,
  sendCollaboratorInvitation,
  sendEventInvitation,
  sendReminder,
  sendRSVPConfirmation,
} from "@/lib/email";
import { sendEmailVerificationEmail } from "@/lib/email/emailVerification";
import { sendPasswordResetEmail } from "@/lib/email/passwordReset";

let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  log.mockRestore();
});

describe("mock email log safety", () => {
  it("never logs recipients, message content, or bearer capabilities", async () => {
    const recipient = "private-attendee@example.test";
    const ticketToken = "secret-ticket-token";
    const resetToken = "secret-reset-token";
    const verificationToken = "secret-verification-token";
    const collaboratorToken = "secret-collaborator-token";

    await sendRSVPConfirmation({
      to: recipient,
      eventTitle: "Private planning session",
      status: RsvpStatus.CONFIRMED,
      checkInToken: ticketToken,
    });
    await sendApprovalNotification({ to: recipient, eventTitle: "Private planning session", approved: true });
    await sendEventInvitation({ to: recipient, eventTitle: "Private planning session", organisationName: "Private Org", orgSlug: "private-org", eventSlug: "private-event" });
    await sendCollaboratorInvitation({ to: recipient, eventTitle: "Private planning session", inviteUrl: `https://events.example.test/join/event-collaborator/${collaboratorToken}` });
    await sendReminder({ to: recipient, eventTitle: "Private planning session", startsAtIso: "2026-09-01T09:00:00.000Z" });
    await sendPasswordResetEmail({ to: recipient, resetUrl: `https://events.example.test/reset-password?token=${resetToken}` });
    await sendEmailVerificationEmail({ to: recipient, verificationUrl: `https://events.example.test/verify-email?token=${verificationToken}` });

    const output = log.mock.calls.flat().join(" ");
    expect(output).not.toContain(recipient);
    expect(output).not.toContain("Private planning session");
    expect(output).not.toContain(ticketToken);
    expect(output).not.toContain(resetToken);
    expect(output).not.toContain(verificationToken);
    expect(output).not.toContain(collaboratorToken);
  });
});
