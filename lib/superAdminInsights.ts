/**
 * Pure helpers for the super-admin panel's read-only insight pages. They only
 * shape aggregates the pages have already loaded; nothing here touches the
 * database or handles secrets.
 */

export const DAY_MS = 86_400_000;

/** UTC calendar days (YYYY-MM-DD), oldest first, ending with the day containing `now`. */
export function utcDayKeys(days: number, now: Date = new Date()): string[] {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const keys: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    keys.push(new Date(end - offset * DAY_MS).toISOString().slice(0, 10));
  }
  return keys;
}

/** Start (UTC midnight) of the first day in a `days`-long window ending today. */
export function windowStart(days: number, now: Date = new Date()): Date {
  return new Date(`${utcDayKeys(days, now)[0]}T00:00:00.000Z`);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "2026-10-05" -> "Oct 5". */
export function shortDayLabel(key: string): string {
  const [, month, day] = key.split("-");
  return `${MONTHS[Number(month) - 1] ?? "?"} ${Number(day)}`;
}

export type DailyRow = { series: string; day: string; n: number | bigint };
export type DailyPoint = { day: string; xLabel: string; y: number };

/**
 * Turns sparse grouped rows (only days with activity) into one zero-filled
 * series per name over the window. Rows outside the window are ignored.
 */
export function fillDailySeries<Name extends string>(rows: DailyRow[], names: readonly Name[], days: number, now: Date = new Date()): Record<Name, DailyPoint[]> {
  const keys = utcDayKeys(days, now);
  const lookup = new Map<string, number>();
  for (const row of rows) lookup.set(`${row.series}|${row.day}`, (lookup.get(`${row.series}|${row.day}`) ?? 0) + Number(row.n));
  const result = {} as Record<Name, DailyPoint[]>;
  for (const name of names) {
    result[name] = keys.map((day) => ({ day, xLabel: shortDayLabel(day), y: lookup.get(`${name}|${day}`) ?? 0 }));
  }
  return result;
}

export function sumPoints(points: DailyPoint[]): number {
  return points.reduce((total, point) => total + point.y, 0);
}

/** Splits a 2n-day series into the previous and current n-day totals. */
export function compareWindows(points: DailyPoint[]): { current: number; previous: number } {
  const half = Math.floor(points.length / 2);
  return { previous: sumPoints(points.slice(0, points.length - half)), current: sumPoints(points.slice(points.length - half)) };
}

/** Percentage change, or null when there is no baseline to compare with. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function formatChange(current: number, previous: number): string {
  const change = percentChange(current, previous);
  if (change == null) return current === 0 ? "—" : "New";
  const rounded = Math.round(change);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

/** Share as a whole-number percentage ("0%" when the total is empty). */
export function formatShare(part: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

export function formatBytes(bytes: number | null): string {
  if (bytes == null || Number.isNaN(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

export type CredentialState = "active" | "revoked" | "expired";

/** Lifecycle of a machine API credential from its timestamps only. */
export function credentialState(credential: { revokedAt: Date | null; expiresAt: Date | null }, now: Date = new Date()): CredentialState {
  if (credential.revokedAt) return "revoked";
  if (credential.expiresAt && credential.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

export type OutboxGroup = { kind: string; status: string; count: number };
export type OutboxKindRow = { kind: string; pending: number; processing: number; sent: number; failed: number; total: number };

/** Pivots outbox (kind, status) counts into one row per kind, busiest first. */
export function outboxByKind(groups: OutboxGroup[]): OutboxKindRow[] {
  const rows = new Map<string, OutboxKindRow>();
  for (const group of groups) {
    const row = rows.get(group.kind) ?? { kind: group.kind, pending: 0, processing: 0, sent: 0, failed: 0, total: 0 };
    if (group.status === "PENDING") row.pending += group.count;
    else if (group.status === "PROCESSING") row.processing += group.count;
    else if (group.status === "SENT") row.sent += group.count;
    else if (group.status === "FAILED") row.failed += group.count;
    row.total += group.count;
    rows.set(group.kind, row);
  }
  return [...rows.values()].sort((a, b) => b.total - a.total || a.kind.localeCompare(b.kind));
}

/**
 * Audit actions an operator reviews for account, access, and data-export
 * safety. Kept explicit so new business events do not appear here by accident.
 */
export const SECURITY_AUDIT_ACTIONS = [
  "SUPER_ADMIN_MFA_VERIFIED",
  "MFA_ENABLED",
  "MFA_DISABLED",
  "SESSIONS_REVOKED",
  "NEW_USER_REGISTRATION_SETTING_UPDATED",
  "INSTANCE_SERVICE_SETTINGS_UPDATED",
  "API_CLIENT_CREATED",
  "API_CLIENT_SCOPES_CHANGED",
  "API_CREDENTIAL_CREATED",
  "API_CREDENTIAL_REVOKED",
  "MEMBERSHIP_ROLE_CHANGED",
  "MEMBER_REMOVED",
  "ORGANISATION_DELETED",
  "ORGANISATION_INVITE_CREATED",
  "ORGANISATION_INVITE_ACCEPTED",
  "EVENT_COLLABORATOR_INVITED",
  "EVENT_COLLABORATOR_PERMISSIONS_UPDATED",
  "ATTENDEE_LIST_EXPORTED",
  "FEEDBACK_RESPONSES_EXPORTED",
  "JUDGING_SCORES_EXPORTED",
  "EVENT_REPORT_DOWNLOADED",
  "EVENT_OCCURRENCE_REPORT_DOWNLOADED",
  "ACCOUNT_DATA_EXPORTED",
  "CHECK_IN_STATION_PIN_REVEALED",
  "CHECK_IN_STATION_PIN_ROTATED",
] as const;

/** The instant `minutes` before `now`. */
export function minutesAgo(minutes: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - minutes * 60_000);
}

/** Longest free-text search the list pages accept. */
export const ADMIN_SEARCH_MAX_LENGTH = 120;
/** Deepest list page served; keeps OFFSET scans bounded and within Prisma's Int range. */
export const ADMIN_MAX_PAGE = 1000;

/**
 * Reads one free-text search parameter. Next.js passes repeated keys
 * (`?q=a&q=b`) as an array, so only the first value is used, then trimmed
 * and capped before it reaches a parameterised query.
 */
export function readSearchParam(value: string | string[] | undefined, maxLength: number = ADMIN_SEARCH_MAX_LENGTH): string {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first.trim().slice(0, maxLength) : "";
}

/** Zero-based page number from `?page=`, clamped to 0..ADMIN_MAX_PAGE. */
export function readPageParam(value: string | string[] | undefined): number {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first !== "string" || !/^\d{1,9}$/.test(first.trim())) return 0;
  return Math.min(ADMIN_MAX_PAGE, Number.parseInt(first.trim(), 10));
}
