import { guardSeriesDashboard } from "@/lib/dashboardGuards";

// The series is this organisation's and the viewer may open it. Awaited here,
// outside this segment's loading.tsx, so a refusal is a real 404/307 rather
// than a streamed 200 (lib/dashboardGuards.ts).
export default async function SeriesGuardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string; seriesId: string }>;
}) {
  const { orgSlug, seriesId } = await params;
  await guardSeriesDashboard(orgSlug, seriesId);
  return children;
}
