import type { RsvpStatus } from "@prisma/client";
import { getEmailTransport } from "./transporter";
import { calendarInviteFilename, createCalendarInvite, googleCalendarEventUrl } from "@/lib/calendarInvite";
import { safeTimeZone } from "@/lib/timeZone";
import { emailBrandHeader } from "./brand";
import { DEFAULT_BROADCAST_DESIGN, inlineBroadcastStyles, isBroadcastDesign, renderBroadcastDesign, type BroadcastBrand, type BroadcastDesignId } from "./broadcastDesigns";

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]!);
}

function headerText(value: string) {
  return value.replace(/[\u0000-\u001F\u007F]+/g, " ").trim().slice(0, 240);
}

function greeting(name?: string) {
  const safeName = name?.replace(/[\u0000-\u001F\u007F]+/g, " ").trim().slice(0, 200);
  return safeName ? { html: `Hello ${escapeHtml(safeName)},`, text: `Hello ${safeName},` } : { html: "Hello,", text: "Hello," };
}

function getBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
}

function formatEventDateTime(value: Date, timezone: string) {
  return value.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: safeTimeZone(timezone),
    timeZoneName: "short",
  });
}

export async function sendRSVPConfirmation(params: {
  to: string;
  eventTitle: string;
  status: RsvpStatus;
  checkInToken?: string;
  calendarEvent?: {
    startDateTime: Date;
    endDateTime: Date;
    timezone: string;
    location?: string | null;
  };
  messageId?: string;
  recipientName?: string;
  /** Names the team for a registration on a TEAM event. */
  teamName?: string;
  /** A confirmed crew ticket (docs/CREW.md) is worded for the organising team. */
  crew?: boolean;
}): Promise<void> {
  const { transporter, from } = await getEmailTransport();
  const baseUrl = getBaseUrl();
  const crew = params.crew === true && params.status === "CONFIRMED";

  const ticketUrl = params.checkInToken ? `${baseUrl}/ticket/${params.checkInToken}` : null;
  const safeTitle = escapeHtml(params.eventTitle);
  const subjectTitle = headerText(params.eventTitle);
  const safeTicketUrl = ticketUrl ? escapeHtml(ticketUrl) : null;
  const calendarUrl = params.status === "CONFIRMED" && params.calendarEvent
    ? googleCalendarEventUrl({ ...params.calendarEvent, title: params.eventTitle })
    : null;
  const safeCalendarUrl = calendarUrl ? escapeHtml(calendarUrl) : null;
  const salutation = greeting(params.recipientName);
  const eventDetails = params.status === "CONFIRMED" && params.calendarEvent
    ? {
      startsAt: formatEventDateTime(params.calendarEvent.startDateTime, params.calendarEvent.timezone),
      endsAt: formatEventDateTime(params.calendarEvent.endDateTime, params.calendarEvent.timezone),
      location: params.calendarEvent.location?.trim() || null,
    }
    : null;

  let statusText = "Confirmed";
  let statusMessage = "Your RSVP has been confirmed. We look forward to seeing you!";
  if (params.status === "WAITLISTED") {
    statusText = "Waitlisted";
    statusMessage = "The event is currently at capacity, so you've been placed on the waitlist. We will notify you if a spot opens up!";
  } else if (params.status === "PENDING_APPROVAL") {
    statusText = "Pending Approval";
    statusMessage = "Your RSVP is pending organizer approval. We will let you know once it's reviewed.";
  }
  const heading = crew ? "You're on the crew" : `RSVP Status: ${statusText}`;
  const subject = crew ? `You're on the crew for ${subjectTitle}` : `RSVP ${statusText}: ${subjectTitle}`;
  const introHtml = crew
    ? `You're on the crew for <strong>${safeTitle}</strong>. This is your crew ticket — show it at check-in.`
    : `Thank you for registering for <strong>${safeTitle}</strong>${params.teamName ? ` with team <strong>${escapeHtml(params.teamName)}</strong>` : ""}. ${statusMessage}`;
  const introText = crew
    ? `You're on the crew for "${params.eventTitle}". This is your crew ticket — show it at check-in.`
    : `Thank you for registering for "${params.eventTitle}"${params.teamName ? ` with team "${params.teamName}"` : ""}. ${statusMessage}`;

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${crew ? `Crew ticket: ${safeTitle}` : `RSVP ${statusText}: ${safeTitle}`}</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8f9fa; margin: 0; padding: 20px; color: #1c1b1f;">
        <div style="max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #e0e0e0; box-shadow: 0 4px 12px rgba(0,0,0,0.05); overflow: hidden;">
          ${emailBrandHeader()}
          <div style="padding: 32px;">
            <h2 style="margin-top: 0; color: #18181B; font-size: 20px; font-weight: 600;">${heading}</h2>
            <p style="font-size: 16px; line-height: 1.5; color: #49454f; margin-bottom: 24px;">
              ${salutation.html}<br><br>
              ${introHtml}
            </p>
            ${eventDetails ? `
              <div style="margin: 24px 0; padding: 20px; border: 1px solid #e0e0e0; border-radius: 12px; background-color: #f8f9fa;">
                <h3 style="margin: 0 0 12px; color: #18181B; font-size: 16px;">Event details</h3>
                <p style="margin: 8px 0; font-size: 14px; line-height: 1.5;"><strong>Starts:</strong> ${escapeHtml(eventDetails.startsAt)}</p>
                <p style="margin: 8px 0; font-size: 14px; line-height: 1.5;"><strong>Ends:</strong> ${escapeHtml(eventDetails.endsAt)}</p>
                ${eventDetails.location ? `<p style="margin: 8px 0; font-size: 14px; line-height: 1.5;"><strong>Location:</strong> ${escapeHtml(eventDetails.location)}</p>` : ""}
              </div>
            ` : ""}
            ${safeCalendarUrl ? `
              <div style="text-align: center; margin: 24px 0;">
                <a href="${safeCalendarUrl}" style="background-color: #18181B; color: #ffffff; padding: 14px 28px; border-radius: 100px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                  Add to Google Calendar
                </a>
                <p style="font-size: 12px; color: #79747e; margin: 12px 0 0;">An .ics calendar invite is also attached for other calendar apps.</p>
              </div>
            ` : ""}
            ${
              ticketUrl && params.status === "CONFIRMED"
                ? `
              <div style="text-align: center; margin: 32px 0;">
                <a href="${safeTicketUrl}" style="background-color: #18181B; color: #ffffff; padding: 14px 28px; border-radius: 100px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                  View Your Ticket & QR Code
                </a>
              </div>
              <p style="font-size: 14px; text-align: center; color: #79747e; margin-bottom: 24px;">
                Or copy and paste this link: <br>
                <a href="${safeTicketUrl}" style="color: #18181B; text-decoration: underline;">${safeTicketUrl}</a>
              </p>
            `
                : ""
            }
          </div>
          <div style="background-color: #f4f4f2; padding: 16px; text-align: center; font-size: 12px; color: #79747e; border-top: 1px solid #e0e0e0;">
            This email was sent by Yuyu Events.<br>
            © ${new Date().getFullYear()} Yuyu. All rights reserved.
          </div>
        </div>
      </body>
    </html>
  `;

  const text = `${crew ? `Crew ticket: ${params.eventTitle}` : `RSVP ${statusText}: ${params.eventTitle}`}\n\n${salutation.text}\n\n${introText}${eventDetails ? `\n\nEvent details\nStarts: ${eventDetails.startsAt}\nEnds: ${eventDetails.endsAt}${eventDetails.location ? `\nLocation: ${eventDetails.location}` : ""}` : ""}${calendarUrl ? `\n\nAdd to Google Calendar: ${calendarUrl}\nAn .ics calendar invite is also attached for other calendar apps.` : ""}${ticketUrl && params.status === "CONFIRMED" ? `\n\nView your ticket here: ${ticketUrl}` : ""}\n\nBest regards,\nYuyu Events`;

  if (!transporter) {
    // Email bodies can contain attendee PII and bearer ticket links. Mock
    // delivery must remain safe for shared developer and CI logs.
    console.log("[EMAIL MOCK] RSVP confirmation queued");
    return;
  }

  await transporter.sendMail({
    messageId: params.messageId,
    from,
    to: params.to,
    subject,
    text,
    html,
    // `icalEvent` emits both a text/calendar MIME alternative (which mail
    // clients recognise as an add-to-calendar action) and an .ics fallback.
    icalEvent: params.status === "CONFIRMED" && params.calendarEvent
      ? {
        filename: calendarInviteFilename(params.eventTitle),
        content: createCalendarInvite({
          ...params.calendarEvent,
          title: params.eventTitle,
          uid: params.messageId?.replace(/[<>]/g, "") ?? `yuyu-${Date.now()}@calendar.yuyu.invalid`,
        }),
        method: "PUBLISH",
      }
      : undefined,
  });
}

export async function sendApprovalNotification(params: {
  to: string;
  eventTitle: string;
  approved: boolean;
  messageId?: string;
  recipientName?: string;
  /** Team status changes name the team the decision applied to. */
  teamName?: string;
}): Promise<void> {
  const { transporter, from } = await getEmailTransport();

  const statusText = params.approved ? "Approved" : "Declined";
  const safeTitle = escapeHtml(params.eventTitle);
  const subjectTitle = headerText(params.eventTitle);
  const salutation = greeting(params.recipientName);
  const safeTeam = params.teamName ? ` (team <strong>${escapeHtml(params.teamName)}</strong>)` : "";
  const textTeam = params.teamName ? ` (team "${params.teamName}")` : "";
  const statusMessage = params.approved
    ? `Great news! Your RSVP request for <strong>${safeTitle}</strong>${safeTeam} has been approved by the organizer.`
    : `We regret to inform you that your RSVP request for <strong>${safeTitle}</strong>${safeTeam} has been declined by the organizer.`;

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>RSVP Update: ${statusText}</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8f9fa; margin: 0; padding: 20px; color: #1c1b1f;">
        <div style="max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #e0e0e0; box-shadow: 0 4px 12px rgba(0,0,0,0.05); overflow: hidden;">
          ${emailBrandHeader()}
          <div style="padding: 32px;">
            <h2 style="margin-top: 0; color: #18181B; font-size: 20px; font-weight: 600;">RSVP Update: ${statusText}</h2>
            <p style="font-size: 16px; line-height: 1.5; color: #49454f; margin-bottom: 24px;">
              ${salutation.html}<br><br>
              ${statusMessage}
            </p>
          </div>
          <div style="background-color: #f4f4f2; padding: 16px; text-align: center; font-size: 12px; color: #79747e; border-top: 1px solid #e0e0e0;">
            This email was sent by Yuyu Events.<br>
            © ${new Date().getFullYear()} Yuyu. All rights reserved.
          </div>
        </div>
      </body>
    </html>
  `;

  const text = `RSVP Update: ${statusText}\n\n${salutation.text}\n\n${params.approved ? `Your RSVP for "${params.eventTitle}"${textTeam} was approved!` : `Your RSVP for "${params.eventTitle}"${textTeam} was declined.`}\n\nBest regards,\nYuyu Events`;

  if (!transporter) {
    console.log("[EMAIL MOCK] RSVP update queued");
    return;
  }

  await transporter.sendMail({
    messageId: params.messageId,
    from,
    to: params.to,
    subject: `RSVP Update: ${statusText} - ${subjectTitle}`,
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
  messageId?: string;
}): Promise<void> {
  const { transporter, from } = await getEmailTransport();
  const eventUrl = `${getBaseUrl()}/${encodeURIComponent(params.orgSlug)}/${encodeURIComponent(params.eventSlug)}`;
  const safeTitle = escapeHtml(params.eventTitle);
  const safeOrganisationName = escapeHtml(params.organisationName);
  const safeEventUrl = escapeHtml(eventUrl);
  const subject = `You’re invited: ${headerText(params.eventTitle)}`;
  const text = `You’re invited to "${params.eventTitle}" by ${params.organisationName}.\n\nOpen the event and register with this email address:\n${eventUrl}\n\nYuyu Events`;
  const html = `
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background:#f8f9fa; margin:0; padding:20px; color:#1c1b1f;">
      <div style="max-width:600px; margin:40px auto; background:#fff; border:1px solid #e0e0e0; border-radius:16px; overflow:hidden;">
        ${emailBrandHeader()}
        <div style="padding:32px;">
          <h2 style="margin-top:0; color:#18181B;">You’re invited</h2>
          <p><strong>${safeOrganisationName}</strong> invited you to <strong>${safeTitle}</strong>.</p>
          <p>Open the event and register with this email address.</p>
          <p style="margin:28px 0;"><a href="${safeEventUrl}" style="background:#18181B; color:#fff; padding:14px 24px; border-radius:999px; text-decoration:none; font-weight:600;">View event</a></p>
          <p style="font-size:13px; color:#666; overflow-wrap:anywhere;">${safeEventUrl}</p>
        </div>
      </div>
    </body></html>`;

  if (!transporter) {
    console.log("[EMAIL MOCK] event invitation queued");
    return;
  }

  await transporter.sendMail({ messageId: params.messageId, from, to: params.to, subject, text, html });
}

function teamEmailShell(title: string, bodyHtml: string) {
  return `
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background:#f8f9fa; margin:0; padding:20px; color:#1c1b1f;">
      <div style="max-width:600px; margin:40px auto; background:#fff; border:1px solid #e0e0e0; border-radius:16px; overflow:hidden;">
        ${emailBrandHeader()}
        <div style="padding:32px; font-size:16px; line-height:1.5; color:#49454f;">${bodyHtml}</div>
        <div style="background-color:#f4f4f2; padding:16px; text-align:center; font-size:12px; color:#79747e; border-top:1px solid #e0e0e0;">
          This email was sent by Yuyu Events.<br>
          © ${new Date().getFullYear()} Yuyu. All rights reserved.
        </div>
      </div>
    </body></html>`;
}

function teamButton(url: string, label: string) {
  const safeUrl = escapeHtml(url);
  return `<p style="margin:28px 0;"><a href="${safeUrl}" style="background:#18181B; color:#fff; padding:14px 24px; border-radius:999px; text-decoration:none; font-weight:600;">${escapeHtml(label)}</a></p>
          <p style="font-size:13px; color:#666; overflow-wrap:anywhere;">${safeUrl}</p>`;
}

/**
 * Team page link for a team leader. The management link is a bearer
 * capability shown only here; the join link is safe to share with teammates.
 * Paths are site-relative and made absolute with NEXT_PUBLIC_BASE_URL.
 */
export async function sendTeamCreatedEmail(params: {
  to: string;
  eventTitle: string;
  teamName: string;
  managePath: string;
  joinPath: string;
  reason: "created" | "leader" | "reset";
  recipientName?: string;
  messageId?: string;
}): Promise<void> {
  const { transporter, from } = await getEmailTransport();
  const baseUrl = getBaseUrl();
  const manageUrl = `${baseUrl}${params.managePath}`;
  const joinUrl = `${baseUrl}${params.joinPath}`;
  const salutation = greeting(params.recipientName);
  const safeTeam = escapeHtml(params.teamName);
  const safeTitle = escapeHtml(params.eventTitle);
  const subject = params.reason === "leader"
    ? `You now lead ${headerText(params.teamName)} · ${headerText(params.eventTitle)}`
    : params.reason === "reset"
      ? `New team page link for ${headerText(params.teamName)} · ${headerText(params.eventTitle)}`
      : `Your team ${headerText(params.teamName)} · ${headerText(params.eventTitle)}`;
  const intro = params.reason === "leader"
    ? `You are now the leader of team <strong>${safeTeam}</strong> for <strong>${safeTitle}</strong>.`
    : params.reason === "reset"
      ? `The link to the team page of <strong>${safeTeam}</strong> for <strong>${safeTitle}</strong> was reset. Earlier team page links no longer work.`
      : `Your team <strong>${safeTeam}</strong> is registered for <strong>${safeTitle}</strong>.`;
  const introText = params.reason === "leader"
    ? `You are now the leader of team "${params.teamName}" for "${params.eventTitle}".`
    : params.reason === "reset"
      ? `The link to the team page of "${params.teamName}" for "${params.eventTitle}" was reset. Earlier team page links no longer work.`
      : `Your team "${params.teamName}" is registered for "${params.eventTitle}".`;
  const html = teamEmailShell(subject, `
          <h2 style="margin-top:0; color:#18181B; font-size:20px;">Your team page</h2>
          <p>${salutation.html}<br><br>${intro}</p>
          <p>Use your private team page to add or remove members, rename the team, and share the join link. Keep this link to yourself: anyone with it can manage the team.</p>
          ${teamButton(manageUrl, "Manage your team")}
          <h3 style="margin:24px 0 8px; color:#18181B; font-size:16px;">Invite teammates</h3>
          <p>Share this join link with your teammates so they can register into your team:</p>
          <p style="font-size:13px; color:#666; overflow-wrap:anywhere;"><a href="${escapeHtml(joinUrl)}" style="color:#18181B;">${escapeHtml(joinUrl)}</a></p>`);
  const text = `${subject}\n\n${salutation.text}\n\n${introText}\n\nManage your team (keep this link private):\n${manageUrl}\n\nShare this join link with your teammates:\n${joinUrl}\n\nBest regards,\nYuyu Events`;

  if (!transporter) {
    // The management link is a bearer capability; never log it.
    console.log("[EMAIL MOCK] team page link queued");
    return;
  }
  await transporter.sendMail({ messageId: params.messageId, from, to: params.to, subject, text, html });
}

/** A member the team leader added receives their own ticket link. */
export async function sendTeamMemberAddedEmail(params: {
  to: string;
  eventTitle: string;
  teamName: string;
  status: RsvpStatus;
  checkInToken: string;
  addedByName?: string;
  recipientName?: string;
  messageId?: string;
}): Promise<void> {
  const { transporter, from } = await getEmailTransport();
  const ticketUrl = `${getBaseUrl()}/ticket/${params.checkInToken}`;
  const salutation = greeting(params.recipientName);
  const addedBy = params.addedByName?.replace(/[\u0000-\u001F\u007F]+/g, " ").trim().slice(0, 200) || "";
  const subject = `You're on team ${headerText(params.teamName)} · ${headerText(params.eventTitle)}`;
  const statusLine = params.status === "CONFIRMED"
    ? "Your place is confirmed."
    : params.status === "WAITLISTED"
      ? "The team is on the waitlist for now. We will email you if it gets a place."
      : params.status === "PENDING_APPROVAL"
        ? "The team is waiting for organiser approval. We will email you once it's reviewed."
        : "";
  const who = addedBy ? `${escapeHtml(addedBy)} added you` : "Your team leader added you";
  const whoText = addedBy ? `${addedBy} added you` : "Your team leader added you";
  const html = teamEmailShell(subject, `
          <h2 style="margin-top:0; color:#18181B; font-size:20px;">You're on the team</h2>
          <p>${salutation.html}<br><br>${who} to team <strong>${escapeHtml(params.teamName)}</strong> for <strong>${escapeHtml(params.eventTitle)}</strong>. ${statusLine}</p>
          <p>Your registration page shows your ticket, your team, and lets you leave the team if you can't make it.</p>
          ${teamButton(ticketUrl, "View your registration")}`);
  const text = `${subject}\n\n${salutation.text}\n\n${whoText} to team "${params.teamName}" for "${params.eventTitle}". ${statusLine}\n\nView your registration: ${ticketUrl}\n\nBest regards,\nYuyu Events`;

  if (!transporter) {
    console.log("[EMAIL MOCK] team member ticket queued");
    return;
  }
  await transporter.sendMail({ messageId: params.messageId, from, to: params.to, subject, text, html });
}

/** Confirmation that a hackathon project was submitted. Carries no capability. */
export async function sendSubmissionReceivedEmail(params: {
  to: string;
  eventTitle: string;
  projectTitle: string;
  teamName?: string;
  eventPath: string;
  recipientName?: string;
  messageId?: string;
}): Promise<void> {
  const { transporter, from } = await getEmailTransport();
  const eventUrl = `${getBaseUrl()}${params.eventPath}`;
  const salutation = greeting(params.recipientName);
  const subject = `Submission received · ${headerText(params.eventTitle)}`;
  const forTeam = params.teamName ? ` for team <strong>${escapeHtml(params.teamName)}</strong>` : "";
  const forTeamText = params.teamName ? ` for team "${params.teamName}"` : "";
  const html = teamEmailShell(subject, `
          <h2 style="margin-top:0; color:#18181B; font-size:20px;">Your project is in</h2>
          <p>${salutation.html}<br><br>We received <strong>${escapeHtml(params.projectTitle)}</strong>${forTeam} for <strong>${escapeHtml(params.eventTitle)}</strong>.</p>
          <p>You can still edit or withdraw it until submissions close.</p>
          ${teamButton(eventUrl, "View the event")}`);
  const text = `${subject}\n\n${salutation.text}\n\nWe received "${params.projectTitle}"${forTeamText} for "${params.eventTitle}".\nYou can still edit or withdraw it until submissions close.\n\n${eventUrl}\n\nBest regards,\nYuyu Events`;
  if (!transporter) {
    console.log("[EMAIL MOCK] submission confirmation queued");
    return;
  }
  await transporter.sendMail({ messageId: params.messageId, from, to: params.to, subject, text, html });
}

/**
 * A solo registrant's private submission link. The path carries a bearer
 * capability; never log it. Sent only to the registration's own address.
 */
export async function sendSubmissionLinkEmail(params: {
  to: string;
  eventTitle: string;
  submitPath: string;
  recipientName?: string;
  messageId?: string;
}): Promise<void> {
  const { transporter, from } = await getEmailTransport();
  const submitUrl = `${getBaseUrl()}${params.submitPath}`;
  const salutation = greeting(params.recipientName);
  const subject = `Your submission link · ${headerText(params.eventTitle)}`;
  const html = teamEmailShell(subject, `
          <h2 style="margin-top:0; color:#18181B; font-size:20px;">Submit your project</h2>
          <p>${salutation.html}<br><br>Use this private link to draft, submit, edit, or withdraw your project for <strong>${escapeHtml(params.eventTitle)}</strong>. Keep it to yourself: anyone with it can change your submission. Requesting a new link retires this one.</p>
          ${teamButton(submitUrl, "Open your submission")}`);
  const text = `${subject}\n\n${salutation.text}\n\nUse this private link to draft, submit, edit, or withdraw your project for "${params.eventTitle}". Keep it to yourself: anyone with it can change your submission. Requesting a new link retires this one.\n\n${submitUrl}\n\nBest regards,\nYuyu Events`;
  if (!transporter) {
    console.log("[EMAIL MOCK] submission link queued");
    return;
  }
  await transporter.sendMail({ messageId: params.messageId, from, to: params.to, subject, text, html });
}

/** Results are published: link to the public results page. Never includes scores. */
export async function sendResultsPublishedEmail(params: {
  to: string;
  eventTitle: string;
  resultsPath: string;
  recipientName?: string;
  messageId?: string;
}): Promise<void> {
  const { transporter, from } = await getEmailTransport();
  const resultsUrl = `${getBaseUrl()}${params.resultsPath}`;
  const salutation = greeting(params.recipientName);
  const subject = `Results are out · ${headerText(params.eventTitle)}`;
  const html = teamEmailShell(subject, `
          <h2 style="margin-top:0; color:#18181B; font-size:20px;">The results are in</h2>
          <p>${salutation.html}<br><br>The organisers of <strong>${escapeHtml(params.eventTitle)}</strong> have published the results. Thank you for taking part.</p>
          ${teamButton(resultsUrl, "See the results")}`);
  const text = `${subject}\n\n${salutation.text}\n\nThe organisers of "${params.eventTitle}" have published the results. Thank you for taking part.\n\n${resultsUrl}\n\nBest regards,\nYuyu Events`;
  if (!transporter) {
    console.log("[EMAIL MOCK] results announcement queued");
    return;
  }
  await transporter.sendMail({ messageId: params.messageId, from, to: params.to, subject, text, html });
}

/** Content of the "Are you still coming?" email; exported for the dashboard preview and unit tests. */
export type AttendanceCheckEmailParams = {
  eventTitle: string;
  organisationName: string;
  startDateTime: Date;
  timezone: string;
  /** "Online", the venue, or empty. */
  location: string;
  /** Site-relative `/attend/{token}` path; made absolute with NEXT_PUBLIC_BASE_URL. */
  attendPath: string;
  recipientName?: string;
  /** A reminder to someone who has not replied yet. */
  reminder?: boolean;
  /**
   * The event's "free the place on No" setting at delivery. Only then does the
   * email say a No gives the place up; otherwise a No is just recorded.
   */
  releaseOnDecline?: boolean;
  /** Absolute base for links; defaults to NEXT_PUBLIC_BASE_URL. */
  baseUrl?: string;
};

export function buildAttendanceCheckEmail(params: AttendanceCheckEmailParams): { subject: string; html: string; text: string } {
  const baseUrl = (params.baseUrl ?? getBaseUrl()).replace(/\/$/, "");
  const formUrl = `${baseUrl}${params.attendPath}`;
  const join = formUrl.includes("?") ? "&" : "?";
  const yesUrl = `${formUrl}${join}answer=yes`;
  const noUrl = `${formUrl}${join}answer=no`;
  const salutation = greeting(params.recipientName);
  const when = formatEventDateTime(params.startDateTime, params.timezone);
  const where = params.location.replace(/[\u0000-\u001F\u007F]+/g, " ").trim().slice(0, 300);
  const subject = `${params.reminder ? "Reminder: are" : "Are"} you still coming to ${headerText(params.eventTitle)}?`;
  const safeTitle = escapeHtml(params.eventTitle);
  const safeOrg = escapeHtml(params.organisationName);
  const purpose = params.releaseOnDecline
    ? "Your answer helps them plan. If you can't come, answering No gives up your place so someone else can have it."
    : "Your answer helps them plan.";
  const button = (url: string, label: string, primary: boolean) =>
    `<a href="${escapeHtml(url)}" style="display:inline-block; margin:6px 8px 6px 0; padding:14px 24px; border-radius:999px; text-decoration:none; font-weight:600; font-size:16px; ${primary ? "background:#18181B; color:#fff;" : "background:#fff; color:#18181B; border:2px solid #18181B;"}">${escapeHtml(label)}</a>`;
  const html = teamEmailShell(subject, `
          <h2 style="margin-top:0; color:#18181B; font-size:20px;">Are you still coming?</h2>
          <p>${salutation.html}<br><br>${safeOrg} would like to know whether you can still make it to <strong>${safeTitle}</strong>. ${escapeHtml(purpose)}</p>
          <table role="presentation" style="margin:16px 0; border-collapse:collapse; font-size:15px; color:#1c1b1f;">
            <tr><td style="padding:4px 12px 4px 0; color:#79747e;">When</td><td style="padding:4px 0;">${escapeHtml(when)}</td></tr>
            ${where ? `<tr><td style="padding:4px 12px 4px 0; color:#79747e;">Where</td><td style="padding:4px 0;">${escapeHtml(where)}</td></tr>` : ""}
          </table>
          <p style="margin:24px 0 8px;">${button(yesUrl, "Yes, I'll be there", true)}${button(noUrl, "No, I can't make it", false)}</p>
          <p style="font-size:13px; color:#666;">Each button opens a short page where you confirm your answer. You can change it there until the event starts. This link is personal; please don't forward it.</p>
          <p style="font-size:13px; color:#666; overflow-wrap:anywhere;">${escapeHtml(formUrl)}</p>`);
  const text = [
    subject,
    "",
    salutation.text,
    "",
    `${params.organisationName} would like to know whether you can still make it to "${params.eventTitle}". ${purpose}`,
    "",
    `When: ${when}`,
    ...(where ? [`Where: ${where}`] : []),
    "",
    `Yes, I'll be there: ${yesUrl}`,
    `No, I can't make it: ${noUrl}`,
    "",
    "Each link opens a short page where you confirm your answer. You can change it there until the event starts. This link is personal; please don't forward it.",
    "",
    "Best regards,",
    "Yuyu Events",
  ].join("\n");
  return { subject, html, text };
}

/** Sends one attendance confirmation question. The link is a bearer capability; never log it. */
export async function sendAttendanceCheckEmail(params: AttendanceCheckEmailParams & { to: string; messageId?: string }): Promise<void> {
  const { transporter, from } = await getEmailTransport();
  const email = buildAttendanceCheckEmail(params);
  if (!transporter) {
    console.log("[EMAIL MOCK] attendance confirmation queued");
    return;
  }
  await transporter.sendMail({ messageId: params.messageId, from, to: params.to, subject: email.subject, text: email.text, html: email.html });
}

export async function sendCollaboratorInvitation(params: { to: string; eventTitle: string; inviteUrl: string; messageId?: string }) {
  const { transporter, from } = await getEmailTransport();
  const subject = `Co-organizer invitation: ${headerText(params.eventTitle)}`;
  const safeUrl = escapeHtml(params.inviteUrl);
  const text = `You have been invited to co-organize "${params.eventTitle}". Sign in with this email address to accept:\n${params.inviteUrl}`;
  const html = `<p>You have been invited to co-organize <strong>${escapeHtml(params.eventTitle)}</strong>.</p><p><a href="${safeUrl}">Accept co-organizer invite</a></p><p>${safeUrl}</p>`;
  if (!transporter) { console.log("[EMAIL MOCK] collaborator invitation queued"); return; }
  await transporter.sendMail({ messageId: params.messageId, from, to: params.to, subject, text, html });
}

export async function sendReminder(params: {
  to: string;
  eventTitle: string;
  startsAtIso: string;
  messageId?: string;
}): Promise<void> {
  const { transporter, from } = await getEmailTransport();

  const formattedDate = new Date(params.startsAtIso).toLocaleString();
  const safeTitle = escapeHtml(params.eventTitle);
  const subjectTitle = headerText(params.eventTitle);

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Upcoming Event Reminder: ${safeTitle}</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8f9fa; margin: 0; padding: 20px; color: #1c1b1f;">
        <div style="max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #e0e0e0; box-shadow: 0 4px 12px rgba(0,0,0,0.05); overflow: hidden;">
          ${emailBrandHeader()}
          <div style="padding: 32px;">
            <h2 style="margin-top: 0; color: #18181B; font-size: 20px; font-weight: 600;">Upcoming Event Reminder</h2>
            <p style="font-size: 16px; line-height: 1.5; color: #49454f; margin-bottom: 24px;">
              Hello,<br><br>
              This is a reminder that the event <strong>${safeTitle}</strong> is starting soon!<br><br>
              <strong>Start Time:</strong> ${formattedDate}
            </p>
          </div>
          <div style="background-color: #f4f4f2; padding: 16px; text-align: center; font-size: 12px; color: #79747e; border-top: 1px solid #e0e0e0;">
            This email was sent by Yuyu Events.<br>
            © ${new Date().getFullYear()} Yuyu. All rights reserved.
          </div>
        </div>
      </body>
    </html>
  `;

  const text = `Upcoming Event Reminder: ${params.eventTitle}\n\nHello,\n\nThis is a reminder that "${params.eventTitle}" is starting at ${formattedDate}.\n\nBest regards,\nYuyu Events`;

  if (!transporter) {
    console.log("[EMAIL MOCK] event reminder queued");
    return;
  }

  await transporter.sendMail({
    messageId: params.messageId,
    from,
    to: params.to,
    subject: `Reminder: ${subjectTitle} is starting soon`,
    text,
    html,
  });
}

export { inlineBroadcastStyles };

/** The exact message a recipient receives; also used for the dashboard preview. */
export function buildBroadcastEmail(params: {
  subject: string;
  bodyHtml: string;
  bodyText: string;
  eventTitle: string;
  organisationName: string;
  design?: BroadcastDesignId;
  brand?: BroadcastBrand;
  /** Only the dashboard preview sets this (to ""), so site images load relative to the page. */
  imageBaseUrl?: string;
}) {
  const subject = headerText(params.subject) || headerText(params.eventTitle) || "Event update";
  const design = isBroadcastDesign(params.design) ? params.design : DEFAULT_BROADCAST_DESIGN;
  const html = renderBroadcastDesign(design, {
    subject,
    bodyHtml: params.bodyHtml,
    eventTitle: params.eventTitle,
    organisationName: params.organisationName,
    brand: params.brand ?? {},
    // Recipients need an absolute public address; without one, site images are left out.
    baseUrl: params.imageBaseUrl ?? (process.env.NEXT_PUBLIC_BASE_URL?.trim().replace(/\/$/, "") || null),
  });
  const text = `${params.bodyText.replace(/\r\n?/g, "\n").trim()}\n\n—\nYou are receiving this because you registered for "${params.eventTitle}" with ${params.organisationName}.`;
  return { subject, html, text };
}

/** Organiser-written broadcast to an existing registration. The body is sanitised HTML rendered per recipient. */
export async function sendEventBroadcast(params: {
  to: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  eventTitle: string;
  organisationName: string;
  design?: BroadcastDesignId;
  brand?: BroadcastBrand;
  messageId?: string;
}): Promise<void> {
  const { transporter, from } = await getEmailTransport();
  const { subject, html, text } = buildBroadcastEmail(params);

  if (!transporter) {
    console.log("[EMAIL MOCK] event broadcast queued");
    return;
  }

  await transporter.sendMail({ messageId: params.messageId, from, to: params.to, subject, text, html });
}
