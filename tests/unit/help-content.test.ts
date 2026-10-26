import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { helpSections } from "@/content/help/manifest";
import screenshots from "@/content/help/screenshots.json";
import { extractHeadings, extractSearchSections, headingId, searchHelp } from "@/lib/help/text";

const root = path.join(process.cwd(), "content", "help");
const articles = helpSections.flatMap((section) => section.articles.map((article) => ({ ...article, access: section.access })));
const sources = new Map(articles.map((article) => [article.slug, readFileSync(path.join(root, `${article.slug}.mdx`), "utf8")]));
const allowedComponents = new Set(["Callout", "Steps", "Kbd", "Screenshot"]);

function mdxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return mdxFiles(full);
    return entry.name.endsWith(".mdx") ? [path.relative(root, full).replace(/\\/g, "/").replace(/\.mdx$/, "")] : [];
  });
}

/** Strips fenced code so examples inside it are not checked as content. */
function prose(source: string): string {
  return source.replace(/^```[\s\S]*?^```/gm, "");
}

describe("guide manifest", () => {
  it("has unique slugs and section ids", () => {
    const slugs = articles.map((article) => article.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const ids = helpSections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("matches the MDX files one to one", () => {
    expect(mdxFiles(root).sort()).toEqual(articles.map((article) => article.slug).sort());
  });

  it("keeps slugs to safe path segments", () => {
    for (const article of articles) expect(article.slug).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+$/);
  });
});

describe("guide articles", () => {
  it.each(articles.map((article) => [article.slug]))("%s is well formed", (slug) => {
    const source = sources.get(slug)!;
    const body = prose(source);
    expect(body, "write the title in manifest.ts, not as a # heading").not.toMatch(/^#\s/m);
    expect(body, "use <Screenshot>, not Markdown images").not.toMatch(/!\[[^\]]*\]\(/);
    expect(body).not.toMatch(/^(import|export)\s/m);

    const ids = extractHeadings(source).map((heading) => heading.id);
    expect(new Set(ids).size, "headings must be unique within an article").toBe(ids.length);

    for (const [, name] of body.matchAll(/<([A-Z][A-Za-z]*)/g)) {
      expect(allowedComponents.has(name), `unknown component <${name}>`).toBe(true);
    }
  });

  it("links only to articles and sections that exist, readable by the same audience", () => {
    const access = new Map<string, string>(articles.map((article) => [article.slug, article.access]));
    const anchors = new Map<string, Set<string>>(articles.map((article) => [article.slug, new Set(extractHeadings(sources.get(article.slug)!).map((heading) => heading.id))]));
    const problems: string[] = [];
    for (const article of articles) {
      for (const [, target] of prose(sources.get(article.slug)!).matchAll(/\]\((\/help[^)\s]*)\)/g)) {
        const [pathname, anchor] = target.split("#");
        const slug = pathname.replace(/^\/help\/?/, "");
        if (slug === "") continue;
        if (!access.has(slug)) problems.push(`${article.slug} → ${target}: no such article`);
        else if (anchor && !anchors.get(slug)!.has(anchor)) problems.push(`${article.slug} → ${target}: no such section`);
        else if (article.access === "public" && access.get(slug) !== "public") problems.push(`${article.slug} → ${target}: public page links to a restricted one`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("uses only screenshots that are registered or still pending capture", () => {
    const known = new Set(Object.keys(screenshots));
    for (const source of sources.values()) {
      for (const [, name] of source.matchAll(/<Screenshot\s+name="([^"]+)"/g)) {
        expect(name).toMatch(/^[a-z0-9-]+$/);
        if (known.has(name)) expect(screenshots[name as keyof typeof screenshots]).toBeTruthy();
      }
    }
  });
});

describe("guide text helpers", () => {
  it("builds anchors from heading text", () => {
    expect(headingId("Who can see it?")).toBe("who-can-see-it");
    expect(headingId("Capacity & the waitlist")).toBe("capacity-and-the-waitlist");
    expect(headingId("The `{{name}}` placeholder")).toBe("the-name-placeholder");
  });

  it("extracts headings outside code fences", () => {
    const source = "Intro\n\n## First **step**\n\n```md\n## Not a heading\n```\n\n### Detail";
    expect(extractHeadings(source)).toEqual([
      { id: "first-step", title: "First step", level: 2 },
      { id: "detail", title: "Detail", level: 3 },
    ]);
  });

  it("turns MDX into searchable sections without markup", () => {
    const source = "Open [the guide](/help).\n\n## Publish\n\n<Callout kind=\"tip\">\n\nPress **Publish**.\n\n</Callout>\n\n<Screenshot name=\"x\" alt=\"y\" />";
    expect(extractSearchSections(source)).toEqual([
      { heading: null, anchor: null, text: "Open the guide." },
      { heading: "Publish", anchor: "publish", text: "Press Publish." },
    ]);
  });

  it("ranks title matches first and requires every term", () => {
    const documents = [
      { slug: "a/one", title: "Check-in desk", summary: "Scan tickets", section: "Check-in", sections: [{ heading: null, anchor: null, text: "Scan a QR ticket at the door." }] },
      { slug: "a/two", title: "Your ticket", summary: "Open your ticket", section: "Attending", sections: [{ heading: "Download", anchor: "download", text: "Download the ticket as a PDF." }] },
    ];
    expect(searchHelp(documents, "ticket").map((result) => result.slug)).toEqual(["a/two", "a/one"]);
    expect(searchHelp(documents, "ticket door").map((result) => result.slug)).toEqual(["a/one"]);
    expect(searchHelp(documents, "download")[0]).toMatchObject({ slug: "a/two", anchor: "download" });
    expect(searchHelp(documents, "   ")).toEqual([]);
  });
});
