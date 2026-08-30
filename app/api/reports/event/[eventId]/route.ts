import { auth } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { createEventReportPdf, getEventReportMetrics, isReportAvailable, reportFilename } from "@/lib/eventReport";
import { getMembership, isOrgAdmin } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function missing() {
  return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
}

type ReportRouteContext = { params: Promise<{ eventId: string }> };

export async function GET(_request: Request, context: ReportRouteContext) {
  const session = await auth();
  if (!session?.user?.id) return missing();

  const { eventId } = await context.params;
  const metrics = await getEventReportMetrics(eventId);
  if (!metrics || !isReportAvailable(metrics.endDateTime)) return missing();

  const membership = await getMembership(session.user.id, metrics.organisationId);
  if (!membership || !isOrgAdmin(membership.role)) return missing();

  const pdf = await createEventReportPdf(metrics);
  await recordAuditEvent({ action: "EVENT_REPORT_DOWNLOADED", actorUserId: session.user.id, organisationId: metrics.organisationId, targetType: "Event", targetId: metrics.targetId });
  return new Response(pdf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${reportFilename(metrics)}"`,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
