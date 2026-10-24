import { auth } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { buildJudgingExportRows } from "@/lib/core/judging";
import { buildCsv } from "@/lib/csv";
import { prisma } from "@/lib/db";
import { resolveJudgingOrganiser } from "@/lib/judgingAccess";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/*
 * Judging scores as CSV (docs/HACKATHON.md): organisation OWNER/ADMIN only,
 * the same check as the organiser judging actions. One row per judge review
 * with the result score and rank; judge names but no emails, comments,
 * entrant emails, or ticket links. Every cell goes through buildCsv, which
 * neutralises spreadsheet formulas. Anyone else gets the same bare 404 as a
 * missing event.
 */

const MAX_EVENT_ID_LENGTH = 128;

function missing() {
  return new Response(null, {
    status: 404,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function filename(eventTitle: string) {
  const safeTitle = eventTitle
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 50) || "event";
  return `judging_${safeTitle}_${new Date().toISOString().slice(0, 10)}.csv`;
}

type RouteContext = { params: Promise<{ eventId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return missing();

  const { eventId } = await context.params;
  if (!eventId || eventId.length > MAX_EVENT_ID_LENGTH) return missing();
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, title: true, organisation: { select: { slug: true } } },
  });
  if (!event) return missing();

  const ctx = await resolveJudgingOrganiser(userId, event.organisation.slug, event.id);
  if (!ctx) return missing();

  const rows = await buildJudgingExportRows(ctx);
  if (!rows) return missing();

  await recordAuditEvent({
    action: "JUDGING_SCORES_EXPORTED",
    actorUserId: userId,
    organisationId: ctx.organisationId,
    targetType: "Event",
    targetId: event.id,
    metadata: { rows: Math.max(0, rows.length - 1) },
  });

  return new Response(`﻿${buildCsv(rows)}\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename(event.title)}"`,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
