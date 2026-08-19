import type { NextConfig } from "next";

const allowedActionOrigins = process.env.ALLOWED_ACTION_ORIGINS
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedDevOrigins = process.env.NEXT_DEV_ALLOWED_ORIGINS
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const developmentEvalSource =
  process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
const isProduction = process.env.NODE_ENV === "production";
const contentSecurityPolicy =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' https:; script-src 'self' 'unsafe-inline'" +
  developmentEvalSource +
  "; style-src 'self' 'unsafe-inline'" +
  (isProduction ? "; upgrade-insecure-requests" : "");

const nextConfig: NextConfig = {
  /** Prisma must not be bundled by Turbopack or model delegates (e.g. `eventSeries`) can be missing at runtime. */
  serverExternalPackages: ["@prisma/client"],
  output: "standalone",
  ...(allowedDevOrigins?.length ? { allowedDevOrigins } : {}),
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
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
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
