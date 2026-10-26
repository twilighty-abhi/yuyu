import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/dashboard/", "/super-admin/", "/ticket/", "/team/", "/*/*/team/", "/submit/", "/join/", "/crew/"] },
    sitemap: "/sitemap.xml",
  };
}
