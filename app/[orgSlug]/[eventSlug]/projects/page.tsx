import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Users } from "lucide-react";
import { loadProjectGallery } from "@/lib/core/judging";
import { publicJudgingMetadata, resolvePublicJudgingEvent } from "@/lib/publicJudgingPage";
import { accentStyle } from "@/lib/theme/accent";
import { Breadcrumb } from "@/components/event/Breadcrumb";
import { ProjectLinks } from "@/components/event/ProjectLinks";
import { Callout, Chip, EmptyState } from "@/components/ui/display";

type Props = { params: Promise<{ orgSlug: string; eventSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { orgSlug, eventSlug } = await params;
  return publicJudgingMetadata(orgSlug, eventSlug, "projects");
}

/**
 * Public project gallery (docs/HACKATHON.md): submitted projects only, once
 * the submission window has closed and the organiser made the gallery public.
 * The event page's visibility rules apply first; anything else is a 404.
 */
export default async function EventProjectsPage({ params }: Props) {
  const { orgSlug, eventSlug } = await params;
  const resolved = await resolvePublicJudgingEvent(orgSlug, eventSlug);
  if (!resolved) notFound();
  const { org, event, preview } = resolved;
  const gallery = await loadProjectGallery(event.id);
  if (!gallery) notFound();
  const eventHref = `/${org.slug}/${event.slug}`;
  const count = gallery.projects.length;

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
        <ul className="grid gap-4 md:grid-cols-2">
          {gallery.projects.map((project) => (
            <li key={project.id}>
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
