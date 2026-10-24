"use client";

import { useId, useRef, useState } from "react";
import { ChevronDown, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { FeedbackResponsesPanel } from "@/components/feedback/FeedbackResponsesPanel";
import type { FeedbackResponsesPage } from "@/lib/eventDashboard/feedbackResponses";
import { RATING_DOTS, type FeedbackInsights } from "./helpers";

/** Rating labels can be numbers ("5") or words ("Excellent"); the label column fits the longest one. */
function labelIsWord(rows: ReadonlyArray<{ value: string | number }>) {
  return rows.some((row) => !/^\d+$/.test(String(row.value)));
}

function labelWidth(rows: ReadonlyArray<{ value: string | number }>) {
  const longest = Math.max(1, ...rows.map((row) => String(row.value).length));
  return `${Math.min(longest, 16) + 0.5}ch`;
}

/**
 * Feedback summary for organisation admins: rating distributions, the latest
 * text answers and the full anonymous response list on demand, in numbered
 * pages read on the server. Data arrives
 * pre-aggregated from the server and never includes attendee identity.
 */
export function ResponsesCard({
  organisationSlug,
  eventId,
  insights,
  initialPage,
  exportHref,
  timeZone,
}: {
  organisationSlug: string;
  eventId: string;
  insights: FeedbackInsights;
  /** The first page of individual responses; later pages are fetched on the server. */
  initialPage: FeedbackResponsesPage;
  exportHref?: string;
  timeZone: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const count = insights.responseCount;
  const openList = () => {
    setShowAll(true);
    requestAnimationFrame(() => {
      listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      listRef.current?.focus({ preventScroll: true });
    });
  };

  return (
    <section aria-labelledby="feedback-responses-title" className="flex flex-col gap-5 rounded-2xl border border-line bg-canvas p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="feedback-responses-title" className="text-h4 text-ink">Responses</h2>
          <p className="mt-0.5 text-body-ui text-ink-muted">
            {count === 1 ? "1 response" : `${count} responses`} · shown without names
          </p>
        </div>
        {exportHref ? (
          <Button asChild variant="secondary" size="sm">
            <a href={exportHref}>
              <Download aria-hidden className="size-4" />
              Download CSV
            </a>
          </Button>
        ) : null}
      </div>

      {count === 0 ? (
        <p className="text-body-ui text-ink-muted">No feedback yet. Answers appear here as soon as people submit the form.</p>
      ) : (
        <>
          {insights.ratings.map((rating) => (
            <div key={rating.fieldId} className="flex flex-col gap-2">
              <h3 className="text-label text-ink wrap-anywhere">{rating.label}</h3>
              {rating.total === 0 ? (
                <p className="text-sm text-ink-muted">No ratings yet.</p>
              ) : (
                <>
                  <ul className="flex flex-col gap-1.5">
                    {rating.rows.map((row) => (
                      <li key={row.value} className="flex items-center gap-2.5 text-sm">
                        <span
                          title={String(row.value)}
                          className={cn("shrink-0 truncate tabular-nums text-ink-muted", labelIsWord(rating.rows) ? "text-left" : "text-right")}
                          style={{ width: labelWidth(rating.rows) }}
                        >
                          {row.value}
                        </span>
                        <span aria-hidden className="flex gap-[3px]">
                          {Array.from({ length: RATING_DOTS }, (_, index) => (
                            <span key={index} className={cn("size-2.5 rounded-full", index < row.dots ? "bg-brand-marigold" : "bg-track")} />
                          ))}
                        </span>
                        <span className="tabular-nums text-ink-secondary">
                          {row.count}
                          <span className="sr-only">{row.count === 1 ? " response" : " responses"} rated {row.value}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {rating.average != null ? (
                    <p className="text-caption text-ink-muted">
                      Average {rating.average.toFixed(1)} from {rating.total} {rating.total === 1 ? "rating" : "ratings"}
                    </p>
                  ) : rating.top ? (
                    <p className="text-caption text-ink-muted">
                      Most said “{rating.top}” · {rating.total} {rating.total === 1 ? "answer" : "answers"}
                    </p>
                  ) : null}
                </>
              )}
            </div>
          ))}

          {insights.texts.map((text) => (
            <div key={text.fieldId} className="flex flex-col gap-2">
              <h3 className="text-label text-ink wrap-anywhere">{text.label}</h3>
              {text.recent.length === 0 ? (
                <p className="text-sm text-ink-muted">No answers yet.</p>
              ) : (
                <>
                  {text.recent.map((quote, index) => (
                    <blockquote key={index} className="line-clamp-4 whitespace-pre-wrap rounded-xl bg-subtle px-3.5 py-2.5 text-sm text-ink-secondary wrap-anywhere">
                      “{quote}”
                    </blockquote>
                  ))}
                  {text.total > text.recent.length ? (
                    <button
                      type="button"
                      onClick={openList}
                      aria-controls={listId}
                      className="self-start text-sm font-semibold text-ink underline-offset-4 hover:underline"
                    >
                      All {text.total} answers →
                    </button>
                  ) : null}
                </>
              )}
            </div>
          ))}

          <div className="flex flex-col gap-3 border-t border-line pt-4">
            <Button
              variant="quiet"
              size="sm"
              className="self-start"
              aria-expanded={showAll}
              aria-controls={listId}
              endIcon={<ChevronDown className={cn("transition-transform", showAll && "rotate-180")} />}
              onClick={() => (showAll ? setShowAll(false) : openList())}
            >
              {showAll ? "Hide individual responses" : "Show individual responses"}
            </Button>
            <div id={listId} ref={listRef} tabIndex={-1} hidden={!showAll} className="scroll-mt-24 outline-none">
              {showAll ? <FeedbackResponsesPanel organisationSlug={organisationSlug} eventId={eventId} initialPage={initialPage} timeZone={timeZone} /> : null}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
