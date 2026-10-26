import { EventPermission } from "@prisma/client";
import { guardEventPermission } from "@/lib/dashboardGuards";

// The schedule manager needs OWNER/ADMIN or PUBLISH_AND_SCHEDULE. Awaited
// here, outside this segment's loading.tsx, so a refusal is a real 404/307
// rather than a streamed 200 (lib/dashboardGuards.ts).
export default async function ScheduleGuardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string; eventId: string }>;
}) {
  const { orgSlug, eventId } = await params;
  await guardEventPermission(orgSlug, eventId, EventPermission.PUBLISH_AND_SCHEDULE);
  return children;
}
