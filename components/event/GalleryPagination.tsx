import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { paginationWindow } from "@/lib/pagination";

/**
 * Page-number navigation for a list paged by URL (the public project gallery,
 * Account → Registrations), with plain links so every page has its own
 * shareable URL. Same look as the Discover page's pager and the organiser
 * `PageNumberPager`. Renders nothing for a single page.
 */
export function GalleryPagination({ page, totalPages, hrefFor, label = "Pagination" }: { page: number; totalPages: number; hrefFor: (page: number) => string; label?: string }) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-center gap-1.5 pt-2">
      {page > 1 ? (
        <Button asChild variant="secondary">
          <Link href={hrefFor(page - 1)} rel="prev"><ChevronLeft aria-hidden className="size-4" />Previous</Link>
        </Button>
      ) : (
        <Button variant="secondary" disabled><ChevronLeft aria-hidden className="size-4" />Previous</Button>
      )}
      {paginationWindow(page, totalPages).map((target) => (
        <Link
          key={target}
          href={hrefFor(target)}
          aria-current={target === page ? "page" : undefined}
          aria-label={`Page ${target}`}
          className={cn("inline-flex size-11 items-center justify-center rounded-full text-[15px] font-bold", target === page ? "bg-primary text-on-primary" : "text-ink-secondary hover:bg-muted")}
        >
          {target}
        </Link>
      ))}
      {page < totalPages ? (
        <Button asChild variant="secondary">
          <Link href={hrefFor(page + 1)} rel="next">Next<ChevronRight aria-hidden className="size-4" /></Link>
        </Button>
      ) : (
        <Button variant="secondary" disabled>Next<ChevronRight aria-hidden className="size-4" /></Button>
      )}
    </nav>
  );
}
