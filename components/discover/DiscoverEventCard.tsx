import Link from "next/link";
import { accentStyle, DEFAULT_EVENT_ACCENT } from "@/lib/theme/accent";
import { formatDateBlock, formatDayShort, formatTime } from "@/lib/format/datetime";

export type DiscoverEvent = {
  href: string;
  title: string;
  startDateTime: Date;
  timezone: string;
  location?: string | null;
  isOnline?: boolean;
  coverImageUrl?: string | null;
  accentColor?: string | null;
  /** Ink for series; Ember for events without an accent. */
  fallbackAccent?: string;
  organisationName: string;
  /** First organiser tag (events) or recurrence label (series), shown as the accent chip. */
  label?: string | null;
  /** Lower-case recurrence text replaces the place in the meta line for series dates. */
  recurrenceText?: string | null;
  /** Only when the organiser shows registration counts publicly. */
  goingCount?: number | null;
};

/** Discover grid card (Figma "Landing/Event card", 122:1543), filled from real event data. */
export function DiscoverEventCard({ event }: { event: DiscoverEvent }) {
  const block = formatDateBlock(event.startDateTime, event.timezone);
  const place = event.isOnline ? "Online" : event.location?.trim() || null;
  const meta = [formatDayShort(event.startDateTime, event.timezone), formatTime(event.startDateTime, event.timezone), event.recurrenceText ? event.recurrenceText.toLowerCase() : place]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      href={event.href}
      style={accentStyle(event.accentColor, event.fallbackAccent ?? DEFAULT_EVENT_ACCENT)}
      className="yy-accent-scope group relative flex h-full min-w-0 flex-col overflow-hidden rounded-[20px] border border-line bg-canvas transition-shadow duration-200 hover:shadow-float"
    >
      <div className="relative h-[150px] shrink-0 overflow-hidden bg-accent">
        {event.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- covers are served by the app's own upload route
          <img src={event.coverImageUrl} alt="" className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- static SVG design asset
          <img src="/landing/discover-card-dots.svg" alt="" width={373} height={150} className="absolute left-0 top-0 h-[150px] w-[373px] max-w-none" />
        )}
      </div>
      <span aria-hidden className="absolute left-[19px] top-[119px] flex h-[60px] w-14 flex-col items-center overflow-hidden rounded-md border border-line bg-canvas">
        <span className="w-full bg-accent py-[3px] text-center text-[11px] font-bold uppercase leading-[1.3] tracking-[0.08em] text-on-accent">{block.month}</span>
        <span className="font-display text-[22px] font-extrabold leading-[1.35] text-ink">{block.day}</span>
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 px-5 pb-5 pt-10">
        <div className="flex flex-wrap gap-1.5">
          {event.label ? <span className="min-w-0 max-w-full rounded-full bg-accent-soft px-[11px] [overflow-wrap:anywhere] py-1 text-[13px] font-bold leading-[1.4] text-accent-text">{event.label}</span> : null}
          <span className="rounded-full bg-muted px-[11px] py-1 text-[13px] font-bold leading-[1.4] text-ink-secondary">{event.isOnline ? "Online" : "In person"}</span>
        </div>
        <h3 className="break-words [overflow-wrap:anywhere] font-display text-[22px] font-extrabold leading-tight tracking-[-0.01em] text-ink">{event.title}</h3>
        <p className="text-body-ui text-ink-muted [overflow-wrap:anywhere]">{meta}</p>
        <div className="mt-auto flex items-start justify-between gap-3 border-t border-line pt-2.5 text-caption text-ink-secondary">
          <span className="min-w-0 truncate">{event.organisationName}</span>
          {event.goingCount != null ? <span className="shrink-0">{event.goingCount} going</span> : null}
        </div>
      </div>
    </Link>
  );
}
