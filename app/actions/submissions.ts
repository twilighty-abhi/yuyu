"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { submissionTokenSchema, teamTokenSchema, ticketTokenSchema } from "@/lib/validators";
import { resolveRsvpByTicketToken } from "@/lib/core/teams";
import {
  requestSubmissionLink,
  resolveEntrantBySubmissionLink,
  resolveEntrantByTeamManageToken,
  resolveEntrantForUser,
  saveSubmissionDraft,
  submitSubmission,
  withdrawSubmission,
  type EntrantAuth,
} from "@/lib/core/judging";
import type { ActionResult } from "./org";

/**
 * Entrant-side hackathon submission actions (docs/HACKATHON.md). The rules
 * (confirmed entrants only, the window checked against server time inside
 * the write transaction, disqualified projects frozen) live in
 * lib/core/judging.ts; these wrappers authenticate the capability, rate
 * limit, and audit.
 *
 * A `SubmissionRef` names how the entrant proves who they are:
 * - `manageToken`: the team leader's `/team/{token}` management link;
 * - `submissionToken`: a solo registrant's emailed `/submit/{token}` link;
 * - `eventId`: only an identifier, which resolves solely for a signed-in
 *   user who owns a member RSVP of the team, or the solo RSVP, on that event.
 *
 * The ticket (check-in) token never edits a submission: it only asks for a
 * submission link to be emailed to the registration's own address.
 *
 * Audit metadata never holds tokens, names, emails, or project content.
 */

const TOO_MANY = "Too many changes. Please try again shortly.";
const LINK_EXPIRED = "This link is no longer valid. Use the newest link from your email, or sign in to your account.";
const NOT_FOUND = "Registration not found.";

const submissionRefSchema = z.union([
  z.object({ manageToken: teamTokenSchema }).strict(),
  z.object({ submissionToken: submissionTokenSchema }).strict(),
  z.object({ eventId: z.string().trim().min(1).max(128) }).strict(),
]);
export type SubmissionRef = { manageToken: string } | { submissionToken: string } | { eventId: string };

type EntrantContext = { auth: EntrantAuth; actorUserId: string | null };

async function resolveEntrant(ref: unknown): Promise<EntrantContext | null> {
  const parsed = submissionRefSchema.safeParse(ref);
  if (!parsed.success) return null;
  const session = await auth();
  const actorUserId = session?.user?.id ?? null;
  if ("manageToken" in parsed.data) {
    const entrant = await resolveEntrantByTeamManageToken(parsed.data.manageToken);
    return entrant ? { auth: entrant, actorUserId } : null;
  }
  if ("submissionToken" in parsed.data) {
    const entrant = await resolveEntrantBySubmissionLink(parsed.data.submissionToken);
    return entrant ? { auth: entrant, actorUserId } : null;
  }
  // A bare event id is only an identifier: it resolves solely for the signed-in entrant.
  if (!actorUserId) return null;
  const entrant = await resolveEntrantForUser(actorUserId, parsed.data.eventId);
  return entrant ? { auth: entrant, actorUserId } : null;
}

/** One rate-limit subject per entrant, however they authenticated. */
function entrantSubject(entrant: EntrantAuth) {
  return "teamId" in entrant ? `submission:team:${entrant.teamId}` : `submission:rsvp:${entrant.rsvpId}`;
}

async function audit(entrant: EntrantContext, action: string, submissionId: string | null, metadata: Record<string, string | number | boolean | null> = {}) {
  const event = await prisma.event.findUnique({ where: { id: entrant.auth.eventId }, select: { organisationId: true } });
  if (!event) return;
  await recordAuditEvent({
    action,
    actorUserId: entrant.actorUserId,
    organisationId: event.organisationId,
    targetType: submissionId ? "Submission" : "Event",
    targetId: submissionId ?? entrant.auth.eventId,
    metadata: { eventId: entrant.auth.eventId, via: entrant.auth.kind, ...metadata },
  }).catch(() => console.error("[submissions] audit failed"));
}

/** Save the project without submitting it. A submitted project stays submitted (an edit). */
export async function saveSubmissionDraftAction(ref: unknown, input: unknown): Promise<ActionResult<{ status: string }>> {
  const entrant = await resolveEntrant(ref);
  if (!entrant) return { ok: false, error: LINK_EXPIRED };
  if (await isActionRateLimited("action", entrantSubject(entrant.auth))) return { ok: false, error: TOO_MANY };
  const result = await saveSubmissionDraft(entrant.auth, input);
  if (!result.ok) return result;
  return { ok: true, data: { status: result.data.status } };
}

/** Save and submit. The core queues the `submission-received` email on the first transition to SUBMITTED. */
export async function submitSubmissionAction(ref: unknown, input: unknown): Promise<ActionResult<{ status: string; receiptQueued: boolean }>> {
  const entrant = await resolveEntrant(ref);
  if (!entrant) return { ok: false, error: LINK_EXPIRED };
  if (await isActionRateLimited("action", entrantSubject(entrant.auth))) return { ok: false, error: TOO_MANY };
  const result = await submitSubmission(entrant.auth, input);
  if (!result.ok) return result;
  await audit(entrant, "SUBMISSION_SUBMITTED", result.data.submissionId);
  return { ok: true, data: { status: result.data.status, receiptQueued: result.data.receiptQueued } };
}

/** Withdraw the project while the window is open. It can be submitted again later. */
export async function withdrawSubmissionAction(ref: unknown): Promise<ActionResult<{ status: string }>> {
  const entrant = await resolveEntrant(ref);
  if (!entrant) return { ok: false, error: LINK_EXPIRED };
  if (await isActionRateLimited("action", entrantSubject(entrant.auth))) return { ok: false, error: TOO_MANY };
  const result = await withdrawSubmission(entrant.auth);
  if (!result.ok) return result;
  await audit(entrant, "SUBMISSION_WITHDRAWN", null);
  return { ok: true, data: { status: result.data.status } };
}

/**
 * From the ticket page: email a solo registrant their `/submit/{token}` link.
 * The link goes only to the registration's own address, so holding the
 * ticket QR alone is never enough. Account-owned registrations also need
 * that account signed in, as for cancellation. The raw token is never
 * returned to the browser.
 */
export async function requestSubmissionLinkAction(ticketToken: unknown): Promise<ActionResult<{ sent: boolean }>> {
  const parsed = ticketTokenSchema.safeParse(ticketToken);
  if (!parsed.success) return { ok: false, error: NOT_FOUND };
  const session = await auth();
  const actorUserId = session?.user?.id ?? null;
  const holder = await resolveRsvpByTicketToken(parsed.data, actorUserId);
  if (!holder) return { ok: false, error: NOT_FOUND };
  // Each request can send an email: the stricter invitation budget, plus the core's per-registration cooldown.
  if (await isActionRateLimited("invite", `submission-link:${holder.rsvpId}`)) {
    return { ok: false, error: "Too many link requests. Please try again later." };
  }
  const result = await requestSubmissionLink(holder);
  if (!result.ok) return result;
  if (result.data.sent) {
    await recordAuditEvent({
      action: "SUBMISSION_LINK_REQUESTED",
      actorUserId,
      organisationId: holder.organisationId,
      targetType: "RSVP",
      targetId: holder.rsvpId,
      metadata: { eventId: holder.eventId },
    }).catch(() => console.error("[submissions] audit failed"));
  }
  return { ok: true, data: { sent: result.data.sent } };
}
