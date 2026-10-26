import { PageLoader } from "@/components/brand/DotLoader";

// Scoped to the dashboard home only (a route group). A loading.tsx is a
// Suspense boundary around every page below it, and once its fallback streams
// the status is a fixed 200, so a notFound()/redirect() inside it can no longer
// be a real 404/307. That is why there is no app/loading.tsx (public pages and
// the /{shortCode} 307) and no app/dashboard/loading.tsx (organisation and
// event access checks). See lib/dashboardGuards.ts.
export default function Loading() {
  return <PageLoader />;
}
