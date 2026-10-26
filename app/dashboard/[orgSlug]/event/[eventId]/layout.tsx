import { guardEventDashboard } from "@/lib/dashboardGuards";

// The event is this organisation's and the viewer may open its dashboard.
// Awaited here, above every loading.tsx in the event's segments, so a refusal
// is a real 404/307 rather than a streamed 200 (lib/dashboardGuards.ts).
export default async function EventGuardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string; eventId: string }>;
}) {
  const { orgSlug, eventId } = await params;
  await guardEventDashboard(orgSlug, eventId);
  return children;
}
