import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/dashboard/", "/super-admin/", "/ticket/", "/team/", "/*/*/team/", "/submit/", "/attend/", "/join/", "/crew/"] },
    // Crawlers expect an absolute sitemap URL (same base as app/sitemap.ts).
    sitemap: `${(process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, "")}/sitemap.xml`,
  };
}
