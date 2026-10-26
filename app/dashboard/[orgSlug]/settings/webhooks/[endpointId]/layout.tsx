import { guardWebhookEndpoint } from "@/lib/dashboardGuards";

// Another organisation's endpoint id is a plain 404. Awaited here, outside
// this segment's loading.tsx, so a refusal is a real 404/307 rather than a
// streamed 200 (lib/dashboardGuards.ts).
export default async function WebhookEndpointGuardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string; endpointId: string }>;
}) {
  const { orgSlug, endpointId } = await params;
  await guardWebhookEndpoint(orgSlug, endpointId);
  return children;
}
