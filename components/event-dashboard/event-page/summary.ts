/**
 * Pure helpers for the event dashboard's "Event page" tab: section notes,
 * the programme summary line, page-settings change counting, and accent
 * input validation. No React, no server-only imports, so they are unit-tested
 * directly (tests/unit/event-page-summary.test.ts).
 */

import { normalizeAccentHex } from "@/lib/theme/accent";
import { registrationActionLabel, type RegistrationLabelTeam } from "@/lib/registrationLabel";

export const SECTION_TYPES = ["HERO", "ABOUT", "HIGHLIGHTS", "SCHEDULE", "SPEAKERS", "SPONSORS", "VENUE", "FAQ", "RESOURCES"] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export const SECTION_LABELS: Record<SectionType, string> = {
  HERO: "Hero",
  ABOUT: "About",
  HIGHLIGHTS: "Highlights",
  SCHEDULE: "Programme",
  SPEAKERS: "Speakers",
  SPONSORS: "Sponsors",
  VENUE: "Venue",
  FAQ: "FAQ",
  RESOURCES: "Resources",
};

export type PageSection = { type: string; isVisible: boolean; sortOrder: number };

export function sectionLabel(type: string): string {
  return SECTION_LABELS[type as SectionType] ?? type;
}

/** "1 session", "2 sessions", "3 people". */
export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Every known section exactly once, saved ones first in their saved order, missing ones appended visible. */
export function normalizeSections(saved: readonly PageSection[] | null | undefined): PageSection[] {
  const known = (saved ?? [])
    .filter((section, index, list) => (SECTION_TYPES as readonly string[]).includes(section.type) && list.findIndex((other) => other.type === section.type) === index)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const missing = SECTION_TYPES.filter((type) => !known.some((section) => section.type === type)).map((type) => ({ type, isVisible: true, sortOrder: 0 }));
  return [...known, ...missing].map((section, sortOrder) => ({ type: section.type, isVisible: section.isVisible, sortOrder }));
}

export type ProgrammeCounts = { sessionCount: number; trackCount: number; speakerCount: number };

export function programmeCounts(sessions: readonly { trackId: string }[], speakerCount: number): ProgrammeCounts {
  return { sessionCount: sessions.length, trackCount: new Set(sessions.map((session) => session.trackId)).size, speakerCount };
}

/** "4 sessions on 1 track · 2 speakers" (or "No sessions yet · 2 speakers"). */
export function programmeSummary({ sessionCount, trackCount, speakerCount }: ProgrammeCounts): string {
  const sessions = sessionCount === 0 ? "No sessions yet" : `${countLabel(sessionCount, "session")} on ${countLabel(Math.max(1, trackCount), "track")}`;
  return `${sessions} · ${countLabel(speakerCount, "speaker")}`;
}

type Item = { visibility: string };

export type SectionNoteData = {
  highlights: readonly Item[];
  speakers: readonly Item[];
  sponsors: readonly Item[];
  resources: readonly Item[];
  faqs: readonly Item[];
  sessionCount: number;
  location: string;
  isOnline: boolean;
};

function itemsNote(items: readonly Item[], singular: string, plural?: string): string {
  if (items.length === 0) return "Empty";
  const published = items.filter((item) => item.visibility === "PUBLISHED").length;
  const unpublished = items.length - published;
  return unpublished > 0 ? `${countLabel(items.length, singular, plural)} · ${unpublished} not published` : countLabel(items.length, singular, plural);
}

/** A short note of what a section contains, from real data. */
export function sectionNote(type: string, data: SectionNoteData): string {
  switch (type) {
    case "HERO":
      return "Cover, title and register button";
    case "ABOUT":
      return "From Details";
    case "HIGHLIGHTS":
      return itemsNote(data.highlights, "highlight");
    case "SCHEDULE":
      return data.sessionCount === 0 ? "Empty" : countLabel(data.sessionCount, "session");
    case "SPEAKERS":
      return itemsNote(data.speakers, "person", "people");
    case "SPONSORS":
      return itemsNote(data.sponsors, "sponsor");
    case "VENUE":
      if (data.isOnline) return "Online event · not shown";
      return data.location.trim() || "Empty";
    case "FAQ":
      return itemsNote(data.faqs, "question");
    case "RESOURCES":
      return itemsNote(data.resources, "resource");
    default:
      return "";
  }
}

/**
 * Accent input as typed. Empty means "use the default"; `#abc` and `#aabbcc`
 * are accepted and normalised to `#AABBCC` (the only form the server takes).
 */
export function parseAccentInput(raw: string): { valid: boolean; value: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: true, value: "" };
  const value = normalizeAccentHex(trimmed, "");
  return value ? { valid: true, value } : { valid: false, value: "" };
}

export type PageSettings = { accentColor: string; sections: readonly PageSection[] };

/** Number of unsaved changes: accent (1), each section visibility toggle (1 each), and the order (1). */
export function countPageChanges(saved: PageSettings, draft: PageSettings): number {
  let changes = 0;
  const savedAccent = parseAccentInput(saved.accentColor);
  const draftAccent = parseAccentInput(draft.accentColor);
  const sameAccent = savedAccent.valid && draftAccent.valid ? savedAccent.value === draftAccent.value : saved.accentColor.trim() === draft.accentColor.trim();
  if (!sameAccent) changes += 1;
  for (const section of draft.sections) {
    const before = saved.sections.find((other) => other.type === section.type);
    if (!before || before.isVisible !== section.isVisible) changes += 1;
  }
  const order = (sections: readonly PageSection[]) => sections.map((section) => section.type).join(",");
  if (order(saved.sections) !== order(draft.sections)) changes += 1;
  return changes;
}

export function unsavedLabel(count: number): string {
  return count > 0 ? countLabel(count, "unsaved change") : "Unsaved changes";
}

/** The public register button label for an event's audience (matches RegistrationCard). */
export function registerLabelFor(privacyType: string, team: RegistrationLabelTeam | null = null): string {
  if (privacyType === "INVITE_ONLY") return "Register with your invite";
  // TEAM events use the public card's team wording (docs/TEAMS.md).
  return registrationActionLabel({ full: false, approvalRequired: privacyType === "APPROVAL_REQUIRED" }, team);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** Plain-text excerpt of sanitised rich text for the preview (rendered as text, never as HTML). */
export function htmlExcerpt(html: string, max = 90): string {
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, name: string) => ENTITIES[name] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Friendly names for registration field types (chips in the form editor). */
export const FIELD_TYPE_LABELS: Record<string, string> = {
  TEXT: "Short text",
  TEXTAREA: "Long text",
  EMAIL: "Email",
  PHONE: "Phone",
  SELECT: "Dropdown",
  MULTI_SELECT: "Multiple choice",
  RADIO: "Single choice",
  CHECKBOX: "Checkbox",
  NUMBER: "Number",
  DATE: "Date",
};

export function fieldTypeLabel(type: string): string {
  return FIELD_TYPE_LABELS[type] ?? type.toLowerCase();
}
