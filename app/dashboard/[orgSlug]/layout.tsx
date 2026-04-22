import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { requireOrgMembership } from "@/lib/permissions";

export default async function OrgSlugLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const { organisation } = await requireOrgMembership(orgSlug);

  return (
    <DashboardLayout
      organisationName={organisation.name}
      organisationSlug={organisation.slug}
    >
      {children}
    </DashboardLayout>
  );
}
