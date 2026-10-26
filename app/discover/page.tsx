import Link from "next/link";
import { CalendarRange, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { EventPrivacyType, EventStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sqlUtcTimestamp, SQL_UTC_NOW } from "@/lib/sqlTimestamp";
import { auth } from "@/lib/auth";
import type { Metadata } from "next";
import { DiscoverEventCard } from "@/components/discover/DiscoverEventCard";
import { Container } from "@/components/landing/primitives";
import { DotFace } from "@/components/brand/DotFace";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { controlClasses } from "@/components/ui/styles";
import { cn } from "@/lib/cn";
import { INK_ACCENT } from "@/lib/theme/accent";
import { describeRecurrence, recurrenceChip } from "@/lib/format/recurrence";
import { parseDiscoveryDateRange } from "@/lib/dateFilter";
import { paginationWindow } from "@/lib/pagination";
import { listedEventAudienceWhere } from "@/lib/eventVisibility";

export const metadata: Metadata = {
  title: "Discover Events",
  description:
    "Free events from communities on this Yuyu. Register in seconds, no account needed.",
};

const PAGE_SIZE = 12;
const MAX_DISCOVERY_PAGES = 100;
const MAX_QUERY_LENGTH = 120;

type SearchParams = Promise<{
  sort?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: string;
}>;

/** YYYY-MM-DD for a UTC date (discovery date filters are whole UTC days). */
function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** "This week" (today + 6 days) and "This month" (today to month end) as from/to presets. */
function datePresets(now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const weekEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 6));
  const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  return {
    week: { from: isoDay(today), to: isoDay(weekEnd) },
    month: { from: isoDay(today), to: isoDay(monthEnd) },
  };
}

function buildQueryString(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const session = await auth();
  const getStartedHref = session?.user ? "/dashboard" : "/login";
  const sort = sp.sort === "popular" ? "popular" : "upcoming";
  const q = (sp.q?.trim() || "").slice(0, MAX_QUERY_LENGTH);
  const page = Math.min(MAX_DISCOVERY_PAGES, Math.max(1, parseInt(sp.page ?? "1", 10) || 1));

  const { fromDate, toExclusive, error: dateRangeError } = parseDiscoveryDateRange(sp.from, sp.to);

  const eventWhere = {
    status: EventStatus.PUBLISHED,
    AND: listedEventAudienceWhere,
    page: { is: { isPublished: true } },
    endDateTime: { gte: new Date() },
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(!dateRangeError && (fromDate || toExclusive) && {
      startDateTime: {
        ...(fromDate ? { gte: fromDate } : {}),
        ...(toExclusive ? { lt: toExclusive } : {}),
      },
    }),
  } as const;

  const instanceWhere = {
    series: {
      status: EventStatus.PUBLISHED,
      privacyType: EventPrivacyType.PUBLIC,
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" as const } },
              { description: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    endDateTime: { gte: new Date() },
    ...(!dateRangeError && (fromDate || toExclusive) && {
      startDateTime: {
        ...(fromDate ? { gte: fromDate } : {}),
        ...(toExclusive ? { lt: toExclusive } : {}),
      },
    }),
  };

  // Get total counts for pagination
  const [eventCount, instanceCount] = await Promise.all([
    prisma.event.count({ where: eventWhere }),
    prisma.eventInstance.count({ where: instanceWhere }),
  ]);
  const totalItems = eventCount + instanceCount;
  const totalPages = Math.min(MAX_DISCOVERY_PAGES, Math.max(1, Math.ceil(totalItems / PAGE_SIZE)));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const validFrom = dateRangeError ? null : fromDate;
  const validToExclusive = dateRangeError ? null : toExclusive;
  const searchPattern = `%${q}%`;
  const eventFilters = [
    Prisma.sql`e."status" = ${EventStatus.PUBLISHED}::"EventStatus"`,
    Prisma.sql`(e."privacyType" = ${EventPrivacyType.PUBLIC}::"EventPrivacyType" OR (e."privacyType" = ${EventPrivacyType.APPROVAL_REQUIRED}::"EventPrivacyType" AND e."listedPublicly" = TRUE))`,
    Prisma.sql`EXISTS (SELECT 1 FROM "EventPage" ep WHERE ep."eventId" = e."id" AND ep."isPublished" = TRUE)`,
    Prisma.sql`e."endDateTime" >= ${SQL_UTC_NOW}`,
    ...(q ? [Prisma.sql`(e."title" ILIKE ${searchPattern} OR e."description" ILIKE ${searchPattern})`] : []),
    ...(validFrom ? [Prisma.sql`e."startDateTime" >= ${sqlUtcTimestamp(validFrom)}`] : []),
    ...(validToExclusive ? [Prisma.sql`e."startDateTime" < ${sqlUtcTimestamp(validToExclusive)}`] : []),
  ];
  const instanceFilters = [
    Prisma.sql`s."status" = ${EventStatus.PUBLISHED}::"EventStatus"`,
    Prisma.sql`s."privacyType" = ${EventPrivacyType.PUBLIC}::"EventPrivacyType"`,
    Prisma.sql`i."endDateTime" >= ${SQL_UTC_NOW}`,
    ...(q ? [Prisma.sql`(s."title" ILIKE ${searchPattern} OR s."description" ILIKE ${searchPattern})`] : []),
    ...(validFrom ? [Prisma.sql`i."startDateTime" >= ${sqlUtcTimestamp(validFrom)}`] : []),
    ...(validToExclusive ? [Prisma.sql`i."startDateTime" < ${sqlUtcTimestamp(validToExclusive)}`] : []),
  ];
  const ordering = sort === "popular"
    ? Prisma.sql`"popularity" DESC, "startDateTime" ASC, "id" ASC`
    : Prisma.sql`"startDateTime" ASC, "id" ASC`;
  const indexRows = await prisma.$queryRaw<Array<{ kind: "event" | "instance"; id: string }>>(Prisma.sql`
    WITH candidates AS (
      SELECT 'event'::text AS "kind", e."id", e."startDateTime",
        (SELECT COUNT(*)::int FROM "RSVP" r WHERE r."eventId" = e."id" AND r."status" = 'CONFIRMED'::"RsvpStatus") AS "popularity"
      FROM "Event" e
      WHERE ${Prisma.join(eventFilters, " AND ")}
      UNION ALL
      SELECT 'instance'::text AS "kind", i."id", i."startDateTime",
        (SELECT COUNT(*)::int FROM "RSVP" r WHERE r."eventInstanceId" = i."id" AND r."status" = 'CONFIRMED'::"RsvpStatus") AS "popularity"
      FROM "EventInstance" i
      INNER JOIN "EventSeries" s ON s."id" = i."eventSeriesId"
      WHERE ${Prisma.join(instanceFilters, " AND ")}
    )
    SELECT "kind", "id" FROM candidates
    ORDER BY ${ordering}
    LIMIT ${PAGE_SIZE} OFFSET ${startIdx}
  `);
  const eventIds = indexRows.filter((row) => row.kind === "event").map((row) => row.id);
  const instanceIds = indexRows.filter((row) => row.kind === "instance").map((row) => row.id);
  const [events, instances] = await Promise.all([
    prisma.event.findMany({ where: { id: { in: eventIds } }, include: { organisation: { select: { slug: true, name: true } }, page: { select: { accentColor: true } } } }),
    prisma.eventInstance.findMany({ where: { id: { in: instanceIds } }, include: { series: { include: { organisation: { select: { slug: true, name: true } } } } } }),
  ]);
  // Confirmed counts only for events whose organiser shows registration counts publicly.
  const countedEventIds = events.filter((event) => event.showRegistrationCount).map((event) => event.id);
  const goingRows = countedEventIds.length > 0
    ? await prisma.rSVP.groupBy({ by: ["eventId"], where: { eventId: { in: countedEventIds }, status: "CONFIRMED" }, _count: { _all: true } })
    : [];
  const goingByEvent = new Map(goingRows.map((row) => [row.eventId, row._count._all]));
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const instancesById = new Map(instances.map((instance) => [instance.id, instance]));
  type PageItem =
    | { kind: "event"; id: string; orgSlug: string; event: (typeof events)[number] }
    | { kind: "instance"; id: string; orgSlug: string; instance: (typeof instances)[number] };
  const pageItems: PageItem[] = [];
  for (const row of indexRows) {
    if (row.kind === "event") {
      const event = eventsById.get(row.id);
      if (event) pageItems.push({ kind: "event", id: `e-${event.id}`, orgSlug: event.organisation.slug, event });
      continue;
    }
    const instance = instancesById.get(row.id);
    if (instance) pageItems.push({ kind: "instance", id: `i-${instance.id}`, orgSlug: instance.series.organisation.slug, instance });
  }

  const hasActiveFilters = q || sp.from || sp.to || sort !== "upcoming";

  // Build base params for pagination links (preserving current filters)
  const baseParams = {
    ...(q ? { q } : {}),
    ...(sort !== "upcoming" ? { sort } : {}),
    ...(sp.from ? { from: sp.from } : {}),
    ...(sp.to ? { to: sp.to } : {}),
  };

  const pageHref = (target: number) => `/discover${buildQueryString({ ...baseParams, page: String(target) })}`;
  const sortHref = (target: "upcoming" | "popular") => `/discover${buildQueryString({ ...(q ? { q } : {}), ...(sp.from ? { from: sp.from } : {}), ...(sp.to ? { to: sp.to } : {}), ...(target !== "upcoming" ? { sort: target } : {}) })}`;
  const clearSearchHref = `/discover${buildQueryString({ ...(sort !== "upcoming" ? { sort } : {}), ...(sp.from ? { from: sp.from } : {}), ...(sp.to ? { to: sp.to } : {}) })}`;
  const presets = datePresets();
  const rangeHref = (range: { from: string; to: string } | null) => `/discover${buildQueryString({ ...(q ? { q } : {}), ...(sort !== "upcoming" ? { sort } : {}), ...(range ? { from: range.from, to: range.to } : {}) })}`;
  const activeRange = !sp.from && !sp.to
    ? "all"
    : sp.from === presets.week.from && sp.to === presets.week.to
      ? "week"
      : sp.from === presets.month.from && sp.to === presets.month.to
        ? "month"
        : "custom";
  const dateChips = [
    { key: "all", label: "All", href: rangeHref(null) },
    { key: "week", label: "This week", href: rangeHref(presets.week) },
    { key: "month", label: "This month", href: rangeHref(presets.month) },
  ] as const;
  const resultsLabel = q
    ? `${totalItems} ${totalItems === 1 ? "event matches" : "events match"} “${q}”`
    : sort === "popular" ? "Popular events" : "Upcoming events";
  const chipClasses = (active: boolean) =>
    cn(
      "inline-flex min-h-8 items-center rounded-full border px-3.5 text-[13px] font-bold leading-[1.4] transition-colors",
      active ? "border-primary bg-primary text-on-primary" : "border-line-strong bg-canvas text-ink hover:bg-subtle",
    );

  return (
    <div className="flex min-w-0 flex-col">
      {/* Title and search (Figma 125:2367) */}
      <Container className="flex flex-col gap-6 pb-8 pt-12 lg:pt-16">
        <h1 className="text-display-m text-ink">Discover events</h1>
        <p className="max-w-[720px] text-body-l text-ink-secondary">Free events from communities on this Yuyu. Register in seconds, no account needed.</p>
        <form action="/discover" method="get" role="search" className="flex flex-col gap-4">
          {sort !== "upcoming" ? <input type="hidden" name="sort" value={sort} /> : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative w-full min-w-0 sm:max-w-[560px]">
              <label htmlFor="discover-q" className="sr-only">Search events</label>
              <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-muted" />
              <input
                id="discover-q"
                name="q"
                type="search"
                defaultValue={q}
                placeholder="Search events"
                maxLength={MAX_QUERY_LENGTH}
                className={cn(controlClasses, "h-[52px] rounded-full pl-[46px] pr-12 text-body [&::-webkit-search-cancel-button]:appearance-none")}
              />
              {q ? (
                <Link href={clearSearchHref} aria-label="Clear search" className="absolute right-2 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-muted text-ink-muted hover:text-ink">
                  <X aria-hidden className="size-4" />
                </Link>
              ) : null}
            </div>
            <Button type="submit" variant="primary" size="lg" className="h-[52px] shrink-0">Search</Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <nav aria-label="When" className="flex flex-wrap gap-2">
              {dateChips.map((chip) => (
                <Link key={chip.key} href={chip.href} aria-current={activeRange === chip.key ? "true" : undefined} className={chipClasses(activeRange === chip.key)}>
                  {chip.label}
                </Link>
              ))}
            </nav>
            <details className="group" open={activeRange === "custom" || Boolean(dateRangeError)}>
              <summary className={cn(chipClasses(activeRange === "custom"), "cursor-pointer list-none gap-1.5 [&::-webkit-details-marker]:hidden")}>
                <CalendarRange aria-hidden className="size-3.5" />
                Pick dates
              </summary>
              <fieldset className="mt-3 flex flex-wrap items-end gap-2.5">
                <legend className="sr-only">Date range</legend>
                <label className="flex w-[170px] flex-col rounded-[18px] border border-line-strong bg-canvas px-4 py-1.5 focus-within:border-[var(--yy-focus)]">
                  <span className="text-xs text-ink-muted">From</span>
                  <input name="from" type="date" defaultValue={sp.from ?? ""} className="bg-transparent text-[15px] text-ink outline-none" />
                </label>
                <label className="flex w-[170px] flex-col rounded-[18px] border border-line-strong bg-canvas px-4 py-1.5 focus-within:border-[var(--yy-focus)]">
                  <span className="text-xs text-ink-muted">To</span>
                  <input name="to" type="date" defaultValue={sp.to ?? ""} className="bg-transparent text-[15px] text-ink outline-none" />
                </label>
                <Button type="submit" variant="secondary">Apply dates</Button>
              </fieldset>
            </details>
          </div>
        </form>
        {dateRangeError ? <Callout tone="warning" title={dateRangeError}>Date filtering was not applied.</Callout> : null}
      </Container>

      {/* Results (Figma 125:2391) */}
      <Container className="flex flex-col gap-6 pb-16 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="min-w-0 text-label text-ink-secondary [overflow-wrap:anywhere]" aria-live="polite">{resultsLabel}</h2>
          <div className="flex flex-wrap items-center gap-3">
            {totalItems > 0 ? (
              <p className="text-caption text-ink-muted">
                {startIdx + 1}–{Math.min(startIdx + PAGE_SIZE, totalItems)} of {totalItems}
              </p>
            ) : null}
            <nav aria-label="Sort events" className="flex rounded-full bg-muted p-1">
              {(["upcoming", "popular"] as const).map((option) => (
                <Link
                  key={option}
                  href={sortHref(option)}
                  aria-current={sort === option ? "true" : undefined}
                  className={cn(
                    "inline-flex min-h-8 items-center rounded-full px-3.5 text-[13px] font-bold transition-colors",
                    sort === option ? "bg-canvas text-ink shadow-segment" : "text-ink-secondary hover:text-ink",
                  )}
                >
                  {option === "upcoming" ? "Upcoming" : "Popular"}
                </Link>
              ))}
            </nav>
          </div>
        </div>

        {pageItems.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-[20px] border border-line bg-canvas px-6 py-10 text-center">
            <DotFace mood="sleepy" size={56} className="mb-1" />
            <p className="text-label text-ink">Nothing matches just yet</p>
            <p className="max-w-md text-body-ui text-ink-muted">Try clearing a filter or searching for something else.</p>
            {hasActiveFilters ? (
              <Button asChild variant="secondary" size="sm" className="mt-2">
                <Link href="/discover">Clear filters</Link>
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {pageItems.map((row) => (
              // min-w-0: a long unbroken title must wrap, not widen the grid track.
              <li key={row.id} className="min-w-0">
                {row.kind === "event" ? (
                  <DiscoverEventCard
                    event={{
                      href: `/${row.orgSlug}/${row.event.slug}`,
                      title: row.event.title,
                      startDateTime: row.event.startDateTime,
                      timezone: row.event.timezone,
                      location: row.event.location,
                      isOnline: row.event.isOnline,
                      coverImageUrl: row.event.coverImageUrl,
                      accentColor: row.event.page?.accentColor,
                      organisationName: row.event.organisation.name,
                      label: row.event.tags[0] ?? null,
                      goingCount: row.event.showRegistrationCount ? goingByEvent.get(row.event.id) ?? 0 : null,
                    }}
                  />
                ) : (
                  <DiscoverEventCard
                    event={{
                      href: `/${row.orgSlug}/i/${row.instance.id}`,
                      title: row.instance.series.title,
                      startDateTime: row.instance.startDateTime,
                      timezone: row.instance.series.timezone,
                      fallbackAccent: INK_ACCENT,
                      organisationName: row.instance.series.organisation.name,
                      label: recurrenceChip(row.instance.series.recurrenceRule),
                      recurrenceText: describeRecurrence(row.instance.series.recurrenceRule),
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        {totalPages > 1 ? (
          <nav aria-label="Pagination" className="flex flex-wrap items-center justify-center gap-1.5 pt-2">
            {safePage > 1 ? (
              <Button asChild variant="secondary">
                <Link href={pageHref(safePage - 1)}><ChevronLeft aria-hidden className="size-4" />Previous</Link>
              </Button>
            ) : (
              <Button variant="secondary" disabled><ChevronLeft aria-hidden className="size-4" />Previous</Button>
            )}
            {paginationWindow(safePage, totalPages).map((p) => (
              <Link
                key={p}
                href={pageHref(p)}
                aria-current={p === safePage ? "page" : undefined}
                className={cn("inline-flex size-11 items-center justify-center rounded-full text-[15px] font-bold", p === safePage ? "bg-primary text-on-primary" : "text-ink-secondary hover:bg-muted")}
              >
                {p}
              </Link>
            ))}
            {safePage < totalPages ? (
              <Button asChild variant="secondary">
                <Link href={pageHref(safePage + 1)}>Next<ChevronRight aria-hidden className="size-4" /></Link>
              </Button>
            ) : (
              <Button variant="secondary" disabled>Next<ChevronRight aria-hidden className="size-4" /></Button>
            )}
          </nav>
        ) : null}
      </Container>

      {/* Host your own (Figma 125:3219) */}
      <Container className="pb-16 lg:pb-[88px]">
        <div className="flex flex-col items-start gap-6 rounded-[24px] bg-tint-peach p-6 sm:p-8 md:flex-row md:items-center">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <h2 className="text-h3 text-ink">Running something?</h2>
            <p className="max-w-[640px] text-body text-ink-secondary">Set up your organisation and publish your first free event in a few minutes.</p>
          </div>
          <Button asChild variant="primary" size="lg" className="shrink-0">
            <Link href={getStartedHref}>Start organising</Link>
          </Button>
        </div>
      </Container>
    </div>
  );
}
