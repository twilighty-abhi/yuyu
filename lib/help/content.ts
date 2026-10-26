import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { helpSections, type HelpAccess, type HelpArticleEntry, type HelpSectionEntry } from "@/content/help/manifest";
import { extractHeadings, extractSearchSections, type HelpHeading, type HelpSearchDocument } from "./text";

export type HelpArticle = HelpArticleEntry & { section: HelpSectionEntry };

const sections: readonly HelpSectionEntry[] = helpSections;
const articles: HelpArticle[] = sections.flatMap((section) => section.articles.map((article) => ({ ...article, section })));
const bySlug = new Map(articles.map((article) => [article.slug, article]));

/** Sections the viewer may read, in guide order. */
export function visibleHelpSections(access: ReadonlySet<HelpAccess>): HelpSectionEntry[] {
  return sections.filter((section) => access.has(section.access));
}

/** The article for a URL slug, only when it exists in the manifest and the viewer may read it. */
export function findHelpArticle(slug: string, access: ReadonlySet<HelpAccess>): HelpArticle | null {
  const article = bySlug.get(slug);
  return article && access.has(article.section.access) ? article : null;
}

/** The articles before and after this one in the viewer's reading order. */
export function adjacentHelpArticles(slug: string, access: ReadonlySet<HelpAccess>) {
  const readable = articles.filter((article) => access.has(article.section.access));
  const index = readable.findIndex((article) => article.slug === slug);
  return { previous: index > 0 ? readable[index - 1] : null, next: index >= 0 ? readable[index + 1] ?? null : null };
}

// content/help is traced into the standalone build (next.config.ts) so this
// read works in production as well as in development.
const contentRoot = path.join(process.cwd(), "content", "help");
const sourceCache = new Map<string, Promise<string>>();

/** Raw MDX for a manifest slug. Never called with anything but a manifest slug. */
function readSource(slug: string): Promise<string> {
  if (!bySlug.has(slug)) return Promise.reject(new Error("Unknown help article"));
  let source = sourceCache.get(slug);
  if (!source || process.env.NODE_ENV === "development") {
    source = readFile(path.join(contentRoot, `${slug}.mdx`), "utf8");
    sourceCache.set(slug, source);
    source.catch(() => sourceCache.delete(slug));
  }
  return source;
}

export async function helpArticleHeadings(slug: string): Promise<HelpHeading[]> {
  return extractHeadings(await readSource(slug));
}

/** Plain-text search documents for every article the viewer may read. */
export async function helpSearchDocuments(access: ReadonlySet<HelpAccess>): Promise<HelpSearchDocument[]> {
  const readable = articles.filter((article) => access.has(article.section.access));
  return Promise.all(readable.map(async (article) => ({
    slug: article.slug,
    title: article.title,
    summary: article.summary,
    section: article.section.title,
    sections: extractSearchSections(await readSource(article.slug)),
  })));
}
