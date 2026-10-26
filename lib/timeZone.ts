export function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

/** Protect render paths from legacy rows written before timezone validation. */
export function safeTimeZone(value: string) {
  return isValidTimeZone(value) ? value : "UTC";
}

export function zonedDatetimeLocalValue(date: Date, timeZone: string) {
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Converts a datetime-local value in an IANA timezone into a UTC ISO instant. */
export function zonedInputToIso(value: string, timeZone: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const guess = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(guess));
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const offset = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - guess;
  const iso = new Date(guess - offset).toISOString();
  return zonedDatetimeLocalValue(new Date(iso), timeZone) === value ? iso : null;
}

/**
 * An instant as ISO 8601 local time in an IANA timezone with its UTC offset,
 * e.g. `2026-10-25T14:30:00+05:30` (`+00:00` for UTC). Machine-readable like
 * `toISOString()`, but it reads as the event's own clock (CSV exports).
 */
export function zonedIsoWithOffset(date: Date, timeZone: string) {
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  const wholeSeconds = Math.floor(date.getTime() / 1000) * 1000;
  const local = Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day")), Number(get("hour")), Number(get("minute")), Number(get("second")));
  const offsetMinutes = Math.round((local - wholeSeconds) / 60_000);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}${offset}`;
}
