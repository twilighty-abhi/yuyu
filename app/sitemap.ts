import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  return ["/", "/about", "/discover", "/features"].map((path) => ({ url: `${baseUrl}${path}`, lastModified: new Date() }));
}
