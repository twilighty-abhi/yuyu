import type { MetadataRoute } from "next";
import { helpSections } from "@/content/help/manifest";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  const guide = helpSections
    .filter((section) => section.access === "public")
    .flatMap((section) => section.articles.map((article) => `/help/${article.slug}`));
  return ["/", "/about", "/discover", "/features", "/help", ...guide].map((path) => ({ url: `${baseUrl}${path}`, lastModified: new Date() }));
}
