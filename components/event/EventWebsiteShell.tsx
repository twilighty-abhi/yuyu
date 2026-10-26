import Link from "next/link";
import { ArrowRight, ArrowUpRight, ChevronDown, LayoutGrid, MapPin, Trophy, Video } from "lucide-react";
import { accentStyle } from "@/lib/theme/accent";
import { formatDateBlock, formatDayLong, formatTime, formatTimeRange, formatTimeZoneName } from "@/lib/format/datetime";
import { Avatar, Callout, Chip, DateBlock } from "@/components/ui/display";
import type { RegistrationFieldDefinition } from "@/components/rsvp/registrationTypes";
import type { TeamRegistrationConfig } from "@/components/rsvp/TeamRegistrationFields";
import { RegistrationCard } from "./RegistrationCard";
import { SectionNav } from "./SectionNav";

type Props = {
  orgSlug: string;
  organisation: { name: string; logoUrl: string | null };
  preview: boolean;
  event: {
    slug: string;
    title: string;
    coverImageUrl: string | null;
    location: string;
    isOnline: boolean;
    status: string;
    start: string;
    end: string;
    timezone: string;
    capacity: number | null;
  };
  page: {
    tagline: string;
    logoUrl: string | null;
    accentColor: string | null;
    aboutHtml: string;
    sections: Array<{ type: string; isVisible: boolean }>;
  };
  highlights: Array<{ id: string; title: string; description: string }>;
  sessions: Array<{
    id: string;
    slug: string;
    title: string;
    start: string;
    end: string;
    type: string;
    trackId: string;
    trackName: string;
    trackSortOrder: number;
    speakers: Array<{ slug: string; name: string }>;
  }>;
  speakers: Array<{ id: string; slug: string; name: string; photoUrl: string | null; websiteUrl: string | null; headline: string; organisation: string }>;
  sponsors: Array<{ id: string; name: string; logoUrl: string | null; description: string; websiteUrl: string | null; tier: string }>;
  venue: { location: string; mapLinkUrl: string | null } | null;
  faqs: Array<{ id: string; question: string; answerHtml: string }>;
  resources: Array<{ id: string; title: string; description: string; href: string }>;
  registrationFields: RegistrationFieldDefinition[];
  confirmedCount: number | null;
  registrationOpen: boolean;
  /** At capacity: new registrations join the waitlist. Derived server-side. */
  registrationFull: boolean;
  approvalRequired: boolean;
  /** Team event settings (docs/TEAMS.md); null for individual registration. */
  team?: TeamRegistrationConfig | null;
  /**
   * Hackathon pages (docs/HACKATHON.md): each href is set only when that page
   * is live (results published; gallery public after the window closed).
   */
  judging?: { resultsHref: string | null; projectsHref: string | null } | null;
};

const SECTION_LABELS: Record<string, string> = {
  ABOUT: "About",
  SCHEDULE: "Schedule",
  SPEAKERS: "Speakers",
  SPONSORS: "Partners",
  VENUE: "Venue",
  FAQ: "FAQ",
  RESOURCES: "Resources",
};

const TIER_LABELS: Record<string, string> = { PLATINUM: "Platinum", GOLD: "Gold", SILVER: "Silver", PARTNER: "Partner", COMMUNITY_PARTNER: "Community" };

function mapSearchQuery(location: string, mapLinkUrl: string | null) {
  if (mapLinkUrl) {
    try {
      const url = new URL(mapLinkUrl);
      const urlQuery = url.searchParams.get("query") || url.searchParams.get("q") || url.searchParams.get("destination");
      if (urlQuery) return urlQuery;
    } catch {
      // The server rejects invalid URLs, but retain a safe rendering fallback.
    }
  }
  return location.trim() || null;
}

function duration(start: string, end: string) {
  const minutes = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000));
  if (minutes === 0) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} hr` : `${Math.floor(hours)} hr ${minutes % 60} min`;
}

function Rich({ html }: { html: string }) {
  return html ? <div className="yy-prose" dangerouslySetInnerHTML={{ __html: html }} /> : null;
}

export function EventWebsiteShell(p: Props) {
  const shown = new Set(p.page.sections.filter((x) => x.isVisible).map((x) => x.type));
  const sectionContent: Array<[string, boolean]> = [
    ["ABOUT", true],
    ["HIGHLIGHTS", p.highlights.length > 0],
    ["SCHEDULE", p.sessions.length > 0],
    ["SPEAKERS", p.speakers.length > 0],
    ["SPONSORS", p.sponsors.length > 0],
    ["VENUE", Boolean(p.venue && !p.event.isOnline)],
    ["FAQ", p.faqs.length > 0],
    ["RESOURCES", p.resources.length > 0],
  ];
  const rendered = new Set(sectionContent.filter(([type, hasContent]) => shown.has(type) && hasContent).map(([type]) => type));
  const navItems = ["ABOUT", "SCHEDULE", "SPEAKERS", "SPONSORS", "VENUE", "FAQ", "RESOURCES"]
    .filter((type) => rendered.has(type))
    .map((type) => ({ id: type.toLowerCase(), label: SECTION_LABELS[type]! }));

  const block = formatDateBlock(p.event.start, p.event.timezone);
  const primaryTrackId = [...p.sessions].sort((a, b) => a.trackSortOrder - b.trackSortOrder)[0]?.trackId;
  const sessions = [...p.sessions].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime() || a.trackSortOrder - b.trackSortOrder);
  const mapQuery = p.venue ? mapSearchQuery(p.venue.location, p.venue.mapLinkUrl) : null;
  const mapHref = p.venue?.mapLinkUrl || (mapQuery ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}` : null);
  const countLabel = [
    p.sessions.length > 0 ? `${p.sessions.length} ${p.sessions.length === 1 ? "session" : "sessions"}` : null,
    p.speakers.length > 0 ? `${p.speakers.length} ${p.speakers.length === 1 ? "speaker" : "speakers"}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div style={accentStyle(p.page.accentColor)} className="yy-accent-scope flex flex-col gap-6">
      {p.preview ? <Callout tone="info" title="Preview mode">Only authorised organisers can see draft content.</Callout> : null}

      {p.event.coverImageUrl ? (
        <div className="overflow-hidden rounded-xl bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element -- covers are served by the app's own upload route */}
          <img src={p.event.coverImageUrl} alt={`${p.event.title} cover`} className="aspect-[16/7] w-full object-cover" />
        </div>
      ) : null}

      <div className="grid gap-x-12 gap-y-8 md:grid-cols-[minmax(0,1fr)_340px]">
        {/* Title block */}
        <header className="flex min-w-0 flex-col gap-5 md:col-start-1 md:row-start-1">
          <div className="flex flex-wrap gap-1.5">
            <Chip tone="accent" size="sm">Free</Chip>
            <Chip size="sm">{p.event.isOnline ? "Online" : "In person"}</Chip>
            {countLabel ? <Chip size="sm">{countLabel}</Chip> : null}
          </div>
          <div className="flex items-start gap-4">
            {p.page.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- event logos are served by the app's own upload route
              <img src={p.page.logoUrl} alt="" className="mt-2 size-14 shrink-0 rounded-[14px] border border-line object-cover sm:size-[68px]" />
            ) : null}
            <h1 className="text-display-l min-w-0 break-words text-accent-text">{p.event.title}</h1>
          </div>
          {p.page.tagline ? <p className="max-w-[640px] text-body-l text-ink-secondary">{p.page.tagline}</p> : null}
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:gap-8">
            <div className="flex items-center gap-3">
              <DateBlock month={block.month} day={block.day} />
              <div>
                <p className="text-[15px] font-semibold text-ink">{formatDayLong(p.event.start, p.event.timezone)}</p>
                <p className="text-sm text-ink-muted">{formatTimeRange(p.event.start, p.event.end, p.event.timezone)}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-md border border-line text-ink-secondary">
                {p.event.isOnline ? <Video className="size-5" /> : <MapPin className="size-5" />}
              </span>
              <p className="text-[15px] font-semibold text-ink">{p.event.isOnline ? "Online event" : p.event.location || "Venue details coming soon"}</p>
            </div>
          </div>
        </header>

        {/* Registration (right column on desktop, under the title on mobile) */}
        <aside className="md:col-start-2 md:row-span-2 md:row-start-1">
          <div className="md:sticky md:top-6">
            <RegistrationCard
              orgSlug={p.orgSlug}
              eventSlug={p.event.slug}
              eventTitle={p.event.title}
              organisation={{ name: p.organisation.name, slug: p.orgSlug, logoUrl: p.organisation.logoUrl }}
              registrationFields={p.registrationFields}
              confirmedCount={p.confirmedCount}
              capacity={p.event.capacity}
              state={{ cancelled: p.event.status === "CANCELLED", open: p.registrationOpen, full: p.registrationFull, approvalRequired: p.approvalRequired }}
              accentColor={p.page.accentColor}
              team={p.team}
            />
          </div>
        </aside>

        {/* Sections */}
        <div className="flex min-w-0 flex-col gap-10 md:col-start-1 md:row-start-2 md:gap-12">
          <SectionNav items={navItems} />

          {p.judging && (p.judging.resultsHref || p.judging.projectsHref) ? (
            <nav aria-label="Hackathon" className="grid gap-3 sm:grid-cols-2">
              {p.judging.resultsHref ? (
                <Link href={p.judging.resultsHref} className="flex items-center gap-3 rounded-lg bg-accent-soft p-4 transition-[filter] hover:brightness-[0.98]">
                  <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-md bg-canvas text-accent-text"><Trophy className="size-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold text-accent-text">Results are in</span>
                    <span className="block text-sm text-ink-secondary">See the awards and winning projects</span>
                  </span>
                  <ArrowRight aria-hidden className="size-4 shrink-0 text-accent-text" />
                </Link>
              ) : null}
              {p.judging.projectsHref ? (
                <Link href={p.judging.projectsHref} className="flex items-center gap-3 rounded-lg border border-line bg-canvas p-4 transition-colors hover:bg-subtle">
                  <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-ink-secondary"><LayoutGrid className="size-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold text-ink">Projects</span>
                    <span className="block text-sm text-ink-muted">Browse everything that was submitted</span>
                  </span>
                  <ArrowRight aria-hidden className="size-4 shrink-0 text-ink-muted" />
                </Link>
              ) : null}
            </nav>
          ) : null}

          {rendered.has("ABOUT") ? (
            <section id="about" aria-label="About" className="flex scroll-mt-6 flex-col gap-5">
              {p.page.aboutHtml ? (
                <Rich html={p.page.aboutHtml} />
              ) : (
                <p className="text-body text-ink-muted">More event details will be shared soon. Save your place now to stay in the loop.</p>
              )}
              {rendered.has("HIGHLIGHTS") ? (
                <ul className="grid gap-3 sm:grid-cols-3">
                  {p.highlights.map((highlight, index) => (
                    <li key={highlight.id} className={index === 0 ? "rounded-lg bg-accent-soft p-4" : "rounded-lg bg-muted p-4"}>
                      <p className={index === 0 ? "font-display text-[22px] font-extrabold leading-tight text-accent-text" : "font-display text-[19px] font-extrabold leading-tight text-ink"}>{highlight.title}</p>
                      {highlight.description ? <p className="mt-1 text-sm text-ink-secondary">{highlight.description}</p> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {rendered.has("SCHEDULE") ? (
            <section id="schedule" aria-labelledby="schedule-title" className="scroll-mt-6">
              <div className="mb-3 flex items-end justify-between gap-3">
                <h2 id="schedule-title" className="text-h2 text-ink">Schedule</h2>
                <Link href={`/${p.orgSlug}/${p.event.slug}/schedule`} className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-ink underline underline-offset-4">
                  Live schedule <ArrowRight aria-hidden className="size-4" />
                </Link>
              </div>
              <p className="mb-2 text-caption text-ink-muted">All times {formatTimeZoneName(p.event.start, p.event.timezone)}</p>
              <ol className="divide-y divide-line border-y border-line">
                {sessions.map((session) => (
                  <li key={session.id} className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-4 gap-y-1 py-4 sm:grid-cols-[88px_minmax(0,1fr)_auto]">
                    <div>
                      <p className="text-[15px] font-bold text-ink">{formatTime(session.start, p.event.timezone)}</p>
                      {duration(session.start, session.end) ? <p className="text-caption text-ink-muted">{duration(session.start, session.end)}</p> : null}
                    </div>
                    <div className="min-w-0">
                      <Link href={`/${p.orgSlug}/${p.event.slug}/sessions/${session.slug}`} className="text-[17px] font-bold leading-snug text-ink hover:underline hover:underline-offset-4">
                        {session.title}
                      </Link>
                      <p className="mt-0.5 text-sm text-ink-muted">
                        {[session.type, session.speakers.map((speaker) => speaker.name).join(", ")].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <div className="col-start-2 sm:col-start-3">
                      <Chip size="sm" tone={session.trackId === primaryTrackId ? "accent" : "neutral"}>{session.trackName}</Chip>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {rendered.has("SPEAKERS") ? (
            <section id="speakers" aria-labelledby="speakers-title" className="scroll-mt-6">
              <h2 id="speakers-title" className="mb-4 text-h2 text-ink">Speakers</h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {p.speakers.map((speaker) => (
                  <li key={speaker.id}>
                    <Link href={`/${p.orgSlug}/${p.event.slug}/speakers/${speaker.slug}`} className="flex items-center gap-3 rounded-lg border border-line bg-canvas p-3.5 transition-colors hover:bg-subtle">
                      <Avatar name={speaker.name} src={speaker.photoUrl} size="lg" tone="accent" />
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-bold text-ink">{speaker.name}</span>
                        <span className="block text-sm text-ink-muted">{[speaker.headline, speaker.organisation].filter(Boolean).join(" · ")}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {rendered.has("SPONSORS") ? (
            <section id="sponsors" aria-labelledby="sponsors-title" className="scroll-mt-6">
              <h2 id="sponsors-title" className="mb-4 text-h2 text-ink">Partners</h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {p.sponsors.map((sponsor) => {
                  const body = (
                    <>
                      {sponsor.logoUrl ? (
                        <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-white p-1">
                          {/* eslint-disable-next-line @next/next/no-img-element -- sponsor logos are served by the app's own upload route */}
                          <img src={sponsor.logoUrl} alt={sponsor.name} className="size-full object-contain" />
                        </span>
                      ) : (
                        <span aria-hidden className="size-10 shrink-0 rounded-md border-[1.5px] border-dashed border-line-strong" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-bold text-ink">{sponsor.name}</span>
                        {sponsor.description ? <span className="block text-sm text-ink-muted">{sponsor.description}</span> : null}
                      </span>
                      <span className="shrink-0 text-caption text-ink-muted">{TIER_LABELS[sponsor.tier] ?? sponsor.tier.replaceAll("_", " ")}</span>
                    </>
                  );
                  return (
                    <li key={sponsor.id}>
                      {sponsor.websiteUrl ? (
                        <a href={sponsor.websiteUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-lg border border-line bg-canvas p-3.5 transition-colors hover:bg-subtle">{body}</a>
                      ) : (
                        <div className="flex items-center gap-3 rounded-lg border border-line bg-canvas p-3.5">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {rendered.has("VENUE") && p.venue ? (
            <section id="venue" aria-labelledby="venue-title" className="grid scroll-mt-6 gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
              {mapQuery ? (
                <iframe
                  title={`Map for ${p.venue.location || "event venue"}`}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  src={`https://maps.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed`}
                  className="h-[240px] w-full rounded-xl border border-line bg-muted sm:h-[260px]"
                />
              ) : null}
              <div className={mapQuery ? undefined : "sm:col-span-2"}>
                <p className="text-overline text-ink-muted">Venue</p>
                <h2 id="venue-title" className="mt-1 text-h3 text-ink">{p.venue.location || "Venue details coming soon"}</h2>
                <p className="mt-2 text-body text-ink-secondary">
                  {p.venue.location ? "Use the map for directions and plan your journey." : "The organiser will share the venue shortly."}
                </p>
                {mapHref ? (
                  <a href={mapHref} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-10 items-center gap-1 text-[15px] font-semibold text-ink underline underline-offset-4">
                    Get directions <ArrowUpRight aria-hidden className="size-4" />
                  </a>
                ) : null}
              </div>
            </section>
          ) : null}

          {rendered.has("FAQ") ? (
            <section id="faq" aria-labelledby="faq-title" className="scroll-mt-6">
              <h2 id="faq-title" className="mb-2 text-h2 text-ink">FAQ</h2>
              <div className="border-t border-line">
                {p.faqs.map((faq) => (
                  <details key={faq.id} className="group border-b border-line">
                    <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 py-3.5 text-[16px] font-bold text-ink [&::-webkit-details-marker]:hidden">
                      <ChevronDown aria-hidden className="size-4 shrink-0 -rotate-90 text-ink-muted transition-transform group-open:rotate-0" />
                      {faq.question}
                    </summary>
                    <div className="pb-4 pl-7"><Rich html={faq.answerHtml} /></div>
                  </details>
                ))}
              </div>
            </section>
          ) : null}

          {rendered.has("RESOURCES") ? (
            <section id="resources" aria-labelledby="resources-title" className="scroll-mt-6">
              <h2 id="resources-title" className="mb-3 text-h2 text-ink">Resources</h2>
              <ul className="divide-y divide-line border-y border-line">
                {p.resources.map((resource) => (
                  <li key={resource.id}>
                    <a href={resource.href} target="_blank" rel="noreferrer" className="flex items-start justify-between gap-4 py-3.5">
                      <span className="min-w-0">
                        <span className="block text-[15px] font-bold text-ink">{resource.title}</span>
                        {resource.description ? <span className="block text-sm text-ink-muted">{resource.description}</span> : null}
                      </span>
                      <ArrowUpRight aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-muted" />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

        </div>
      </div>
    </div>
  );
}
