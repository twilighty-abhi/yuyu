/**
 * Pure helpers for the in-app guide: heading anchors, MDX-to-text for the
 * table of contents and search, and the search ranking used in the browser.
 * Kept free of server-only imports so the search box can use them.
 */

export type HelpHeading = { id: string; title: string; level: 2 | 3 };

/** A searchable slice of an article: its intro, or one `##` section. */
export type HelpSearchSection = { heading: string | null; anchor: string | null; text: string };

export type HelpSearchDocument = {
  slug: string;
  title: string;
  summary: string;
  section: string;
  sections: HelpSearchSection[];
};

export type HelpSearchResult = {
  slug: string;
  title: string;
  section: string;
  heading: string | null;
  anchor: string | null;
  snippet: string;
};

/** "Who can see it?" → "who-can-see-it". Used by the MDX heading components and the TOC. */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Inline markdown to plain words: links, emphasis, code and HTML-ish tags. */
export function inlineToText(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lines outside fenced code blocks, with the fence state tracked line by line. */
function proseLines(source: string): Array<{ line: string; inFence: boolean }> {
  let inFence = false;
  return source.split(/\r?\n/).map((line) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return { line, inFence: true };
    }
    return { line, inFence };
  });
}

/** `##` and `###` headings in source order, with the same ids the rendered page uses. */
export function extractHeadings(source: string): HelpHeading[] {
  const headings: HelpHeading[] = [];
  for (const { line, inFence } of proseLines(source)) {
    if (inFence) continue;
    const match = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const title = inlineToText(match[2]);
    headings.push({ id: headingId(title), title, level: match[1].length as 2 | 3 });
  }
  return headings;
}

/** One line of MDX as readable text, or "" for syntax that carries no words. */
function lineToText(line: string): string {
  const trimmed = line.trim();
  if (!trimmed || /^(import|export)\s/.test(trimmed)) return "";
  // Self-closing components (screenshots) and bare opening/closing tags carry no prose.
  if (/^<[A-Za-z][^>]*\/>$/.test(trimmed) || /^<\/?[A-Za-z][^>]*>$/.test(trimmed)) return "";
  if (/^\|?\s*:?-{3,}/.test(trimmed)) return "";
  return inlineToText(
    trimmed
      .replace(/^#{1,6}\s+/, "")
      .replace(/^>\s?/, "")
      .replace(/^(\d+\.|[-*+])\s+/, "")
      .replace(/\|/g, " "),
  );
}

/** Splits an article into its intro and `##` sections as plain text, for search. */
export function extractSearchSections(source: string): HelpSearchSection[] {
  const sections: HelpSearchSection[] = [{ heading: null, anchor: null, text: "" }];
  for (const { line, inFence } of proseLines(source)) {
    const heading = inFence ? null : /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const title = inlineToText(heading[1]);
      sections.push({ heading: title, anchor: headingId(title), text: "" });
      continue;
    }
    const text = inFence ? line.trim() : lineToText(line);
    if (!text) continue;
    const current = sections[sections.length - 1];
    current.text = current.text ? `${current.text} ${text}` : text;
  }
  return sections.filter((section) => section.heading !== null || section.text);
}

function tokens(query: string): string[] {
  return Array.from(new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 1 || /\d/.test(token))));
}

function snippetAround(text: string, terms: string[], length = 160): string {
  const lower = text.toLowerCase();
  const at = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 50);
  const slice = text.slice(start, start + length).trim();
  return `${start > 0 ? "…" : ""}${slice}${start + length < text.length ? "…" : ""}`;
}

/**
 * Ranks guide sections for a query. Every term must appear somewhere in the
 * article (title, summary or text); titles and headings weigh most. Returns
 * the best section of each matching article, best article first.
 */
export function searchHelp(documents: HelpSearchDocument[], query: string, limit = 8): HelpSearchResult[] {
  const terms = tokens(query);
  if (terms.length === 0) return [];
  const scored: Array<HelpSearchResult & { score: number }> = [];

  for (const doc of documents) {
    const title = doc.title.toLowerCase();
    const summary = doc.summary.toLowerCase();
    const all = `${title} ${summary} ${doc.sections.map((section) => `${section.heading ?? ""} ${section.text}`).join(" ")}`.toLowerCase();
    if (!terms.every((term) => all.includes(term))) continue;

    let best: { section: HelpSearchSection; score: number } | null = null;
    for (const section of doc.sections) {
      const heading = (section.heading ?? "").toLowerCase();
      const text = section.text.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (heading.includes(term)) score += 6;
        if (text.includes(term)) score += 1 + Math.min(3, text.split(term).length - 2);
      }
      if (!best || score > best.score) best = { section, score };
    }
    let articleScore = best?.score ?? 0;
    for (const term of terms) {
      if (title.includes(term)) articleScore += 10;
      if (summary.includes(term)) articleScore += 3;
    }
    if (title === query.trim().toLowerCase()) articleScore += 20;

    const section = best && best.score > 0 ? best.section : null;
    scored.push({
      slug: doc.slug,
      title: doc.title,
      section: doc.section,
      heading: section?.heading ?? null,
      anchor: section?.anchor ?? null,
      snippet: section?.text ? snippetAround(section.text, terms) : doc.summary,
      score: articleScore,
    });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit)
    .map((result) => ({ slug: result.slug, title: result.title, section: result.section, heading: result.heading, anchor: result.anchor, snippet: result.snippet }));
}
