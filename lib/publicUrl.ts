import { headers } from "next/headers";

/** Origin for absolute links (tickets, emails). Prefer forwarded headers when behind a proxy. */
export async function getRequestOrigin(): Promise<string> {
  const canonical = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (canonical) return canonical;
  const h = await headers();
  const trusted = process.env.TRUSTED_PROXY_IP_HEADER;
  // Only use forwarded host/proto when the request came through a configured
  // trusted edge. Production configuration requires a canonical URL above.
  const host = trusted ? h.get("x-forwarded-host") : h.get("host");
  const proto = trusted ? h.get("x-forwarded-proto") ?? "https" : "http";
  if (host) return `${proto}://${host}`;
  return "http://localhost:3000";
}
