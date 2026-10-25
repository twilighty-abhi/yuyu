import Link from "next/link";
import Form from "next/form";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Search, Trophy, Users, X } from "lucide-react";
import { isProjectGalleryVisible, loadPublicResults } from "@/lib/core/judging";
import { JUDGING_SEARCH_MAX_LENGTH, parseSearchParam } from "@/lib/judgingPaging";
import { placeLabel } from "@/components/event/AwardBadges";
import { Button } from "@/components/ui/button";
import { controlClasses } from "@/components/ui/styles";
import { publicJudgingMetadata, resolvePublicJudgingEvent } from "@/lib/publicJudgingPage";
import { accentStyle } from "@/lib/theme/accent";
import { formatDate } from "@/lib/format/datetime";
import { Breadcrumb } from "@/components/event/Breadcrumb";
import { ProjectLinks } from "@/components/event/ProjectLinks";
import { Callout, Chip, EmptyState } from "@/components/ui/display";
import { cn } from "@/lib/cn";

type Props = {
  params: Promise<{ orgSlug: string; eventSlug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ orgSlug, eventSlug }, sp] = await Promise.all([params, searchParams]);
  return publicJudgingMetadata(orgSlug, eventSlug, "results", { filtered: parseSearchParam(sp.q) !== "" });
}

/** Winners listed before the results page offers a search. */
const RESULTS_SEARCH_THRESHOLD = 10;

/**
 * Public results (docs/HACKATHON.md): awards and winning projects, shown only
 * once the organiser has published results. Never scores or judge comments.
 * The event page's visibility rules apply first; anything else is a 404.
 */
export default async function EventResultsPage({ params, searchParams }: Props) {
  const [{ orgSlug, eventSlug }, sp] = await Promise.all([params, searchParams]);
  const resolved = await resolvePublicJudgingEvent(orgSlug, eventSlug);
  if (!resolved) notFound();
  const { org, event, preview } = resolved;
  const results = await loadPublicResults(event.id, { query: parseSearchParam(sp.q) });
  if (!results) notFound();
  const eventHref = `/${org.slug}/${event.slug}`;
  const resultsPath = `${eventHref}/results`;
  const awards = results.awards.filter((award) => award.winners.length > 0);
  const galleryOpen = isProjectGalleryVisible(event);
  const { query, totalWinners, matchedWinners } = results;
  // Only a long list gets a search; a shared `?q=` link keeps it either way.
  const searchable = totalWinners > RESULTS_SEARCH_THRESHOLD || query !== "";

  return (
    <div style={accentStyle(event.page?.accentColor)} className="yy-accent-scope flex flex-col gap-6">
      {preview ? <Callout tone="info" title="Preview mode">Only authorised organisers can see this page until the event is published.</Callout> : null}
      <Breadcrumb items={[{ label: event.title, href: eventHref }, { label: "Results" }]} />
      <header className="flex flex-col gap-3">
        <h1 className="text-display-m text-ink">Results</h1>
        <p className="text-body-ui text-ink-muted">
          Announced {formatDate(results.publishedAt, event.timezone)}. Congratulations to every team and entrant.
          {galleryOpen ? (
            <>
              {" "}
              <Link href={`${eventHref}/projects`} className="font-semibold text-ink underline underline-offset-4">Browse all projects</Link>
            </>
          ) : null}
        </p>
      </header>

      {searchable ? (
        <div className="flex flex-col gap-3">
          <Form action={resultsPath} role="search" aria-label="Search winners" className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative w-full min-w-0 sm:max-w-[420px]">
              <label htmlFor="results-q" className="sr-only">Search winning projects or teams</label>
              <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
              <input
                id="results-q"
                name="q"
                type="search"
                defaultValue={query}
                placeholder="Search winning projects or teams"
                maxLength={JUDGING_SEARCH_MAX_LENGTH}
                className={cn(controlClasses, "h-11 rounded-full pl-10 pr-11 [&::-webkit-search-cancel-button]:appearance-none")}
              />
              {query ? (
                <Link href={resultsPath} aria-label="Clear search" className="absolute right-1.5 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-muted text-ink-muted hover:text-ink">
                  <X aria-hidden className="size-4" />
                </Link>
              ) : null}
            </div>
            <Button type="submit" variant="secondary" className="h-11 shrink-0">Search</Button>
          </Form>
          <p role="status" aria-live="polite" className="text-caption text-ink-muted">
            {query
              ? `${matchedWinners} of ${totalWinners} ${totalWinners === 1 ? "winner" : "winners"} match`
              : `${totalWinners} ${totalWinners === 1 ? "winner" : "winners"}`}
          </p>
        </div>
      ) : null}

      {awards.length === 0 ? (
        query ? (
          <EmptyState title="No matching winners">
            Nothing matches that search.{" "}
            <Link href={resultsPath} className="font-semibold text-ink underline underline-offset-4">Show all results</Link>
          </EmptyState>
        ) : (
          <EmptyState title="No awards announced">The organisers haven’t listed any winners.</EmptyState>
        )
      ) : (
        <div className="flex flex-col gap-10">
          {awards.map((award, awardIndex) => {
            const headingId = `award-${awardIndex}`;
            return (
              <section key={headingId} aria-labelledby={headingId} className="flex flex-col gap-4">
                <div className="flex items-start gap-3">
                  <span aria-hidden className={cn("mt-1 flex size-10 shrink-0 items-center justify-center rounded-md", award.isTop ? "bg-accent-soft text-accent-text" : "bg-muted text-ink-secondary")}>
                    <Trophy className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <h2 id={headingId} className="break-words text-h2 text-ink">{award.name}</h2>
                    {award.description ? <p className="mt-1 whitespace-pre-line break-words text-body text-ink-secondary">{award.description}</p> : null}
                  </div>
                </div>
                <ol className="flex flex-col gap-3">
                  {award.winners.map((winner) => {
                    const first = winner.place === 1;
                    return (
                      <li key={winner.place} className={cn("flex flex-col gap-2 rounded-lg p-4 sm:p-5", first ? "bg-accent-soft" : "border border-line bg-canvas")}>
                        <div className="flex flex-wrap items-center gap-2">
                          <Chip size="sm" tone={first ? "ink" : "neutral"}>{placeLabel(winner.place)}</Chip>
                          {winner.isTeam ? <Chip size="sm" tone="outline" icon={<Users aria-hidden className="size-3.5" />}>Team</Chip> : null}
                        </div>
                        <p className={cn("break-words text-[19px] font-bold leading-snug", first ? "text-accent-text" : "text-ink")}>{winner.title}</p>
                        <p className="break-words text-sm text-ink-secondary">{winner.entrantName}</p>
                        <ProjectLinks links={winner} projectTitle={winner.title} />
                      </li>
                    );
                  })}
                </ol>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
