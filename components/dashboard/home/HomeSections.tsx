import Link from "next/link";
import { ArrowRight, Check, Plus, ScanLine } from "lucide-react";
import { DotFace } from "@/components/brand/DotFace";
import type { DotFaceMood } from "@/components/brand/patterns";
import { CreateEventDialog } from "@/components/event/CreateEventDialog";
import { Button } from "@/components/ui/button";
import { Avatar, Chip, DateBlock, OrgLogo } from "@/components/ui/display";
import type { DashboardHome, HomeActivity } from "@/lib/dashboardHome";
import { formatDateBlock, formatDayLong, formatRelativeDay, formatRelativeTime, formatTime } from "@/lib/format/datetime";
import { accentStyle } from "@/lib/theme/accent";
import { cn } from "@/lib/cn";
import { CopyEventLink } from "./CopyEventLink";
import { DotColumns, DotMeter, meterDots } from "./DotCharts";

/* ---------- Next up ---------- */

export function NextUpCard({ next, now }: { next: NonNullable<DashboardHome["next"]>; now: Date }) {
  const block = formatDateBlock(next.startDateTime, next.timezone);
  const when = formatRelativeDay(next.startDateTime, next.timezone, now).toUpperCase();
  const names = next.recentNames;
  const others = Math.max(0, next.confirmed - names.length);
  return (
    <section
      aria-labelledby="home-next-title"
      style={accentStyle(next.accent)}
      className="yy-accent-scope flex flex-col overflow-hidden rounded-2xl border border-line bg-canvas shadow-raised md:flex-row"
    >
      <div className="yy-cover-placeholder relative flex min-h-[200px] flex-col justify-between gap-6 p-6 md:w-[44%] md:shrink-0 md:p-7">
        <span className="self-start rounded-full bg-white px-3 py-1 text-overline text-[#18181B]">Next up · {when}</span>
        <div className="flex items-end gap-4">
          <DateBlock month={block.month} day={block.day} size="lg" tone="ink" className="border-white/40" />
          <h2 id="home-next-title" className={cn("line-clamp-3 min-w-0 font-display font-extrabold leading-[1.05] tracking-[-0.02em] text-on-accent", next.title.length > 40 ? "text-[24px] sm:text-[26px]" : "text-[30px] sm:text-[34px]")}>
            {next.title}
          </h2>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-5 p-6 md:p-7">
        <p className="text-body-ui text-ink-secondary">
          {formatDayLong(next.startDateTime, next.timezone, now)} · {formatTime(next.startDateTime, next.timezone)}
          {next.location ? ` · ${next.location}` : ""}
        </p>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-label text-ink">
              {next.confirmed} going
              {next.capacityUnits ? (
                <span className="font-normal text-ink-muted">
                  {" "}· {next.capacity ? `${next.capacityUnits.used} of ${next.capacity}` : next.capacityUnits.used} {next.capacityUnits.noun}
                </span>
              ) : next.capacity ? (
                <span className="font-normal text-ink-muted"> of {next.capacity}</span>
              ) : null}
            </p>
            {next.signupsLastDay > 0 ? <Chip tone="success" size="sm">+{next.signupsLastDay} in the last day</Chip> : null}
          </div>
          {next.capacity ? <DotMeter filled={meterDots(next.capacityUnits?.used ?? next.confirmed, next.capacity, 25)} total={25} color={next.accent} dot={11} className="!gap-[5px]" /> : null}
        </div>
        {names.length ? (
          <div className="flex items-center gap-3">
            <span className="flex">
              {names.map((name, index) => (
                <Avatar key={`${name}-${index}`} name={name} size="sm" tone={index % 2 ? "success" : "accent"} className="-ml-1.5 border-2 border-canvas first:ml-0" />
              ))}
            </span>
            <span className="text-caption text-ink-muted">
              {names.slice(0, 2).join(", ")}
              {others > 0 ? ` and ${others} other${others === 1 ? "" : "s"}` : names.length > 2 ? ` and ${names.length - 2} more` : ""}
            </span>
          </div>
        ) : null}
        <div className="mt-auto flex flex-wrap gap-2.5">
          {next.checkInHref ? (
            <Button asChild variant="accent">
              <Link href={next.checkInHref}>
                <ScanLine aria-hidden className="size-[18px]" />
                Open check-in
              </Link>
            </Button>
          ) : null}
          {next.href ? (
            <Button asChild variant="secondary">
              <Link href={next.href}>Manage event</Link>
            </Button>
          ) : null}
          {next.publicPath ? <CopyEventLink path={next.publicPath} title={next.title} /> : null}
        </div>
      </div>
    </section>
  );
}

/* ---------- Event day ---------- */

export function LiveEventPanel({ live, now }: { live: NonNullable<DashboardHome["live"]>; now: Date }) {
  const seats = Math.min(Math.max(live.confirmed, 1), 96);
  const lit = live.confirmed > 0 ? Math.round((Math.min(live.checkedIn, live.confirmed) / live.confirmed) * seats) : 0;
  const toCome = Math.max(0, live.confirmed - live.checkedIn);
  const busiest = Math.max(0, ...live.arrivals.map((bucket) => bucket.count));
  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="home-live-title" className="yy-dark-band flex flex-col gap-8 rounded-2xl bg-[var(--yy-inverse-surface)] p-6 text-ink sm:p-8 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <span className="inline-flex items-center gap-2 self-start rounded-full bg-success-bg px-3 py-1 text-overline text-success-fg">
            <span aria-hidden className="size-2 rounded-full bg-success-solid" />
            {live.started ? `Happening now · started ${formatTime(live.startDateTime, live.timezone)}` : `Today · starts ${formatTime(live.startDateTime, live.timezone)}`}
          </span>
          <h2 id="home-live-title" className="font-display text-[34px] font-extrabold leading-[1.02] tracking-[-0.03em] text-ink sm:text-[44px]">{live.title}</h2>
          <p className="text-body-ui text-ink-secondary">
            {live.location ? `${live.location} · ` : ""}until {formatTime(live.endDateTime, live.timezone)}
          </p>
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-display text-[56px] font-extrabold leading-none text-ink">{live.checkedIn}</span>
            <span className="text-body text-ink-secondary">
              of {live.confirmed} checked in{toCome > 0 ? ` · ${toCome} still to come` : ""}
            </span>
          </p>
          <div className="flex flex-wrap gap-2.5">
            {live.checkInHref ? (
              <Button asChild variant="primary" size="lg">
                <Link href={live.checkInHref}>
                  <ScanLine aria-hidden className="size-5" />
                  Open check-in
                </Link>
              </Button>
            ) : null}
            {live.href ? (
              <Button asChild variant="secondary" size="lg">
                <Link href={live.href}>Manage event</Link>
              </Button>
            ) : null}
          </div>
        </div>
        <div aria-hidden className="grid w-full max-w-[340px] grid-cols-12 gap-[7px] self-center">
          {Array.from({ length: seats }, (_, index) => (
            <span key={index} className={cn("aspect-square rounded-full", index < lit ? "bg-brand-marigold" : "bg-brand-dot-off")} />
          ))}
        </div>
      </section>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {live.onStage.now || live.onStage.next ? (
          <section aria-labelledby="home-stage-title" className="flex flex-col gap-3.5 rounded-xl border border-line bg-canvas p-5">
            <h3 id="home-stage-title" className="text-h4 text-ink">On stage</h3>
            {live.onStage.now ? (
              <div className="flex flex-col gap-1 rounded-lg bg-tint-peach px-4 py-3">
                <span className="text-overline text-ink-muted">Now · {formatTime(live.onStage.now.start, live.timezone)}–{formatTime(live.onStage.now.end, live.timezone)}</span>
                <span className="text-[17px] font-bold text-ink">{live.onStage.now.title}</span>
              </div>
            ) : null}
            {live.onStage.next ? (
              <div className="flex flex-col px-4">
                <span className="text-caption text-ink-muted">Next · {formatTime(live.onStage.next.start, live.timezone)}</span>
                <span className="font-semibold text-ink">{live.onStage.next.title}</span>
              </div>
            ) : null}
            {live.scheduleHref ? (
              <Link href={live.scheduleHref} className="mt-auto self-start text-sm font-semibold text-ink underline-offset-4 hover:underline">
                Live schedule
              </Link>
            ) : null}
          </section>
        ) : null}

        <section aria-labelledby="home-arrivals-title" className="flex flex-col gap-3.5 rounded-xl border border-line bg-canvas p-5">
          <h3 id="home-arrivals-title" className="text-h4 text-ink">Arrivals</h3>
          <div className="flex items-end gap-1">
            {live.arrivals.map((bucket, index) => (
              <span key={bucket.label.toISOString()} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                <DotColumns levels={[busiest ? Math.ceil((bucket.count / busiest) * 6) : 0]} max={6} tone="success" dot={11} />
                {/* Every other label, without AM/PM, so times never collide on narrow cards. */}
                <span className="min-h-[1.4em] whitespace-nowrap text-[11px] text-ink-muted">{index % 2 === 0 ? formatTime(bucket.label, live.timezone).replace(/ (AM|PM)$/, "") : ""}</span>
              </span>
            ))}
          </div>
          <p className="text-caption text-ink-muted">
            {busiest > 0 ? `Check-ins per 15 minutes. Busiest: ${busiest}.` : "No check-ins yet. Arrivals show here in 15-minute steps."}
          </p>
        </section>

        <section aria-labelledby="home-door-title" className="flex flex-col gap-1 rounded-xl border border-line bg-canvas p-5">
          <h3 id="home-door-title" className="mb-1.5 text-h4 text-ink">At the door</h3>
          {live.door.length ? (
            <ul className="flex flex-col">
              {live.door.map((entry) => (
                <li key={entry.key} className="flex items-center gap-3 border-b border-line py-2 last:border-b-0">
                  <DotFace mood="wink" size={24} />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink"><strong>{entry.who}</strong> checked in</span>
                  <span className="shrink-0 text-caption text-ink-muted">{formatRelativeTime(entry.at, live.timezone, now)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-ui text-ink-muted">Nobody checked in yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}

/* ---------- Activity ---------- */

const ACTIVITY: Record<HomeActivity["kind"], { mood: DotFaceMood; text: string }> = {
  registered: { mood: "cheering", text: "registered" },
  waitlisted: { mood: "waiting", text: "joined the waitlist" },
  pending: { mood: "thinking", text: "asked to join" },
  checkedIn: { mood: "wink", text: "checked in" },
  feedback: { mood: "love", text: "sent feedback" },
};

export function ActivityFeed({ activity, now }: { activity: HomeActivity[]; now: Date }) {
  return (
    <section aria-labelledby="home-activity-title" className="flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-canvas p-5">
      <h2 id="home-activity-title" className="text-h4 text-ink">Activity</h2>
      {activity.length === 0 ? (
        <p className="py-2 text-body-ui text-ink-muted">Registrations, check-ins and feedback will show up here.</p>
      ) : (
        <ul className="flex flex-col">
          {activity.map((item) => (
            <li key={item.key} className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0">
              <DotFace mood={ACTIVITY[item.kind].mood} size={32} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm text-ink">
                  <strong>{item.who}</strong> {ACTIVITY[item.kind].text}
                </span>
                <span className="truncate text-caption text-ink-muted">{item.eventTitle}</span>
              </span>
              <span className="shrink-0 text-caption text-ink-muted">{formatRelativeTime(item.at, item.timezone, now)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------- Stats ---------- */

export function StatRow({ stats }: { stats: DashboardHome["stats"] }) {
  return (
    <section aria-label="At a glance" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="flex min-w-0 flex-col gap-2.5 rounded-lg border border-line bg-canvas px-5 py-4">
          <span className="text-sm text-ink-muted">{stat.label}</span>
          <span className="flex items-end justify-between gap-3">
            <span className="font-display text-[34px] font-extrabold leading-none text-ink">{stat.value}</span>
            <DotColumns levels={stat.levels} tone={stat.tone} />
          </span>
          <span className="truncate text-caption text-ink-muted">{stat.hint}</span>
        </div>
      ))}
    </section>
  );
}

/* ---------- Organisations ---------- */

export function OrganisationCards({ organisations }: { organisations: DashboardHome["organisations"] }) {
  return (
    <section aria-labelledby="home-orgs-title" className="flex flex-col gap-3">
      <h2 id="home-orgs-title" className="text-h4 text-ink">Organisations</h2>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {organisations.map((organisation) => (
          <li key={organisation.id}>
            <Link href={`/dashboard/${organisation.slug}`} className="group flex h-full flex-col overflow-hidden rounded-xl border border-line bg-canvas transition-colors hover:bg-subtle">
              <span aria-hidden className="yy-dot-strip h-14" />
              <span className="flex flex-1 flex-col gap-2.5 px-5 pb-5">
                <OrgLogo name={organisation.name} src={organisation.logoUrl} size="lg" className="-mt-7 border-[3px] border-canvas" />
                <span className="truncate text-[17px] font-bold text-ink">{organisation.name}</span>
                <span className="flex flex-wrap gap-1.5">
                  <Chip size="sm">{organisation.upcoming} upcoming</Chip>
                  <Chip size="sm">{organisation.members} {organisation.members === 1 ? "member" : "members"}</Chip>
                  <Chip size="sm">{organisation.role}</Chip>
                </span>
                <span className="mt-auto inline-flex items-center gap-1.5 pt-1 text-sm font-semibold text-ink-secondary group-hover:text-ink">
                  Open workspace
                  <ArrowRight aria-hidden className="size-4" />
                </span>
              </span>
            </Link>
          </li>
        ))}
        <li>
          <Link
            href="/dashboard/org/new"
            className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-line-strong text-sm font-semibold text-ink-secondary transition-colors hover:bg-subtle hover:text-ink"
          >
            <Plus aria-hidden className="size-5" />
            New organisation
          </Link>
        </li>
      </ul>
    </section>
  );
}

/* ---------- First run ---------- */

/** Setup checklist. `compact` drops the welcome banner when the page already greets the person. */
export function FirstRunSetup({ setup, name, compact = false }: { setup: NonNullable<DashboardHome["setup"]>; name: string; compact?: boolean }) {
  const slug = setup.firstAdminSlug;
  const steps = [
    { title: "Create your organisation", body: "Your community’s home on Yuyu. Events, members and settings live here.", done: setup.hasOrganisation, action: <Button asChild variant="primary"><Link href="/dashboard/org/new">Create organisation</Link></Button> },
    { title: "Add your logo", body: "It appears on your organisation page and at the top of every event page.", done: setup.hasLogo, action: slug ? <Button asChild variant="secondary"><Link href={`/dashboard/${slug}/settings`}>Add logo</Link></Button> : null },
    { title: "Create your first event", body: "A date, a place and a capacity. You can add a programme and speakers later.", done: setup.hasEvent, action: slug ? <CreateEventDialog organisationSlug={slug} /> : null },
    { title: "Publish and share the link", body: "People register in seconds, as guests or with an account.", done: setup.hasPublished, action: slug ? <Button asChild variant="secondary"><Link href={`/dashboard/${slug}`}>Go to events</Link></Button> : null },
  ];
  const nextIndex = steps.findIndex((step) => !step.done);
  const doneCount = steps.filter((step) => step.done).length;
  return (
    <section aria-labelledby={compact ? "home-setup-steps" : "home-setup-title"} className="flex flex-col gap-6">
      {compact ? null : (
      <div className="flex flex-col items-start gap-6 rounded-2xl bg-tint-peach p-6 sm:flex-row sm:items-center sm:p-8">
        <DotFace mood="happy" size={104} />
        <div className="flex flex-col gap-2">
          <h2 id="home-setup-title" className="font-display text-[34px] font-extrabold leading-[1.05] tracking-[-0.03em] text-ink sm:text-[40px]">Welcome to Yuyu, {name}</h2>
          <p className="max-w-[640px] text-body-l text-ink-secondary">Four small steps and your first event is ready to share.</p>
        </div>
      </div>
      )}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 id="home-setup-steps" className="text-h4 text-ink">Get set up</h3>
          <span className="inline-flex items-center gap-2 text-sm text-ink-muted">
            <span aria-hidden className="flex gap-1">
              {steps.map((step, index) => (
                <span key={index} className={cn("size-2.5 rounded-full", step.done ? "bg-brand-marigold" : "bg-brand-dot-off")} />
              ))}
            </span>
            {doneCount} of {steps.length} done
          </span>
        </div>
        <ol className="flex flex-col gap-2.5">
          {steps.map((step, index) => {
            const isNext = index === nextIndex;
            return (
              <li
                key={step.title}
                className={cn(
                  "flex flex-col gap-3 rounded-lg px-5 py-4 sm:flex-row sm:items-center sm:gap-4",
                  step.done ? "border border-line bg-subtle" : isNext ? "border-2 border-primary bg-canvas" : "border border-line bg-canvas",
                )}
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                    step.done ? "bg-success-bg text-success-fg" : isNext ? "bg-primary text-on-primary" : "bg-muted text-ink-secondary",
                  )}
                >
                  {step.done ? <Check aria-label="Done" className="size-4" /> : index + 1}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cn("text-base font-bold", step.done ? "text-ink-muted line-through" : "text-ink")}>{step.title}</span>
                  <span className="text-sm text-ink-muted">{step.body}</span>
                </span>
                {!step.done && isNext && step.action ? <span className="shrink-0">{step.action}</span> : null}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
