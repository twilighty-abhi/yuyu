import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Trophy, Users } from "lucide-react";
import { isProjectGalleryVisible, loadPublicResults } from "@/lib/core/judging";
import { publicJudgingMetadata, resolvePublicJudgingEvent } from "@/lib/publicJudgingPage";
import { accentStyle } from "@/lib/theme/accent";
import { formatDate } from "@/lib/format/datetime";
import { Breadcrumb } from "@/components/event/Breadcrumb";
import { ProjectLinks } from "@/components/event/ProjectLinks";
import { Callout, Chip, EmptyState } from "@/components/ui/display";
import { cn } from "@/lib/cn";

type Props = { params: Promise<{ orgSlug: string; eventSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { orgSlug, eventSlug } = await params;
  return publicJudgingMetadata(orgSlug, eventSlug, "results");
}

function placeLabel(place: number): string {
  const mod100 = place % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : place % 10 === 1 ? "st" : place % 10 === 2 ? "nd" : place % 10 === 3 ? "rd" : "th";
  return `${place}${suffix} place`;
}

/**
 * Public results (docs/HACKATHON.md): awards and winning projects, shown only
 * once the organiser has published results. Never scores or judge comments.
 * The event page's visibility rules apply first; anything else is a 404.
 */
export default async function EventResultsPage({ params }: Props) {
  const { orgSlug, eventSlug } = await params;
  const resolved = await resolvePublicJudgingEvent(orgSlug, eventSlug);
  if (!resolved) notFound();
  const { org, event, preview } = resolved;
  const results = await loadPublicResults(event.id);
  if (!results) notFound();
  const eventHref = `/${org.slug}/${event.slug}`;
  const awards = results.awards.filter((award) => award.winners.length > 0);
  const galleryOpen = isProjectGalleryVisible(event);

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

      {awards.length === 0 ? (
        <EmptyState title="No awards announced">The organisers haven’t listed any winners.</EmptyState>
      ) : (
        <div className="flex flex-col gap-10">
          {awards.map((award, awardIndex) => {
            const headingId = `award-${awardIndex}`;
            return (
              <section key={headingId} aria-labelledby={headingId} className="flex flex-col gap-4">
                <div className="flex items-start gap-3">
                  <span aria-hidden className={cn("mt-1 flex size-10 shrink-0 items-center justify-center rounded-md", awardIndex === 0 ? "bg-accent-soft text-accent-text" : "bg-muted text-ink-secondary")}>
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
