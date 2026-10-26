import { guardOrgRole } from "@/lib/dashboardGuards";

// Organisation settings are for owners and admins. Awaited here, outside this
// segment's loading.tsx, so a refusal is a real 404/307 rather than a streamed
// 200 (lib/dashboardGuards.ts).
export default async function SettingsGuardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  await guardOrgRole(orgSlug, "ADMIN");
  return children;
}
