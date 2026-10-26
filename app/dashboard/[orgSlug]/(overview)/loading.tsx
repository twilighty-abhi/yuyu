import { PageLoader } from "@/components/brand/DotLoader";
import { OrgDashboardSkeleton } from "@/components/dashboard/OrgDashboardSkeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageLoader label="Loading organisation" />
      <OrgDashboardSkeleton />
    </div>
  );
}
