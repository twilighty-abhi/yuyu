"use client";

import { useEffect, useRef, useState } from "react";
import { loadFeedbackResponsesPage } from "@/app/actions/feedback-form";
import { Callout } from "@/components/ui/display";
import { PageNumberPager } from "@/components/ui/page-number-pager";
import { Accordion, AccordionItem } from "@/components/ui/tabs";
import { formatDayTime } from "@/lib/format/datetime";
import { numberedPageLabel } from "@/lib/judgingOrganiserPaging";
import type { FeedbackResponsesPage } from "@/lib/eventDashboard/feedbackResponses";

/**
 * Anonymous list of individual feedback responses, newest first, one
 * numbered page at a time: the first page comes with the panel and the
 * others through `loadFeedbackResponsesPage` (organisation owners and
 * admins, re-checked on the server). Never receives attendee identity or
 * certificate information.
 */
export function FeedbackResponsesPanel({
  organisationSlug,
  eventId,
  initialPage,
  timeZone,
}: {
  organisationSlug: string;
  eventId: string;
  initialPage: FeedbackResponsesPage;
  /** Event time zone for submission times. */
  timeZone: string;
}) {
  const [data, setData] = useState<FeedbackResponsesPage>(initialPage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const firstRun = useRef(true);

  // A refresh after a change brings a new first page; show it.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    requestSeq.current += 1;
    setData(initialPage);
    setLoading(false);
    setError(null);
  }, [initialPage]);

  async function openPage(page: number) {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    const res = await loadFeedbackResponsesPage({ organisationSlug, eventId, page });
    if (seq !== requestSeq.current) return;
    setLoading(false);
    if (!res.ok || !res.data) {
      setError(res.ok ? "Could not load responses." : res.error);
      return;
    }
    setData(res.data);
    listRef.current?.focus();
  }

  const start = (data.page - 1) * data.pageSize;
  return (
    <section className="flex flex-col gap-3" aria-label="All feedback responses">
      {data.total === 0 ? (
        <p className="text-body-ui text-ink-muted">No feedback responses yet.</p>
      ) : (
        <>
          <p className="text-caption text-ink-muted" aria-live="polite">
            {numberedPageLabel({ start, total: data.total, shown: data.responses.length }, data.total === 1 ? "response" : "responses")}
          </p>
          {error ? (
            <Callout tone="danger" role="alert">
              {error}
            </Callout>
          ) : null}
          <div ref={listRef} tabIndex={-1} aria-busy={loading} className={loading ? "opacity-60 outline-none transition-opacity" : "outline-none"}>
            <Accordion type="multiple" className="rounded-xl border border-line bg-canvas px-4 [&>*:last-child]:border-b-0">
              {data.responses.map((response) => (
                <AccordionItem key={response.id} value={response.id} title={<span className="text-[15px]">Response {response.number} · {formatDayTime(response.submittedAt, timeZone)}</span>}>
                  <div className="flex flex-col gap-3">
                    {response.answers.length === 0 ? (
                      <p className="text-body-ui text-ink-muted">No answers were submitted.</p>
                    ) : (
                      response.answers.map((answer) => (
                        <div key={`${answer.label}:${answer.value}`}>
                          <p className="text-label text-ink">{answer.label}</p>
                          <p className="whitespace-pre-wrap text-body-ui text-ink-secondary wrap-anywhere">{answer.value}</p>
                        </div>
                      ))
                    )}
                  </div>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
          <PageNumberPager label="Response pages" page={data.page} totalPages={data.pageCount} disabled={loading} onPage={(page) => void openPage(page)} />
        </>
      )}
    </section>
  );
}
