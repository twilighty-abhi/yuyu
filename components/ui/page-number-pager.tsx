"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { paginationWindow } from "@/lib/pagination";

/**
 * Previous · page numbers · Next for organiser lists that fetch numbered
 * pages through Server Actions (Guests · Invites, Judging → Results). The
 * same window and look as the Discover pager and the public gallery's
 * `GalleryPagination`, as buttons, with 44px touch targets. Renders nothing
 * for a single page.
 */
export function PageNumberPager({
  label,
  page,
  totalPages,
  disabled,
  onPage,
}: {
  /** Names the navigation landmark, such as "Invite pages". */
  label: string;
  page: number;
  totalPages: number;
  disabled?: boolean;
  onPage: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-center gap-1.5">
      <Button variant="secondary" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft aria-hidden className="size-4" />
        Previous
      </Button>
      {paginationWindow(page, totalPages).map((number) => (
        <button
          key={number}
          type="button"
          disabled={disabled}
          aria-current={number === page ? "page" : undefined}
          aria-label={`Page ${number}`}
          onClick={() => (number === page ? undefined : onPage(number))}
          className={cn(
            "inline-flex size-11 items-center justify-center rounded-full text-body-ui font-bold tabular-nums disabled:cursor-not-allowed disabled:opacity-60",
            number === page ? "bg-primary text-on-primary" : "text-ink-secondary hover:bg-muted",
          )}
        >
          {number}
        </button>
      ))}
      <Button variant="secondary" disabled={disabled || page >= totalPages} onClick={() => onPage(page + 1)}>
        Next
        <ChevronRight aria-hidden className="size-4" />
      </Button>
    </nav>
  );
}
