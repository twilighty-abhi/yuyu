import type { ReactNode } from "react";
import { ArrowRight, Check, Code2 } from "lucide-react";
import type { EventPrivacyType, EventStatus } from "@prisma/client";
import { DotFace } from "@/components/brand/DotFace";
import { DotColumns } from "@/components/dashboard/home/DotCharts";
import { CopyEventLink } from "@/components/dashboard/home/CopyEventLink";
import { PublishEventButton } from "@/components/event/PublishEventButton";
import { Avatar, Chip } from "@/components/ui/display";
import { formatDayLong, formatTimeRange } from "@/lib/format/datetime";
import { cn } from "@/lib/cn";
import type { EventTeam } from "@/lib/eventDashboard/overview";
import { teamUnitNoun } from "@/lib/teamCapacityDisplay";
import { OpenTabButton } from "../EventDashboardTabs";
import type { ReadinessItem, SignupTrend } from "./readiness";

const card = "flex flex-col gap-3 rounded-xl border border-line bg-canvas p-5";
const textLink = "inline-flex min-h-9 items-center gap-1 self-start text-sm font-semibold text-ink underline-offset-4 hover:underline";

/* ---------- Readiness ---------- */

export function ReadinessCard({ title, summary, complete, items, organisationSlug, eventSlug }: { title: string; summary: string; complete: boolean; items: ReadinessItem[]; organisationSlug: string; eventSlug: string }) {
  return (
    <section aria-labelledby="overview-ready-title" className="flex flex-col gap-4 rounded-2xl bg-tint-peach p-5 sm:p-6 lg:flex-row lg:items-center">
      <div className="flex min-w-0 items-center gap-4 lg:w-[300px] lg:shrink-0">
        <DotFace mood={complete ? "done" : "happy"} size={56} className="shrink-0" />
        <div className="min-w-0">
          <h2 id="overview-ready-title" className="font-display text-[22px] font-extrabold leading-tight text-ink">
            {title}
          </h2>
          <p className="mt-0.5 text-body-ui text-ink-secondary">{summary}</p>
        </div>
      </div>
      <ul className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.key} className="flex min-h-11 items-center gap-2.5 rounded-lg bg-canvas px-3 py-2 text-sm">
            <span aria-hidden className={cn("flex size-5 shrink-0 items-center justify-center rounded-full", item.done ? "bg-success-bg text-success-fg" : "bg-warning-bg text-warning-fg")}>
              {item.done ? <Check className="size-3" strokeWidth={3} /> : <span className="text-xs font-bold leading-none">!</span>}
            </span>
            <span className={cn("min-w-0 flex-1", item.done ? "text-ink-muted" : "font-medium text-ink")}>
              <span className="sr-only">{item.done ? "Done: " : "To do: "}</span>
              {item.label}
            </span>
            {item.action?.kind === "publish" ? <PublishEventButton organisationSlug={organisationSlug} eventSlug={eventSlug} /> : null}
            {item.action?.kind === "tab" ? (
              <OpenTabButton tab={item.action.tab} sub={item.action.sub} className="inline-flex min-h-9 shrink-0 items-center rounded-full px-2 text-[13px] font-bold text-ink underline-offset-4 hover:underline">
                {item.action.label}
              </OpenTabButton>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- Sign-ups ---------- */

export function SignupsCard({ trend }: { trend: SignupTrend }) {
  const lastDay = trend.lastDay === 1 ? "1 in the last day" : `${trend.lastDay} in the last day`;
  return (
    <section aria-labelledby="overview-signups-title" className={card}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="overview-signups-title" className="text-h4 text-ink">
            Sign-ups
          </h2>
          <p className="text-caption text-ink-muted">
            Last 14 days · {trend.total} in total · {lastDay}
          </p>
        </div>
        {trend.change ? (
          <Chip size="sm" tone={trend.change.startsWith("-") ? "neutral" : "success"}>
            {trend.change}
          </Chip>
        ) : null}
      </div>
      {trend.total > 0 ? (
        <>
          <DotColumns levels={trend.levels} max={6} tone="marigold" dot={12} className="mt-2 w-full justify-between" />
          <p className="sr-only">Sign-ups per day, oldest first: {trend.counts.join(", ")}.</p>
          <div aria-hidden className="flex justify-between text-[11px] text-ink-muted">
            <span>14 days ago</span>
            <span>Today</span>
          </div>
        </>
      ) : (
        <p className="text-body-ui text-ink-muted">No one has signed up in the last two weeks.</p>
      )}
    </section>
  );
}

/* ---------- Share ---------- */

export function ShareCard({ url, path, title, published, canEmbed, shortLink }: { url: string; path: string; title: string; published: boolean; canEmbed: boolean; shortLink?: ReactNode }) {
  return (
    <section aria-labelledby="overview-share-title" className={card}>
      <h2 id="overview-share-title" className="text-h4 text-ink">
        Share
      </h2>
      <p className="truncate rounded-lg bg-subtle px-3 py-2.5 font-mono text-[13px] text-ink" title={url}>
        {url.replace(/^https?:\/\//, "")}
      </p>
      {published ? null : <p className="text-caption text-ink-muted">Guests can open this link once the event is published.</p>}
      <div className="flex flex-wrap gap-2">
        {published ? <CopyEventLink path={path} title={title} /> : null}
        {canEmbed ? (
          <OpenTabButton tab="settings" className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line-strong bg-canvas px-3.5 text-sm font-semibold text-ink hover:bg-subtle">
            <Code2 aria-hidden className="size-4" />
            Embed on a website
          </OpenTabButton>
        ) : null}
      </div>
      {shortLink ? <div className="border-t border-line pt-3">{shortLink}</div> : null}
    </section>
  );
}

/* ---------- At a glance ---------- */

const PRIVACY: Record<EventPrivacyType, string> = {
  PUBLIC: "Anyone (public)",
  HIDDEN_LINK: "Anyone with the link",
  APPROVAL_REQUIRED: "Approval required",
  INVITE_ONLY: "Invite only",
};

const STATUS: Record<EventStatus, string> = { DRAFT: "Draft", PUBLISHED: "Published", HIDDEN: "Hidden", CANCELLED: "Cancelled" };

export function GlanceCard({
  event,
  now,
  canEditDetails,
}: {
  event: { startDateTime: Date; endDateTime: Date; timezone: string; isOnline: boolean; location: string; privacyType: EventPrivacyType; capacity: number | null; status: EventStatus; registrationMode?: string; soloPolicy?: string };
  now: Date;
  canEditDetails: boolean;
}) {
  const rows: Array<{ label: string; value: ReactNode }> = [
    {
      label: "When",
      value: (
        <>
          {formatDayLong(event.startDateTime, event.timezone, now)}
          <span className="block text-ink-muted">{formatTimeRange(event.startDateTime, event.endDateTime, event.timezone)}</span>
        </>
      ),
    },
    { label: "Where", value: event.isOnline ? "Online" : event.location.trim() || "Location to be confirmed" },
    { label: "Who can join", value: PRIVACY[event.privacyType] },
    {
      label: "Capacity",
      value:
        event.capacity == null
          ? "No limit"
          : event.registrationMode === "TEAM"
            ? `${event.capacity} ${teamUnitNoun(event.soloPolicy ?? "SOLO_ALLOWED", event.capacity)}`
            : `${event.capacity} places`,
    },
    ...(event.status !== "PUBLISHED" ? [{ label: "Status", value: STATUS[event.status] }] : []),
  ];
  return (
    <section aria-labelledby="overview-glance-title" className={card}>
      <h2 id="overview-glance-title" className="text-h4 text-ink">
        At a glance
      </h2>
      <dl className="flex flex-col gap-2.5">
        {rows.map((row) => (
          <div key={row.label} className="flex gap-3 text-sm">
            <dt className="w-24 shrink-0 pt-0.5 text-overline text-ink-muted">{row.label}</dt>
            <dd className="min-w-0 break-words text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>
      {canEditDetails ? (
        <OpenTabButton tab="page" sub="details" className={textLink}>
          Edit details <ArrowRight aria-hidden className="size-4" />
        </OpenTabButton>
      ) : null}
    </section>
  );
}

/* ---------- Team ---------- */

function count(value: number, one: string, many: string) {
  return `${value} ${value === 1 ? one : many}`;
}

function nameList(names: string[], shown = 3) {
  if (names.length <= shown) return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");
  return `${names.slice(0, shown).join(", ")} and ${names.length - shown} more`;
}

export function TeamCard({ team }: { team: EventTeam }) {
  const people = [...team.admins.map((name) => ({ name, admin: true })), ...team.coOrganisers.map((name) => ({ name, admin: false }))];
  const shown = people.slice(0, 6);
  return (
    <section aria-labelledby="overview-team-title" className={card}>
      <h2 id="overview-team-title" className="text-h4 text-ink">
        Running this event
      </h2>
      {shown.length ? (
        <span className="flex">
          {shown.map((person, index) => (
            <Avatar key={`${person.name}-${index}`} name={person.name} size="sm" tone={person.admin ? (index === 0 ? "ink" : "accent") : "neutral"} className="-ml-1.5 border-2 border-canvas first:ml-0" />
          ))}
          {people.length > shown.length ? <span className="-ml-1.5 inline-flex size-8 items-center justify-center rounded-full border-2 border-canvas bg-muted text-xs font-bold text-ink-secondary">+{people.length - shown.length}</span> : null}
        </span>
      ) : null}
      <p className="text-sm text-ink-secondary">
        {count(team.admins.length, "organisation admin", "organisation admins")}
        {team.coOrganisers.length ? ` and ${count(team.coOrganisers.length, "co-organiser", "co-organisers")}` : ""}.
      </p>
      {people.length ? <p className="text-caption text-ink-muted">{nameList(people.map((person) => person.name))}</p> : null}
      <OpenTabButton tab="settings" className={textLink}>
        Manage co-organisers <ArrowRight aria-hidden className="size-4" />
      </OpenTabButton>
    </section>
  );
}
