import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Chip, DateBlock } from "@/components/ui/display";
import { DotMeter, meterDots } from "@/components/dashboard/home/DotCharts";
import { formatDateBlock, formatRelativeDay, formatTimeRange, formatDayShort } from "@/lib/format/datetime";
import { accentStyle, getAccentTokens } from "@/lib/theme/accent";
import { cn } from "@/lib/cn";

const privacyLabels: Record<string, string> = { PUBLIC: "Public", HIDDEN_LINK: "Hidden link", APPROVAL_REQUIRED: "Approval required", INVITE_ONLY: "Invite only" };

function statusChip(status: string) {
  if (status === "PUBLISHED") return { label: "Published", tone: "success" as const };
  if (status === "DRAFT") return { label: "Draft", tone: "warning" as const };
  if (status === "HIDDEN") return { label: "Hidden", tone: "neutral" as const };
  return { label: status === "CANCELLED" ? "Cancelled" : status, tone: "danger" as const };
}

export type EventHeaderStat = { label: string; value: ReactNode; detail?: string; meter?: { filled: number; total: number; tone: "accent" | "success" } };

/**
 * The header every event-management screen starts with: back link, then a
 * card with the event's accent band and date block, status and audience
 * chips, title, when/where, actions and an optional strip of live numbers.
 */
export function EventManageHeader({
  back,
  event,
  actions,
  stats,
}: {
  back: { href: string; label: string };
  event: { title: string; status: string; privacyType: string; startDateTime: Date; endDateTime?: Date; timezone: string; location?: string; isOnline?: boolean; accentColor?: string | null };
  actions?: ReactNode;
  stats?: EventHeaderStat[];
}) {
  const dateBlock = formatDateBlock(event.startDateTime, event.timezone);
  const chip = statusChip(event.status);
  const isDraft = event.status === "DRAFT";
  const relative = formatRelativeDay(event.startDateTime, event.timezone);
  const when = event.endDateTime
    ? `${formatDayShort(event.startDateTime, event.timezone)} · ${formatTimeRange(event.startDateTime, event.endDateTime, event.timezone)}`
    : formatDayShort(event.startDateTime, event.timezone);
  const where = event.isOnline ? "Online" : event.location;
  const accent = getAccentTokens(event.accentColor, "light")["--yy-accent"];
  return (
    <div className="flex flex-col gap-4">
      <Link href={back.href} className="inline-flex min-h-9 items-center gap-1.5 self-start text-sm font-semibold text-ink-secondary hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" />
        {back.label}
      </Link>
      <header style={accentStyle(event.accentColor)} className="yy-accent-scope overflow-hidden rounded-2xl border border-line bg-canvas">
        <div className="flex flex-col sm:flex-row">
          <div aria-hidden className={cn("flex h-24 shrink-0 items-center justify-center sm:h-auto sm:w-32", isDraft ? "yy-dot-strip" : "yy-cover-placeholder")}>
            <DateBlock month={dateBlock.month} day={dateBlock.day} size="lg" tone={isDraft ? "draft" : "ink"} className="border-white/50" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-4 p-5 lg:flex-row lg:items-center sm:px-6">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="flex flex-wrap gap-1.5">
                <Chip size="sm" tone={chip.tone}>{chip.label}</Chip>
                <Chip size="sm">{privacyLabels[event.privacyType] ?? event.privacyType}</Chip>
                <Chip size="sm" tone="accent">{relative}</Chip>
              </span>
              <h1 className="break-words font-display text-[28px] font-extrabold leading-[1.1] tracking-[-0.02em] text-ink sm:text-[32px]">{event.title}</h1>
              <p className="text-body-ui text-ink-secondary">
                {when}
                {where ? ` · ${where}` : ""}
              </p>
            </div>
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          </div>
        </div>
        {stats?.length ? (
          <dl className="grid grid-cols-2 border-t border-line sm:grid-cols-4">
            {stats.map((stat, index) => (
              <div key={stat.label} className={cn("flex min-w-0 flex-col gap-1 px-5 py-3", index % 2 === 1 && "border-l border-line", index >= 2 && "border-t border-line sm:border-t-0", index === 2 && "sm:border-l")}>
                <dt className="text-caption text-ink-muted">{stat.label}</dt>
                <dd className="flex flex-wrap items-center gap-2.5">
                  <span className="font-display text-[22px] font-extrabold leading-tight text-ink">{stat.value}</span>
                  {stat.meter ? (
                    <DotMeter
                      filled={meterDots(stat.meter.filled, stat.meter.total, 10)}
                      total={10}
                      dot={6}
                      color={stat.meter.tone === "success" ? "var(--yy-success-solid)" : accent}
                    />
                  ) : null}
                  {stat.detail ? <span className="w-full text-caption text-ink-muted">{stat.detail}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </header>
    </div>
  );
}
