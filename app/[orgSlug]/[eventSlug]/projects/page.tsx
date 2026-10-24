import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { Search, Users, X } from "lucide-react";
import { loadProjectGallery } from "@/lib/core/judging";
import { galleryHref, JUDGING_SEARCH_MAX_LENGTH, parsePageParam, parseSearchParam } from "@/lib/judgingPaging";
import { publicJudgingMetadata, resolvePublicJudgingEvent } from "@/lib/publicJudgingPage";
import { accentStyle } from "@/lib/theme/accent";
import { Breadcrumb } from "@/components/event/Breadcrumb";
import { ProjectLinks } from "@/components/event/ProjectLinks";
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
  return publicJudgingMetadata(orgSlug, eventSlug, "projects", { page: parsePageParam(sp.page), searched: parseSearchParam(sp.q) !== "" });
}

/**
 * Public project gallery (docs/HACKATHON.md): submitted projects only, once
 * the submission window has closed and the organiser made the gallery public.
 * The event page's visibility rules apply first; anything else is a 404.
 *
 * Paged on the server with page numbers in the URL (`?page=N`, plus an
 * optional `?q=` search on project title, team name, or a solo entrant's
 * first name), so every page is shareable and crawlable.
 */
export default async function EventProjectsPage({ params, searchParams }: Props) {
  const [{ orgSlug, eventSlug }, sp] = await Promise.all([params, searchParams]);
  const resolved = await resolvePublicJudgingEvent(orgSlug, eventSlug);
  if (!resolved) notFound();
  const { org, event, preview } = resolved;
  const requestedPage = parsePageParam(sp.page);
  const gallery = await loadProjectGallery(event.id, undefined, { page: requestedPage, query: parseSearchParam(sp.q) });
  if (!gallery) notFound();
  const eventHref = `/${org.slug}/${event.slug}`;
  const galleryPath = `${eventHref}/projects`;
  // A page past the end goes to the last page, so each URL shows what it names.
  if (requestedPage !== gallery.page) redirect(galleryHref(galleryPath, gallery.page, gallery.query));
  const count = gallery.total;
  const { query, page, totalPages, pageSize, matched } = gallery;
  const firstShown = (page - 1) * pageSize + 1;
  const lastShown = firstShown + gallery.projects.length - 1;

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
          <form action={galleryPath} method="get" role="search" className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative w-full min-w-0 sm:max-w-[420px]">
              <label htmlFor="projects-q" className="sr-only">Search projects</label>
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
                <Link href={galleryPath} aria-label="Clear search" className="absolute right-1.5 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-muted text-ink-muted hover:text-ink">
                  <X aria-hidden className="size-4" />
                </Link>
              ) : null}
            </div>
            <Button type="submit" variant="secondary" className="h-11 shrink-0">Search</Button>
            {matched > 0 ? (
              <p className="text-caption text-ink-muted sm:ml-auto">
                {query ? `${matched} matching · ` : null}
                {firstShown}–{lastShown} of {matched}
              </p>
            ) : null}
          </form>

          {gallery.projects.length === 0 ? (
            <EmptyState title="No matching projects">
              Nothing matches that search.{" "}
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

          <GalleryPagination page={page} totalPages={totalPages} hrefFor={(target) => galleryHref(galleryPath, target, query)} label="Project pages" />
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
      {project.summary ? <p className="whitespace-pre-line break-words text-body text-ink-secondary">{project.summary}</p> : null}
      <ProjectLinks links={project} projectTitle={project.title} className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-1" />
    </article>
  );
}
