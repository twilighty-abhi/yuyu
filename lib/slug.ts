const slugRegex = /[^a-z0-9]+/g;

export function slugifyTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(slugRegex, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "event";
}

export function withSlugSuffix(base: string, suffix: number): string {
  return suffix === 0 ? base : `${base}-${suffix}`;
}
