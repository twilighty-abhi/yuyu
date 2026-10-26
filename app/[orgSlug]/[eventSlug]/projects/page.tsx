import Link from "next/link";
import Form from "next/form";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { Search, Users, X } from "lucide-react";
import { loadProjectGallery } from "@/lib/core/judging";
import {
  galleryHref,
  isFilteredGalleryView,
  JUDGING_SEARCH_MAX_LENGTH,
  parseGalleryParams,
  type GalleryFilter,
  type GallerySort,
  type GalleryView,
} from "@/lib/judgingPaging";
import { publicJudgingMetadata, resolvePublicJudgingEvent } from "@/lib/publicJudgingPage";
import { accentStyle } from "@/lib/theme/accent";
import { Breadcrumb } from "@/components/event/Breadcrumb";
import { ProjectLinks } from "@/components/event/ProjectLinks";
import { AwardBadges } from "@/components/event/AwardBadges";
import { GalleryPagination } from "@/components/event/GalleryPagination";
import { Button } from "@/components/ui/button";
import { Callout, Chip, EmptyState } from "@/components/ui/display";
import { controlClasses } from "@/components/ui/styles";
import { cn } from "@/lib/cn";
import type { PublicGalleryItemDto } from "@/lib/judgingDto";

type Props = {
  params: Promise<{ orgSlug: string; eventSlug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ orgSlug, eventSlug }, sp] = await Promise.all([params, searchParams]);
  // Lenient on purpose: any valid filter or order counts, so a filtered view
  // never claims its own canonical URL.
  const view = parseGalleryParams(sp, true);
  return publicJudgingMetadata(orgSlug, eventSlug, "projects", { page: view.page, filtered: isFilteredGalleryView(view) });
}

const SORT_LABELS: Record<GallerySort, string> = { newest: "Newest", az: "A–Z", awards: "Awards first" };

const chipClasses = (active: boolean) =>
  cn(
    "inline-flex min-h-9 items-center rounded-full border px-3.5 text-[13px] font-bold leading-[1.4] transition-colors",
    active ? "border-primary bg-primary text-on-primary" : "border-line-strong bg-canvas text-ink hover:bg-subtle",
  );

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Public project gallery (docs/HACKATHON.md): submitted projects only, once
 * the submission window has closed and the organiser made the gallery public.
 * The event page's visibility rules apply first; anything else is a 404.
 *
 * Paged on the server with page numbers in the URL (`?page=N`), an optional
 * `?q=` search on project title, team name, or a solo entrant's first name,
 * and, once results are published, `?filter=winners` and `?sort=awards`
 * (`?sort=az` always). Invalid values fall back to the defaults, so every
 * view is a shareable URL. Works without JavaScript (GET form and links).
 */
export default async function EventProjectsPage({ params, searchParams }: Props) {
  const [{ orgSlug, eventSlug }, sp] = await Promise.all([params, searchParams]);
  const resolved = await resolvePublicJudgingEvent(orgSlug, eventSlug);
  if (!resolved) notFound();
  const { org, event, preview } = resolved;
  const requested = parseGalleryParams(sp, event.resultsPublishedAt != null);
  const gallery = await loadProjectGallery(event.id, undefined, requested);
  if (!gallery) notFound();
  const eventHref = `/${org.slug}/${event.slug}`;
  const galleryPath = `${eventHref}/projects`;
  const view: GalleryView = { page: gallery.page, query: gallery.query, filter: gallery.filter, sort: gallery.sort };
  // A page past the end goes to the last page, so each URL shows what it names.
  if (requested.page !== gallery.page) redirect(galleryHref(galleryPath, view));
  const count = gallery.total;
  const { query, page, totalPages, pageSize, matched, filter, sort, resultsPublished } = gallery;
  const firstShown = (page - 1) * pageSize + 1;
  const lastShown = firstShown + gallery.projects.length - 1;
  const narrowed = query !== "" || filter !== "all";
  const showWinnersFilter = resultsPublished && (gallery.winners > 0 || filter === "winners");
  const sorts: GallerySort[] = resultsPublished ? ["newest", "az", "awards"] : ["newest", "az"];
  const filters: Array<{ value: GalleryFilter; label: string }> = [
    { value: "all", label: "All projects" },
    { value: "winners", label: `Award winners (${gallery.winners})` },
  ];
  const status =
    matched === 0
      ? narrowed
        ? "No matching projects"
        : "No projects"
      : `${narrowed ? `${plural(matched, "matching project", "matching projects")}` : plural(matched, "project", "projects")}${totalPages > 1 ? `, showing ${firstShown}–${lastShown}` : ""}`;

  return (
    <div style={accentStyle(event.page?.accentColor)} className="yy-accent-scope flex flex-col gap-6">
      {preview ? <Callout tone="info" title="Preview mode">Only authorised organisers can see this page until the event is published.</Callout> : null}
      <Breadcrumb items={[{ label: event.title, href: eventHref }, { label: "Projects" }]} />
      <header className="flex flex-col gap-3">
        <h1 className="text-display-m text-ink">Projects</h1>
        <p className="text-body-ui text-ink-muted">
          {count === 1 ? "1 project" : `${count} projects`} submitted to {event.title}.
          {event.submissionsEnabled && event.resultsPublishedAt ? (
            <>
              {" "}
              <Link href={`${eventHref}/results`} className="font-semibold text-ink underline underline-offset-4">See the results</Link>
            </>
          ) : null}
        </p>
      </header>

      {count === 0 ? (
        <EmptyState title="No projects to show">Nothing was submitted to this event.</EmptyState>
      ) : (
        <>
          <div className="flex flex-col gap-4">
            <Form action={galleryPath} role="search" aria-label="Search projects" className="flex flex-col gap-3 sm:flex-row sm:items-center">
              {filter !== "all" ? <input type="hidden" name="filter" value={filter} /> : null}
              {sort !== "newest" ? <input type="hidden" name="sort" value={sort} /> : null}
              <div className="relative w-full min-w-0 sm:max-w-[420px]">
                <label htmlFor="projects-q" className="sr-only">Search projects or teams</label>
                <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
                <input
                  id="projects-q"
                  name="q"
                  type="search"
                  defaultValue={query}
                  placeholder="Search projects or teams"
                  maxLength={JUDGING_SEARCH_MAX_LENGTH}
                  className={cn(controlClasses, "h-11 rounded-full pl-10 pr-11 [&::-webkit-search-cancel-button]:appearance-none")}
                />
                {query ? (
                  <Link href={galleryHref(galleryPath, { filter, sort })} aria-label="Clear search" className="absolute right-1.5 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-muted text-ink-muted hover:text-ink">
                    <X aria-hidden className="size-4" />
                  </Link>
                ) : null}
              </div>
              <Button type="submit" variant="secondary" className="h-11 shrink-0">Search</Button>
            </Form>

            <div className="flex flex-wrap items-center justify-between gap-3">
              {showWinnersFilter ? (
                <nav aria-label="Filter projects" className="flex flex-wrap gap-2">
                  {filters.map((option) => (
                    <Link key={option.value} href={galleryHref(galleryPath, { query, sort, filter: option.value })} aria-current={filter === option.value ? "true" : undefined} className={chipClasses(filter === option.value)}>
                      {option.label}
                    </Link>
                  ))}
                </nav>
              ) : (
                <span aria-hidden />
              )}
              <nav aria-label="Sort projects" className="flex rounded-full bg-muted p-1">
                {sorts.map((option) => (
                  <Link
                    key={option}
                    href={galleryHref(galleryPath, { query, filter, sort: option })}
                    aria-current={sort === option ? "true" : undefined}
                    className={cn(
                      "inline-flex min-h-9 items-center rounded-full px-3.5 text-[13px] font-bold transition-colors",
                      sort === option ? "bg-canvas text-ink shadow-segment" : "text-ink-secondary hover:text-ink",
                    )}
                  >
                    {SORT_LABELS[option]}
                  </Link>
                ))}
              </nav>
            </div>

            <p role="status" aria-live="polite" className="text-caption text-ink-muted">{status}</p>
          </div>

          {gallery.projects.length === 0 ? (
            <EmptyState title="No matching projects">
              {query ? "Nothing matches that search." : "No award winners to show."}{" "}
              <Link href={galleryPath} className="font-semibold text-ink underline underline-offset-4">Show all projects</Link>
            </EmptyState>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {gallery.projects.map((project) => (
                <li key={project.id}>
                  <ProjectCard project={project} />
                </li>
              ))}
            </ul>
          )}

          <GalleryPagination page={page} totalPages={totalPages} hrefFor={(target) => galleryHref(galleryPath, { ...view, page: target })} label="Project pages" />
        </>
      )}
    </div>
  );
}

function ProjectCard({ project }: { project: PublicGalleryItemDto }) {
  return (
    <article aria-labelledby={`project-${project.id}`} className="flex h-full flex-col gap-3 rounded-lg border border-line bg-canvas p-5">
      <div className="flex flex-col gap-1.5">
        <h2 id={`project-${project.id}`} className="break-words text-[19px] font-bold leading-snug text-ink">{project.title}</h2>
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-secondary">
          {project.isTeam ? <Chip size="sm" tone="accent" icon={<Users aria-hidden className="size-3.5" />}>Team</Chip> : null}
          <span className="min-w-0 break-words">{project.entrantName}</span>
        </p>
      </div>
      <AwardBadges awards={project.awards} />
      {project.summary ? <p className="whitespace-pre-line break-words text-body text-ink-secondary">{project.summary}</p> : null}
      <ProjectLinks links={project} projectTitle={project.title} className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-1" />
    </article>
  );
}
