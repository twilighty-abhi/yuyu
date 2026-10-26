import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { guardOrgDashboard } from "@/lib/dashboardGuards";

export default async function OrgSlugLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  // Outside every loading.tsx below, so no access is a real 307 to /dashboard.
  const { organisation } = await guardOrgDashboard(orgSlug);

  return (
    <DashboardLayout
      organisationName={organisation.name}
      organisationSlug={organisation.slug}
    >
      {children}
    </DashboardLayout>
  );
}
