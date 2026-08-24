import type { NextConfig } from "next";

const allowedActionOrigins = process.env.ALLOWED_ACTION_ORIGINS
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedDevOrigins = Array.from(new Set([
  "127.0.0.1",
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
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
          ...(isProduction
            ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
