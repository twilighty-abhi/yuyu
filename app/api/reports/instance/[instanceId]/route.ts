import { auth } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { createEventReportPdf, getOccurrenceReportMetrics, isReportAvailable, reportFilename } from "@/lib/eventReport";
import { getMembership, isOrgAdmin } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function missing() {
  return new Response(null, { status: 404 });
}

type ReportRouteContext = { params: Promise<{ instanceId: string }> };

export async function GET(_request: Request, context: ReportRouteContext) {
  const session = await auth();
  if (!session?.user?.id) return missing();

  const { instanceId } = await context.params;
  const metrics = await getOccurrenceReportMetrics(instanceId);
  if (!metrics || !isReportAvailable(metrics.endDateTime)) return missing();

  const membership = await getMembership(session.user.id, metrics.organisationId);
  if (!membership || !isOrgAdmin(membership.role)) return missing();

  const pdf = await createEventReportPdf(metrics);
  await recordAuditEvent({ action: "EVENT_OCCURRENCE_REPORT_DOWNLOADED", actorUserId: session.user.id, organisationId: metrics.organisationId, targetType: "EventInstance", targetId: metrics.targetId });
  return new Response(pdf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${reportFilename(metrics)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
