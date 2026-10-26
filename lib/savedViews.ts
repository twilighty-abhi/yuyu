import { z } from "zod";
import { ATTENDEE_KIND_FILTERS, ATTENDEE_STATUS_FILTERS, ATTENDEE_TEAM_FILTERS } from "@/lib/attendeeListQuery";
import { ORGANISER_TEAM_FILTERS } from "@/lib/organiserTeamFilters";
import { RESULTS_SCORE_FILTERS, SUBMISSION_VIEW_FILTERS } from "@/lib/judgingOrganiserPaging";
import { JUDGING_PROGRESS_SECTIONS } from "@/lib/judgingProgress";

/*
 * Saved views (docs/FEATURES.md, "Saved views"): the filter and search state
 * of the event dashboard's paged lists as URL search params, validated per
 * surface against an allow-list. Pure: shared by the client (URL sync, the
 * Views menu), the server core (lib/core/savedViews.ts, on write and again on
 * read) and the unit tests.
 *
 * A view's params only choose filters inside a list the viewer may already
 * open; they never grant access. Unknown keys, values outside the allow-list
 * and default values are dropped, so a stored or pasted view can only ever
 * select an existing filter.
 */

export const SAVED_VIEW_SURFACES = ["GUESTS_PEOPLE", "GUESTS_TEAMS", "JUDGING_SUBMISSIONS", "JUDGING_RESULTS", "JUDGING_PROGRESS"] as const;
export type SavedViewSurfaceKey = (typeof SAVED_VIEW_SURFACES)[number];

/** Sanitised params: only allow-listed keys with non-default string values. */
export type ViewParams = Record<string, string>;

/** Longest search text a view can hold (the lists' own search limit). */
export const VIEW_QUERY_MAX_LENGTH = 100;
export const SAVED_VIEW_NAME_MAX_LENGTH = 60;
/** Views one person can keep per list of one event. */
export const SAVED_VIEWS_PER_USER_LIMIT = 50;
/** Most views (own and shared) a Views menu lists. */
export const SAVED_VIEWS_LIST_LIMIT = 100;

type ParamSpec = { kind: "enum"; values: readonly string[]; fallback: string } | { kind: "text" };

const text: ParamSpec = { kind: "text" };
const choice = (values: readonly string[]): ParamSpec => ({ kind: "enum", values, fallback: "all" });

/** Every surface's URL params and what each may hold ("all" is the default and is never written). */
export const SURFACE_PARAMS: Record<SavedViewSurfaceKey, Record<string, ParamSpec>> = {
  GUESTS_PEOPLE: { status: choice(ATTENDEE_STATUS_FILTERS), kind: choice(ATTENDEE_KIND_FILTERS), team: choice(ATTENDEE_TEAM_FILTERS), q: text },
  GUESTS_TEAMS: { status: choice(ORGANISER_TEAM_FILTERS), q: text },
  JUDGING_SUBMISSIONS: { status: choice(SUBMISSION_VIEW_FILTERS), q: text },
  JUDGING_RESULTS: { scored: choice(RESULTS_SCORE_FILTERS), q: text },
  JUDGING_PROGRESS: { show: choice(["all", ...JUDGING_PROGRESS_SECTIONS]) },
};

/** Every key any surface writes; cleared from the address bar when the tab or sub-tab changes. */
export const VIEW_URL_KEYS: readonly string[] = [...new Set(Object.values(SURFACE_PARAMS).flatMap((spec) => Object.keys(spec)))];

/** Which dashboard tab and sub-tab show a surface (for "Copy link"). */
export const SURFACE_TABS: Record<SavedViewSurfaceKey, { tab: string; sub: string }> = {
  GUESTS_PEOPLE: { tab: "guests", sub: "people" },
  GUESTS_TEAMS: { tab: "guests", sub: "teams" },
  JUDGING_SUBMISSIONS: { tab: "judging", sub: "judging-submissions" },
  JUDGING_RESULTS: { tab: "judging", sub: "judging-results" },
  JUDGING_PROGRESS: { tab: "judging", sub: "judging-progress" },
};

export const savedViewSurfaceSchema = z.enum(SAVED_VIEW_SURFACES);

/** Control characters and angle brackets never reach a stored view or a URL. */
function cleanText(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F<>]+/g, " ").replace(/\s+/g, " ").trim();
}

export const savedViewNameSchema = z
  .string()
  .transform(cleanText)
  .pipe(z.string().min(1, "Give the view a name.").max(SAVED_VIEW_NAME_MAX_LENGTH, `Use ${SAVED_VIEW_NAME_MAX_LENGTH} characters or fewer.`));

/**
 * Keep only what the surface allows. Anything else (unknown keys, wrong
 * types, values outside the allow-list, defaults, over-long text) is dropped
 * rather than refused, so an old link or an old stored view still opens.
 */
export function sanitizeViewParams(surface: SavedViewSurfaceKey, raw: unknown): ViewParams {
  const spec = SURFACE_PARAMS[surface];
  if (!spec || typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const input = raw as Record<string, unknown>;
  const out: ViewParams = {};
  for (const key of Object.keys(spec).sort()) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const value = input[key];
    if (typeof value !== "string") continue;
    const rule = spec[key]!;
    if (rule.kind === "enum") {
      if (rule.values.includes(value) && value !== rule.fallback) out[key] = value;
    } else {
      const cleaned = cleanText(value);
      if (cleaned && cleaned.length <= VIEW_QUERY_MAX_LENGTH) out[key] = cleaned;
    }
  }
  return out;
}

/** A surface's view from a URL's search params (first value of each key). */
export function viewParamsFromSearchParams(surface: SavedViewSurfaceKey, params: URLSearchParams | { get(key: string): string | null }): ViewParams {
  const raw: Record<string, string> = {};
  for (const key of Object.keys(SURFACE_PARAMS[surface] ?? {})) {
    const value = params.get(key);
    if (value != null) raw[key] = value;
  }
  return sanitizeViewParams(surface, raw);
}

/** Drop every view key from a URL in place (the tab or sub-tab changed). */
export function clearViewParamsFromUrl(url: URL): URL {
  for (const key of VIEW_URL_KEYS) url.searchParams.delete(key);
  return url;
}

/** Write a view into a URL in place: clears every view key, then sets this surface's. */
export function applyViewParamsToUrl(url: URL, surface: SavedViewSurfaceKey, params: ViewParams): URL {
  for (const key of VIEW_URL_KEYS) url.searchParams.delete(key);
  const clean = sanitizeViewParams(surface, params);
  for (const key of Object.keys(clean)) url.searchParams.set(key, clean[key]!);
  return url;
}

/** A shareable dashboard link to a surface with a view applied. */
export function viewLink(base: string, surface: SavedViewSurfaceKey, params: ViewParams): string {
  const url = new URL(base);
  const { tab, sub } = SURFACE_TABS[surface];
  url.searchParams.set("tab", tab);
  url.searchParams.set("sub", sub);
  return applyViewParamsToUrl(url, surface, params).toString();
}

/** Same filters (both sanitised, order-insensitive). */
export function sameViewParams(surface: SavedViewSurfaceKey, a: ViewParams, b: ViewParams): boolean {
  const left = sanitizeViewParams(surface, a);
  const right = sanitizeViewParams(surface, b);
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

/** The value of one param, or the surface default ("all", or "" for text). */
export function viewParam(params: ViewParams, key: string): string {
  return params[key] ?? (key === "q" ? "" : "all");
}

export type ViewPreset = { id: string; label: string; params: ViewParams; teamModeOnly?: boolean };

/** Built-in views per surface. Every preset selects a filter the list computes on the server, with its count. */
export const VIEW_PRESETS: Record<SavedViewSurfaceKey, ViewPreset[]> = {
  GUESTS_PEOPLE: [
    { id: "waitlisted", label: "Waitlisted", params: { status: "waitlist" } },
    { id: "checked-in", label: "Checked in", params: { status: "checkedIn" } },
    { id: "not-checked-in", label: "Not checked in", params: { status: "notCheckedIn" } },
    { id: "solo", label: "Solo", params: { team: "solo" }, teamModeOnly: true },
  ],
  GUESTS_TEAMS: [
    { id: "incomplete", label: "Incomplete", params: { status: "incomplete" } },
    { id: "pending-approval", label: "Pending approval", params: { status: "approve" } },
    { id: "looking", label: "Looking for members", params: { status: "looking" } },
  ],
  JUDGING_SUBMISSIONS: [
    { id: "not-submitted", label: "Not submitted", params: { status: "notSubmitted" } },
    { id: "drafts", label: "Drafts", params: { status: "DRAFT" } },
    { id: "disqualified", label: "Disqualified", params: { status: "DISQUALIFIED" } },
  ],
  JUDGING_RESULTS: [
    { id: "unscored", label: "Unscored", params: { scored: "unscored" } },
    { id: "under-two", label: "Scored by fewer than 2 judges", params: { scored: "underTwo" } },
  ],
  JUDGING_PROGRESS: [{ id: "below-target", label: "Below target", params: { show: "below-target" } }],
};

export function presetsFor(surface: SavedViewSurfaceKey, options: { teamMode?: boolean } = {}): ViewPreset[] {
  return VIEW_PRESETS[surface].filter((preset) => !preset.teamModeOnly || options.teamMode);
}

/** A stable empty list, for components whose views are optional (a fresh [] each render would reset the menu). */
export const NO_SAVED_VIEWS: readonly SavedViewDto[] = Object.freeze([]) as readonly SavedViewDto[];

/** A saved view as the Views menu receives it. */
export type SavedViewDto = {
  id: string;
  name: string;
  params: ViewParams;
  shared: boolean;
  /** Created by the viewer (only they can rename or re-share it). */
  mine: boolean;
  /** The viewer may delete it: their own, or a shared view when they are an organisation owner/admin. */
  canDelete: boolean;
  /** Display name of the creator, for shared views. */
  createdBy: string;
};
