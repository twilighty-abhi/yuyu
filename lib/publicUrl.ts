import { headers } from "next/headers";

/** Origin for absolute links (tickets, emails). Prefer forwarded headers when behind a proxy. */
export async function getRequestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  if (host) return `${proto}://${host}`;
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  if (fromEnv) return fromEnv;
  return "http://localhost:3000";
}
