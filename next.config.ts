import type { NextConfig } from "next";

const allowedActionOrigins = process.env.ALLOWED_ACTION_ORIGINS
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedDevOrigins = Array.from(new Set([
  "127.0.0.1",
  // Development only: Cloudflare quick tunnels for testing on a phone. Without
  // this, Next.js blocks the app's scripts on the tunnel host and the page
  // (and its install prompt) only half works.
  "*.trycloudflare.com",
  ...(process.env.NEXT_DEV_ALLOWED_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) ?? []),
]));
const isProduction = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  /** Prisma must not be bundled by Turbopack or model delegates (e.g. `eventSeries`) can be missing at runtime. */
  serverExternalPackages: ["@prisma/client", "sharp"],
  output: "standalone",
  poweredByHeader: false,
  allowedDevOrigins,
  experimental: {
    serverActions: {
      // The default is same-origin only. Configure this explicitly when a
      // trusted CDN/reverse proxy terminates requests on another hostname.
      ...(allowedActionOrigins?.length ? { allowedOrigins: allowedActionOrigins } : {}),
      bodySizeLimit: "6mb",
    },
  },
  async headers() {
    return [
      {
        // A service worker controls its own update lifecycle. Never let a CDN
        // serve an old worker after a deployment with new application chunks.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
          ...(isProduction
            ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
            : []),
        ],
      },
      // These downloads are bearer capabilities. The catch-all policy above
      // is intentionally overridden here so their URLs never leave the page
      // in a Referer header.
      {
        source: "/api/ticket/:token/download",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        source: "/api/feedback/certificate/:token",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      // Team management and join links are bearer capabilities too
      // (docs/TEAMS.md); the pages also set a no-referrer meta tag.
      {
        source: "/team/:token",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        source: "/:orgSlug/:eventSlug/team/:joinToken",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
