"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  applyIdCardMergeFields,
  defaultIdCardPrintSettings,
  ID_CARD_TEAM_FIELD_KEY,
  normalizeIdCardPrintSettings,
  type IdCardLayoutElement,
  type IdCardPrintSettings,
} from "@/lib/idCardPrint";

export type IdCardAttendee = {
  displayName: string;
  email: string | null;
  /** Active ticket bearer token used only for rendering this attendee's QR. */
  checkInQrToken: string;
  checkInDetails: Array<{ label: string; value: string }>;
  registrationDetails: Array<{ key: string; label: string; value: string }>;
  /** TEAM events: the attendee's team, for the {{team}} merge field and the Team line. */
  teamName?: string | null;
};

export type RegistrationField = { key: string; label: string };
export type PrintableField = { key: string; label: string; value: string };

export const SAFE_MARGIN_MM = 5;

export const ELEMENT_LABELS: Record<IdCardLayoutElement, string> = {
  header: "Heading",
  name: "Attendee name",
  email: "Email",
  details: "Registration answers",
  qr: "Check-in QR",
  footer: "Footer",
  logo: "Logo",
};

export const registrationFieldKey = (key: string) => `registration:${key}`;

const storageKey = (eventId: string) => `yuyu:checkin:id-card:${eventId}`;
const settingsChangedEvent = "yuyu:id-card-print-settings-changed";
const sessionSettings = new Map<string, IdCardPrintSettings>();

function readSettings(eventId: string, eventTitle: string, organisationName: string) {
  const cached = sessionSettings.get(eventId);
  if (cached) return cached;
  const fallback = defaultIdCardPrintSettings(eventTitle, organisationName);
  try {
    const saved = window.localStorage.getItem(storageKey(eventId));
    if (saved) {
      const settings = normalizeIdCardPrintSettings(JSON.parse(saved), eventTitle, organisationName);
      sessionSettings.set(eventId, settings);
      return settings;
    }
  } catch {
    // A private or locked-down station uses the in-memory settings below.
  }
  sessionSettings.set(eventId, fallback);
  return fallback;
}

/**
 * The card design for this event, kept in this browser (per event) and shared
 * by every open designer or print sheet. `update` records undo history unless
 * told not to (e.g. the moves in the middle of a drag).
 */
export function useIdCardSettings(eventId: string, eventTitle: string, organisationName: string) {
  const defaults = useMemo(() => defaultIdCardPrintSettings(eventTitle, organisationName), [eventTitle, organisationName]);
  const subscribe = useCallback((onStoreChange: () => void) => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey(eventId)) {
        sessionSettings.delete(eventId);
        onStoreChange();
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(settingsChangedEvent, onStoreChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(settingsChangedEvent, onStoreChange);
    };
  }, [eventId]);
  const settings = useSyncExternalStore(
    subscribe,
    useCallback(() => readSettings(eventId, eventTitle, organisationName), [eventId, eventTitle, organisationName]),
    useCallback(() => defaults, [defaults]),
  );
  const [undoStack, setUndoStack] = useState<IdCardPrintSettings[]>([]);
  const [redoStack, setRedoStack] = useState<IdCardPrintSettings[]>([]);
  // Handlers read the newest settings even mid-drag, between renders.
  const latest = useRef(settings);
  useLayoutEffect(() => {
    latest.current = settings;
  }, [settings]);

  const write = useCallback((next: IdCardPrintSettings) => {
    sessionSettings.set(eventId, next);
    try {
      window.localStorage.setItem(storageKey(eventId), JSON.stringify(next));
    } catch {
      // Keep the settings for this browser session only when storage is unavailable.
    }
    window.dispatchEvent(new Event(settingsChangedEvent));
  }, [eventId]);

  const checkpoint = useCallback(() => {
    setUndoStack((stack) => [...stack.slice(-49), latest.current]);
    setRedoStack([]);
  }, []);

  const update = useCallback((patch: Partial<IdCardPrintSettings>, record = true) => {
    const current = latest.current;
    if (record) checkpoint();
    const next = normalizeIdCardPrintSettings({ ...current, ...patch }, eventTitle, organisationName);
    // Text is kept exactly as typed (including empty) while editing.
    for (const [key, maxLength] of [["heading", 120], ["badgeLabel", 40], ["footerText", 80]] as const) {
      next[key] = (patch[key] ?? current[key]).slice(0, maxLength);
    }
    write(next);
  }, [checkpoint, eventTitle, organisationName, write]);

  const undo = useCallback(() => {
    const previous = undoStack[undoStack.length - 1];
    if (!previous) return;
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, latest.current]);
    write(previous);
  }, [undoStack, write]);

  const redo = useCallback(() => {
    const next = redoStack[redoStack.length - 1];
    if (!next) return;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, latest.current]);
    write(next);
  }, [redoStack, write]);

  return { settings, update, checkpoint, undo, redo, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 };
}

export function safeLogoUrl(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** The registration answers (and the Team line) chosen for the card, in the chosen order, that this attendee actually has. */
export function printableFields(settings: IdCardPrintSettings, attendee: IdCardAttendee): PrintableField[] {
  const details = new Map(attendee.registrationDetails.map((detail) => [detail.key, detail]));
  return settings.printFieldKeys.flatMap((key) => {
    if (key === ID_CARD_TEAM_FIELD_KEY) {
      const team = attendee.teamName?.trim();
      return team ? [{ key, label: "Team", value: team }] : [];
    }
    const detail = details.get(key.startsWith("registration:") ? key.slice("registration:".length) : key);
    return detail ? [{ key, label: detail.label, value: detail.value }] : [];
  });
}

/** The settings with `{{team}}` filled in the heading, badge label and footer for this attendee. */
export function withMergeFields(settings: IdCardPrintSettings, attendee: IdCardAttendee): IdCardPrintSettings {
  const values = { team: attendee.teamName };
  const heading = applyIdCardMergeFields(settings.heading, values);
  const badgeLabel = applyIdCardMergeFields(settings.badgeLabel, values);
  const footerText = applyIdCardMergeFields(settings.footerText, values);
  if (heading === settings.heading && badgeLabel === settings.badgeLabel && footerText === settings.footerText) return settings;
  return { ...settings, heading, badgeLabel, footerText };
}

/** Sample people for the designer: a typical name and a long one to test fitting. */
export function sampleAttendee(fields: RegistrationField[], long = false, teamEvent = false): IdCardAttendee {
  return {
    teamName: teamEvent ? (long ? "The Midnight Debugging Collective" : "Night Owls") : null,
    displayName: long ? "Alexandra Montgomery-Fitzgerald" : "Priya Raman",
    email: long ? "alexandra.montgomery-fitzgerald@example.com" : "priya@example.com",
    checkInQrToken: "preview-check-in-token",
    checkInDetails: [],
    registrationDetails: fields.map((field) => ({
      key: field.key,
      label: field.label,
      value: sampleAnswer(field.label, long),
    })),
  };
}

function sampleAnswer(label: string, long: boolean) {
  if (/organi[sz]ation|company|employer|school|university/i.test(label)) return long ? "International Federation of Community Builders" : "Tech4Good";
  if (/role|title|position|job/i.test(label)) return long ? "Senior Community Partnerships Lead" : "Designer";
  if (/diet|food|meal/i.test(label)) return "Vegetarian";
  if (/size|shirt/i.test(label)) return "M";
  if (/pronoun/i.test(label)) return "she/her";
  return long ? "A longer sample answer" : "Sample answer";
}
