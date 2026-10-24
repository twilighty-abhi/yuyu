import { ArrowUpRight } from "lucide-react";
import { isHttpsSubmissionUrl } from "@/lib/validators";
import type { ProjectLinks as ProjectLinksDto } from "@/lib/judgingDto";

const LABELS: Array<[keyof ProjectLinksDto, string]> = [
  ["repoUrl", "Code"],
  ["demoUrl", "Demo"],
  ["videoUrl", "Video"],
];

/**
 * External links of an entrant's project (docs/HACKATHON.md). They are
 * entrant-supplied, so only `https:` links render (checked again here, on top
 * of the write-time validation) and they carry `nofollow ugc`.
 */
export function ProjectLinks({ links, projectTitle, className }: { links: ProjectLinksDto; projectTitle: string; className?: string }) {
  const items = LABELS.flatMap(([key, label]) => {
    const href = links[key];
    return href && isHttpsSubmissionUrl(href) ? [{ key, label, href }] : [];
  });
  if (items.length === 0) return null;
  return (
    <ul className={className ?? "flex flex-wrap gap-x-4 gap-y-1"} aria-label={`Links for ${projectTitle}`}>
      {items.map((item) => (
        <li key={item.key}>
          <a
            href={item.href}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-ink underline underline-offset-4 hover:text-accent-text"
          >
            {item.label}
            <ArrowUpRight aria-hidden className="size-4" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
