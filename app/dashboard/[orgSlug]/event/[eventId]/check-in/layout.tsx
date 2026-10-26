import { EventPermission } from "@prisma/client";
import { guardEventPermission } from "@/lib/dashboardGuards";

// The check-in desk needs OWNER/ADMIN or the CHECK_IN grant (never JUDGE-
// only). Awaited here, outside this segment's loading.tsx, so a refusal is a
// real 404/307 rather than a streamed 200 (lib/dashboardGuards.ts).
export default async function CheckInGuardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string; eventId: string }>;
}) {
  const { orgSlug, eventId } = await params;
  await guardEventPermission(orgSlug, eventId, EventPermission.CHECK_IN);
  return children;
}
