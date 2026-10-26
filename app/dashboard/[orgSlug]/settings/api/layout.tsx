import { guardOrgRole } from "@/lib/dashboardGuards";

// API credentials are for owners only. Awaited here, outside this segment's
// loading.tsx, so a refusal is a real 404/307 rather than a streamed 200
// (lib/dashboardGuards.ts).
export default async function ApiSettingsGuardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  await guardOrgRole(orgSlug, "OWNER");
  return children;
}
