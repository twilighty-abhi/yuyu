import type { RsvpStatus } from "@prisma/client";
import { getEmailTransport } from "./transporter";

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]!);
}


function getBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
}

export async function sendRSVPConfirmation(params: {
  to: string;
  eventTitle: string;
  status: RsvpStatus;
  checkInToken?: string;
}): Promise<void> {
  const { transporter, from } = await getEmailTransport();
  const baseUrl = getBaseUrl();

  const ticketUrl = params.checkInToken ? `${baseUrl}/ticket/${params.checkInToken}` : null;
  const safeTitle = escapeHtml(params.eventTitle);
  const safeTicketUrl = ticketUrl ? escapeHtml(ticketUrl) : null;

  let statusText = "Confirmed";
  let statusMessage = "Your RSVP has been confirmed. We look forward to seeing you!";
  if (params.status === "WAITLISTED") {
    statusText = "Waitlisted";
    statusMessage = "The event is currently at capacity, so you've been placed on the waitlist. We will notify you if a spot opens up!";
  } else if (params.status === "PENDING_APPROVAL") {
    statusText = "Pending Approval";
    statusMessage = "Your RSVP is pending organizer approval. We will let you know once it's reviewed.";
  }

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>RSVP ${statusText}: ${safeTitle}</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8f9fa; margin: 0; padding: 20px; color: #1c1b1f;">
        <div style="max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #e0e0e0; box-shadow: 0 4px 12px rgba(0,0,0,0.05); overflow: hidden;">
          <div style="background-color: #6750A4; padding: 24px; text-align: center; color: #ffffff;">
            <h1 style="margin: 0; font-size: 24px; font-weight: 600; letter-spacing: 0.5px;">Yuyu Events</h1>
          </div>
          <div style="padding: 32px;">
            <h2 style="margin-top: 0; color: #6750A4; font-size: 20px; font-weight: 600;">RSVP Status: ${statusText}</h2>
            <p style="font-size: 16px; line-height: 1.5; color: #49454f; margin-bottom: 24px;">
              Hello,<br><br>
              Thank you for registering for <strong>${safeTitle}</strong>. ${statusMessage}
            </p>
            ${
              ticketUrl && params.status === "CONFIRMED"
                ? `
              <div style="text-align: center; margin: 32px 0;">
                <a href="${safeTicketUrl}" style="background-color: #6750A4; color: #ffffff; padding: 14px 28px; border-radius: 100px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                  View Your Ticket & QR Code
                </a>
              </div>
              <p style="font-size: 14px; text-align: center; color: #79747e; margin-bottom: 24px;">
                Or copy and paste this link: <br>
                <a href="${safeTicketUrl}" style="color: #6750A4; text-decoration: underline;">${safeTicketUrl}</a>
              </p>
            `
                : ""
            }
          </div>
          <div style="background-color: #f3edf7; padding: 16px; text-align: center; font-size: 12px; color: #79747e; border-top: 1px solid #e0e0e0;">
            This email was sent by Yuyu Events.<br>
            © ${new Date().getFullYear()} Yuyu. All rights reserved.
          </div>
        </div>
      </body>
    </html>
  `;

  const text = `RSVP ${statusText}: ${params.eventTitle}\n\nHello,\n\nThank you for registering for "${params.eventTitle}". ${statusMessage}${ticketUrl && params.status === "CONFIRMED" ? `\n\nView your ticket here: ${ticketUrl}` : ""}\n\nBest regards,\nYuyu Events`;

  if (!transporter) {
    console.log("========================================");
    console.log(`[EMAIL MOCK] To: ${params.to}`);
    console.log(`[EMAIL MOCK] Subject: RSVP ${statusText}: ${params.eventTitle}`);
    console.log(`[EMAIL MOCK] Text:\n${text}`);
    console.log("========================================");
    return;
  }

  await transporter.sendMail({
    from,
    to: params.to,
    subject: `RSVP ${statusText}: ${params.eventTitle}`,
    text,
    html,
  });
}

export async function sendApprovalNotification(params: {
  to: string;
  eventTitle: string;
  approved: boolean;
}): Promise<void> {
  const { transporter, from } = await getEmailTransport();

  const statusText = params.approved ? "Approved" : "Declined";
  const safeTitle = escapeHtml(params.eventTitle);
  const statusMessage = params.approved
    ? `Great news! Your RSVP request for <strong>${safeTitle}</strong> has been approved by the organizer.`
    : `We regret to inform you that your RSVP request for <strong>${safeTitle}</strong> has been declined by the organizer.`;

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>RSVP Update: ${statusText}</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8f9fa; margin: 0; padding: 20px; color: #1c1b1f;">
        <div style="max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #e0e0e0; box-shadow: 0 4px 12px rgba(0,0,0,0.05); overflow: hidden;">
          <div style="background-color: #6750A4; padding: 24px; text-align: center; color: #ffffff;">
            <h1 style="margin: 0; font-size: 24px; font-weight: 600; letter-spacing: 0.5px;">Yuyu Events</h1>
          </div>
          <div style="padding: 32px;">
            <h2 style="margin-top: 0; color: #6750A4; font-size: 20px; font-weight: 600;">RSVP Update: ${statusText}</h2>
            <p style="font-size: 16px; line-height: 1.5; color: #49454f; margin-bottom: 24px;">
              Hello,<br><br>
              ${statusMessage}
            </p>
          </div>
          <div style="background-color: #f3edf7; padding: 16px; text-align: center; font-size: 12px; color: #79747e; border-top: 1px solid #e0e0e0;">
            This email was sent by Yuyu Events.<br>
            © ${new Date().getFullYear()} Yuyu. All rights reserved.
          </div>
        </div>
      </body>
    </html>
  `;

  const text = `RSVP Update: ${statusText}\n\nHello,\n\n${params.approved ? `Your RSVP for "${params.eventTitle}" was approved!` : `Your RSVP for "${params.eventTitle}" was declined.`}\n\nBest regards,\nYuyu Events`;

  if (!transporter) {
    console.log("========================================");
    console.log(`[EMAIL MOCK] To: ${params.to}`);
    console.log(`[EMAIL MOCK] Subject: RSVP Update: ${statusText} - ${params.eventTitle}`);
    console.log(`[EMAIL MOCK] Text:\n${text}`);
    console.log("========================================");
    return;
  }

  await transporter.sendMail({
    from,
    to: params.to,
    subject: `RSVP Update: ${statusText} - ${params.eventTitle}`,
    text,
    html,
  });
}

export async function sendEventInvitation(params: {
  to: string;
  eventTitle: string;
  organisationName: string;
  orgSlug: string;
  eventSlug: string;
}): Promise<void> {
  const { transporter, from } = await getEmailTransport();
  const eventUrl = `${getBaseUrl()}/${encodeURIComponent(params.orgSlug)}/${encodeURIComponent(params.eventSlug)}`;
  const safeTitle = escapeHtml(params.eventTitle);
  const safeOrganisationName = escapeHtml(params.organisationName);
  const safeEventUrl = escapeHtml(eventUrl);
  const subject = `You’re invited: ${params.eventTitle}`;
  const text = `You’re invited to "${params.eventTitle}" by ${params.organisationName}.\n\nOpen the event and register with this email address:\n${eventUrl}\n\nYuyu Events`;
  const html = `
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background:#f8f9fa; margin:0; padding:20px; color:#1c1b1f;">
      <div style="max-width:600px; margin:40px auto; background:#fff; border:1px solid #e0e0e0; border-radius:16px; overflow:hidden;">
        <div style="background:#6750A4; color:#fff; padding:24px; text-align:center;"><strong>Yuyu Events</strong></div>
        <div style="padding:32px;">
          <h2 style="margin-top:0; color:#6750A4;">You’re invited</h2>
          <p><strong>${safeOrganisationName}</strong> invited you to <strong>${safeTitle}</strong>.</p>
          <p>Open the event and register with this email address.</p>
          <p style="margin:28px 0;"><a href="${safeEventUrl}" style="background:#6750A4; color:#fff; padding:14px 24px; border-radius:999px; text-decoration:none; font-weight:600;">View event</a></p>
          <p style="font-size:13px; color:#666; overflow-wrap:anywhere;">${safeEventUrl}</p>
        </div>
      </div>
    </body></html>`;

  if (!transporter) {
    console.log(`[EMAIL MOCK] To: ${params.to}`);
    console.log(`[EMAIL MOCK] Subject: ${subject}`);
    console.log(`[EMAIL MOCK] Text:\n${text}`);
    return;
  }

  await transporter.sendMail({ from, to: params.to, subject, text, html });
}

export async function sendCollaboratorInvitation(params: { to: string; eventTitle: string; inviteUrl: string }) {
  const { transporter, from } = await getEmailTransport();
  const subject = `Co-organizer invitation: ${params.eventTitle}`;
  const safeUrl = escapeHtml(params.inviteUrl);
  const text = `You have been invited to co-organize "${params.eventTitle}". Sign in with this email address to accept:\n${params.inviteUrl}`;
  const html = `<p>You have been invited to co-organize <strong>${escapeHtml(params.eventTitle)}</strong>.</p><p><a href="${safeUrl}">Accept co-organizer invite</a></p><p>${safeUrl}</p>`;
  if (!transporter) { console.log(`[EMAIL MOCK] To: ${params.to}\n${text}`); return; }
  await transporter.sendMail({ from, to: params.to, subject, text, html });
}

export async function sendReminder(params: {
  to: string;
  eventTitle: string;
  startsAtIso: string;
}): Promise<void> {
  const { transporter, from } = await getEmailTransport();

  const formattedDate = new Date(params.startsAtIso).toLocaleString();
  const safeTitle = escapeHtml(params.eventTitle);

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Upcoming Event Reminder: ${params.eventTitle}</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8f9fa; margin: 0; padding: 20px; color: #1c1b1f;">
        <div style="max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #e0e0e0; box-shadow: 0 4px 12px rgba(0,0,0,0.05); overflow: hidden;">
          <div style="background-color: #6750A4; padding: 24px; text-align: center; color: #ffffff;">
            <h1 style="margin: 0; font-size: 24px; font-weight: 600; letter-spacing: 0.5px;">Yuyu Events</h1>
          </div>
          <div style="padding: 32px;">
            <h2 style="margin-top: 0; color: #6750A4; font-size: 20px; font-weight: 600;">Upcoming Event Reminder</h2>
            <p style="font-size: 16px; line-height: 1.5; color: #49454f; margin-bottom: 24px;">
              Hello,<br><br>
              This is a reminder that the event <strong>${safeTitle}</strong> is starting soon!<br><br>
              <strong>Start Time:</strong> ${formattedDate}
            </p>
          </div>
          <div style="background-color: #f3edf7; padding: 16px; text-align: center; font-size: 12px; color: #79747e; border-top: 1px solid #e0e0e0;">
            This email was sent by Yuyu Events.<br>
            © ${new Date().getFullYear()} Yuyu. All rights reserved.
          </div>
        </div>
      </body>
    </html>
  `;

  const text = `Upcoming Event Reminder: ${params.eventTitle}\n\nHello,\n\nThis is a reminder that "${params.eventTitle}" is starting at ${formattedDate}.\n\nBest regards,\nYuyu Events`;

  if (!transporter) {
    console.log("========================================");
    console.log(`[EMAIL MOCK] To: ${params.to}`);
    console.log(`[EMAIL MOCK] Subject: Reminder: ${params.eventTitle} is starting soon`);
    console.log(`[EMAIL MOCK] Text:\n${text}`);
    console.log("========================================");
    return;
  }

  await transporter.sendMail({
    from,
    to: params.to,
    subject: `Reminder: ${params.eventTitle} is starting soon`,
    text,
    html,
  });
}
