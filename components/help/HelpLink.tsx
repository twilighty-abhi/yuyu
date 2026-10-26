import Link from "next/link";
import { CircleHelp } from "lucide-react";
import { cn } from "@/lib/cn";
import type { HelpArticleSlug } from "@/content/help/manifest";

/**
 * A quiet "Learn more" link from a screen to its guide article. It opens in a
 * new tab so unsaved work on the screen is never lost. `article` is typed
 * against the guide's manifest, so a renamed article fails type-checking.
 */
export function HelpLink({ article, section, children = "Help", className }: { article: HelpArticleSlug; section?: string; children?: string; className?: string }) {
  return (
    <Link
      href={`/help/${article}${section ? `#${section}` : ""}`}
      target="_blank"
      rel="noopener"
      className={cn("inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full px-2 text-caption font-medium text-ink-muted underline-offset-4 transition-colors hover:text-ink hover:underline", className)}
    >
      <CircleHelp aria-hidden className="size-4" />
      {children}
      <span className="sr-only"> (opens the guide in a new tab)</span>
    </Link>
  );
}
