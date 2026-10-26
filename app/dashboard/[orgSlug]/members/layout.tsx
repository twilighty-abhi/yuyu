import { guardOrgRole } from "@/lib/dashboardGuards";

// Members only: collaborators without a membership are sent back. Awaited
// here, outside this segment's loading.tsx, so a refusal is a real 404/307
// rather than a streamed 200 (lib/dashboardGuards.ts).
export default async function MembersGuardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  await guardOrgRole(orgSlug, "MEMBER");
  return children;
}
