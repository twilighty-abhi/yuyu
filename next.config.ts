import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** Prisma must not be bundled by Turbopack or model delegates (e.g. `eventSeries`) can be missing at runtime. */
  serverExternalPackages: ["@prisma/client"],
};

export default nextConfig;
