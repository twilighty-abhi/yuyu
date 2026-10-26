/**
 * The single date/time formatter for the UI (docs/DESIGN.md §6.1).
 * Always pass the event's timezone; never show seconds or US-style dates.
 */

import { safeTimeZone } from "@/lib/timeZone";

type DateInput = Date | string | number;

const LOCALE = "en-GB";

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

function parts(value: DateInput, timeZone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: safeTimeZone(timeZone), ...options }).formatToParts(toDate(value));
}

function pick(list: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return list.find((part) => part.type === type)?.value ?? "";
}

/** `{ month: "OCT", day: "14" }` for the date block. */
export function formatDateBlock(value: DateInput, timeZone: string) {
  const list = parts(value, timeZone, { month: "short", day: "numeric" });
  return { month: pick(list, "month").toUpperCase(), day: pick(list, "day") };
}

/** "Wednesday, 14 October" (adds the year when it differs from `reference`). */
export function formatDayLong(value: DateInput, timeZone: string, reference: DateInput = new Date()) {
  const date = toDate(value);
  const sameYear = pick(parts(date, timeZone, { year: "numeric" }), "year") === pick(parts(reference, timeZone, { year: "numeric" }), "year");
  const list = parts(date, timeZone, { weekday: "long", day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }) });
  const base = `${pick(list, "weekday")}, ${pick(list, "day")} ${pick(list, "month")}`;
  return sameYear ? base : `${base} ${pick(list, "year")}`;
}

/** "Wed 14 Oct" (adds the year when it differs from `reference`). */
export function formatDayShort(value: DateInput, timeZone: string, reference: DateInput = new Date()) {
  const date = toDate(value);
  const sameYear = pick(parts(date, timeZone, { year: "numeric" }), "year") === pick(parts(reference, timeZone, { year: "numeric" }), "year");
  const list = parts(date, timeZone, { weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
  const base = `${pick(list, "weekday")} ${pick(list, "day")} ${pick(list, "month")}`;
  return sameYear ? base : `${base} ${pick(list, "year")}`;
}

/** "13 Oct 2026" */
export function formatDate(value: DateInput, timeZone: string) {
  const list = parts(value, timeZone, { day: "numeric", month: "short", year: "numeric" });
  return `${pick(list, "day")} ${pick(list, "month")} ${pick(list, "year")}`;
}

/** "9:30 AM", "12:05 AM" */
export function formatTime(value: DateInput, timeZone: string) {
  // `hourCycle: "h12"`, not `hour12: true`: with en-GB, some ICU builds (Node
  // 20's) resolve `hour12` to the h11 cycle and print "0:05 AM" just after
  // midnight while the browser prints "12:05 AM", a hydration mismatch.
  const list = parts(value, timeZone, { hour: "numeric", minute: "2-digit", hourCycle: "h12" });
  return `${pick(list, "hour")}:${pick(list, "minute")} ${pick(list, "dayPeriod").toUpperCase()}`;
}

/** "IST", "GMT+5:30", "BST" — the abbreviation for the event's zone at that instant. */
export function formatTimeZoneName(value: DateInput, timeZone: string) {
  const zone = safeTimeZone(timeZone);
  const short = pick(new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(toDate(value)), "timeZoneName");
  if (zone === "Asia/Kolkata" || zone === "Asia/Calcutta") return "IST";
  return short;
}

/**
 * "9:30 AM – 5:30 PM IST" on the same day; otherwise
 * "Wed 14 Oct, 9:30 AM – Thu 15 Oct, 5:30 PM IST".
 */
export function formatTimeRange(start: DateInput, end: DateInput, timeZone: string, options: { withZone?: boolean } = {}) {
  const { withZone = true } = options;
  const sameDay = formatDate(start, timeZone) === formatDate(end, timeZone);
  const zone = withZone ? ` ${formatTimeZoneName(start, timeZone)}` : "";
  if (sameDay) return `${formatTime(start, timeZone)} – ${formatTime(end, timeZone)}${zone}`;
  return `${formatDayShort(start, timeZone)}, ${formatTime(start, timeZone)} – ${formatDayShort(end, timeZone)}, ${formatTime(end, timeZone)}${zone}`;
}

/** "Wed 14 Oct · 9:30 AM" */
export function formatDayTime(value: DateInput, timeZone: string) {
  return `${formatDayShort(value, timeZone)} · ${formatTime(value, timeZone)}`;
}

function dayIndex(value: DateInput, timeZone: string) {
  const list = parts(value, timeZone, { year: "numeric", month: "2-digit", day: "2-digit" });
  return Date.UTC(Number(pick(list, "year")), Number(pick(list, "month")) - 1, Number(pick(list, "day"))) / 86_400_000;
}

/** "Today" / "Tomorrow" / "Yesterday" / "In 9 days" / "3 days ago" / "Wed 14 Oct". */
export function formatRelativeDay(value: DateInput, timeZone: string, now: DateInput = new Date()) {
  const diff = dayIndex(value, timeZone) - dayIndex(now, timeZone);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 14) return `In ${diff} days`;
  if (diff < -1 && diff > -7) return `${-diff} days ago`;
  return formatDayShort(value, timeZone, now);
}

/** "Just now" / "2 min ago" / "3 hours ago" / "Yesterday" / "13 Oct 2026". */
export function formatRelativeTime(value: DateInput, timeZone: string, now: DateInput = new Date()) {
  const seconds = Math.round((toDate(now).getTime() - toDate(value).getTime()) / 1000);
  if (seconds >= 0 && seconds < 60) return "Just now";
  if (seconds >= 60 && seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds >= 3600 && seconds < 86_400) {
    const hours = Math.floor(seconds / 3600);
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  const days = dayIndex(now, timeZone) - dayIndex(value, timeZone);
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return `${days} days ago`;
  return formatDate(value, timeZone);
}

/** Viewer-local helpers for timestamps that have no event context (audit logs, sessions). */
export function viewerTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
