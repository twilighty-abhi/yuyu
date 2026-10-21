/**
 * Pure helpers for the event Overview tab: the readiness checklist and the
 * 14-day sign-up trend. Free of Prisma and React so they can be unit-tested;
 * lib/eventDashboard/overview.ts and OverviewPanel feed them real data only.
 */
import { dailyCounts, relativeDayPhrase, toDotLevels, weekOverWeek } from "@/lib/dashboardHomeMetrics";
import { formatRelativeDay } from "@/lib/format/datetime";
import type { EventCapabilities } from "@/lib/eventDashboard/capabilities";

export type ReadinessAction =
  | { kind: "tab"; label: string; tab: string; sub?: string }
  | { kind: "publish"; label: string };

export type ReadinessItem = { key: string; label: string; done: boolean; action?: ReadinessAction };

export type ReadinessInput = {
  published: boolean;
  hasCoverImage: boolean;
  hasAccent: boolean;
  isOnline: boolean;
  sessionCount: number;
  registrationFieldCount: number;
  stationPinSet: boolean;
  approvalRequired: boolean;
  pendingApprovals: number;
  emailsSent: number;
  permissions: Pick<
    EventCapabilities,
    "canPublish" | "canEditEventDetails" | "canManageSchedule" | "canEditRegistrationForm" | "canManageCheckInStation" | "canManageRegistrations" | "canSendEmails"
  >;
};

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The checklist, limited to what the viewer can act on. Each item is either
 * done or carries the action that fixes it (a tab to open, or publishing).
 */
export function readinessItems(input: ReadinessInput): ReadinessItem[] {
  const { permissions: can } = input;
  const items: ReadinessItem[] = [];

  if (can.canPublish) {
    items.push(
      input.published
        ? { key: "published", label: "Published", done: true }
        : { key: "published", label: "Not published yet", done: false, action: { kind: "publish", label: "Publish" } },
    );
  }

  if (can.canEditEventDetails) {
    const look = input.hasCoverImage ? "Cover image" : input.hasAccent ? "Page accent colour" : null;
    items.push(
      look
        ? { key: "look", label: look, done: true }
        : { key: "look", label: "No cover image", done: false, action: { kind: "tab", label: "Add one", tab: "page", sub: "details" } },
    );
  }

  if (can.canManageSchedule) {
    items.push(
      input.sessionCount > 0
        ? { key: "programme", label: `Programme · ${plural(input.sessionCount, "session")}`, done: true }
        : { key: "programme", label: "No programme yet", done: false, action: { kind: "tab", label: "Add sessions", tab: "page", sub: "page" } },
    );
  }

  if (can.canEditRegistrationForm) {
    items.push(
      input.registrationFieldCount > 0
        ? { key: "form", label: `Registration form · ${plural(input.registrationFieldCount, "question")}`, done: true }
        : // Name and email are always collected; extra questions are optional, not a to-do.
          { key: "form", label: "Registration form · name and email", done: true },
    );
  }

  // The venue station PIN is an organisation-admin setting and only matters in person.
  if (can.canManageCheckInStation && !input.isOnline) {
    items.push(
      input.stationPinSet
        ? { key: "pin", label: "Check-in station PIN", done: true }
        : { key: "pin", label: "No check-in station PIN", done: false, action: { kind: "tab", label: "Set up", tab: "check-in" } },
    );
  }

  if (can.canManageRegistrations) {
    if (input.pendingApprovals > 0) {
      items.push({
        key: "approvals",
        label: `${input.pendingApprovals} waiting for approval`,
        done: false,
        action: { kind: "tab", label: "Review", tab: "guests", sub: "people" },
      });
    } else if (input.approvalRequired) {
      items.push({ key: "approvals", label: "No one waiting for approval", done: true });
    }
  }

  if (can.canSendEmails) {
    items.push(
      input.emailsSent > 0
        ? { key: "email", label: `${plural(input.emailsSent, "email")} sent to guests`, done: true }
        : { key: "email", label: "No email sent yet", done: false, action: { kind: "tab", label: "Write one", tab: "emails" } },
    );
  }

  return items;
}

export type EventPhase = "upcoming" | "live" | "ended";

export function eventPhase(start: Date, end: Date, now: Date): EventPhase {
  if (end <= now) return "ended";
  if (start <= now) return "live";
  return "upcoming";
}

/** Heading and one-line summary for the readiness card, from the checklist and the event's dates. */
export function readinessHeading(input: { items: ReadinessItem[]; start: Date; end: Date; now: Date; timeZone: string }): { title: string; summary: string; complete: boolean } {
  const { items, start, end, now, timeZone } = input;
  const done = items.filter((item) => item.done).length;
  const left = items.length - done;
  const complete = left === 0;
  const progress = `${done} of ${items.length} done.`;

  if (eventPhase(start, end, now) === "live") {
    return { title: "Happening now", summary: complete ? `${progress} Everything is in place.` : `${progress} ${plural(left, "thing")} still open.`, complete };
  }

  const day = formatRelativeDay(start, timeZone, now);
  const soon = day === "Today" || day === "Tomorrow";
  const title = complete ? (soon ? `Ready for ${day.toLowerCase()}` : "Ready") : soon ? `Almost ready for ${day.toLowerCase()}` : "Almost ready";
  const when = relativeDayPhrase(start, timeZone, now);
  const summary = complete ? `${progress} Starts ${when}.` : `${progress} ${plural(left, "thing")} left · starts ${when}.`;
  return { title, summary, complete };
}

export type SignupTrend = { counts: number[]; levels: number[]; lastDay: number; total: number; change: string | null };

/** Sign-ups per rolling day over the last 14 days, scaled to dots, with a week-over-week hint. */
export function signupTrend(dates: Date[], now: Date, maxDots = 6): SignupTrend {
  const counts = dailyCounts(dates, now, 14);
  const previous = counts.slice(0, 7).reduce((sum, count) => sum + count, 0);
  const current = counts.slice(7).reduce((sum, count) => sum + count, 0);
  return {
    counts,
    levels: toDotLevels(counts, maxDots),
    lastDay: counts[13] ?? 0,
    total: previous + current,
    change: weekOverWeek(current, previous, { previous: "the week before", current: "this week" }),
  };
}
