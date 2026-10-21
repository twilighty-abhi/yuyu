import type { BroadcastAttendanceFilter, RsvpStatus } from "@prisma/client";
import type { BroadcastDesignId } from "@/lib/email/broadcastDesigns";

/*
 * Framework-free autosave state for the Emails tab draft. The React panel
 * feeds it every edit; it decides when the content differs from what the
 * server holds, debounces saves, never runs two saves at once, and ignores
 * results that arrive after the composer was reset (a send, a discard, or a
 * newly picked template).
 */

export const DRAFT_AUTOSAVE_DELAY_MS = 1500;

/** Everything the organiser chose in the composer, exactly what a draft stores. */
export type BroadcastDraftContent = {
  subject: string;
  body: string;
  design: string;
  statuses: readonly RsvpStatus[];
  attendance: BroadcastAttendanceFilter;
  templateId: string | null;
};

/** A saved draft as the dashboard receives it (the signed-in organiser's own). */
export type EventBroadcastDraftDto = {
  subject: string;
  body: string;
  design: BroadcastDesignId;
  statuses: RsvpStatus[];
  attendance: BroadcastAttendanceFilter;
  templateId: string | null;
  updatedAt: string;
};

/** Order-insensitive for statuses, so toggling a status off and on again is not a change. */
export function draftFingerprint(content: BroadcastDraftContent): string {
  return JSON.stringify([content.subject, content.body, content.design, [...content.statuses].sort(), content.attendance, content.templateId]);
}

export type DraftSaveResult = { ok: true; updatedAt: string } | { ok: false; error: string };

export type DraftAutosaveState = {
  /** The composer differs from the saved draft (or, with no draft, from its starting point). */
  dirty: boolean;
  saving: boolean;
  /** A draft exists on the server for this organiser and event. */
  hasDraft: boolean;
  /** When the draft was last saved (ISO), if one exists. */
  savedAt: string | null;
  /** The last save failed and the changes are still unsaved. */
  error: string | null;
};

export type DraftAutosaveOptions = {
  save: (content: BroadcastDraftContent) => Promise<DraftSaveResult>;
  onChange: (state: DraftAutosaveState) => void;
  /** What the composer opens with: a restored draft or the starting template. */
  initial: BroadcastDraftContent;
  /** Set when `initial` is a restored server draft. */
  savedAt?: string | null;
  delayMs?: number;
};

export class DraftAutosave {
  private readonly save: DraftAutosaveOptions["save"];
  private readonly onChange: DraftAutosaveOptions["onChange"];
  private readonly delayMs: number;
  private latest: BroadcastDraftContent;
  /** Fingerprint the composer is compared with; null means "nothing matches", so every state is unsaved. */
  private baseline: string | null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private generation = 0;
  private suspended = false;
  private current: DraftAutosaveState;

  constructor(options: DraftAutosaveOptions) {
    this.save = options.save;
    this.onChange = options.onChange;
    this.delayMs = options.delayMs ?? DRAFT_AUTOSAVE_DELAY_MS;
    this.latest = options.initial;
    this.baseline = draftFingerprint(options.initial);
    const savedAt = options.savedAt ?? null;
    this.current = { dirty: false, saving: false, hasDraft: savedAt !== null, savedAt, error: null };
  }

  get state(): DraftAutosaveState {
    return this.current;
  }

  /** Records the composer's current content and schedules a save when it has changed. */
  edit(content: BroadcastDraftContent): void {
    this.latest = content;
    const dirty = this.isDirty();
    this.update({ dirty, error: dirty ? this.current.error : null });
    if (dirty) this.schedule();
    else this.clearTimer();
  }

  /** Saves immediately (the "Save draft" and "Retry" buttons). */
  async saveNow(): Promise<void> {
    this.clearTimer();
    if (this.suspended) return;
    if (this.inFlight) {
      // One save at a time: run again afterwards if edits arrived meanwhile.
      await this.inFlight;
      if (this.isDirty() && !this.suspended && !this.inFlight) return this.saveNow();
      return;
    }
    if (!this.isDirty()) return;

    const generation = this.generation;
    const content = this.latest;
    this.update({ saving: true });
    const run = (async () => {
      let result: DraftSaveResult;
      try {
        result = await this.save(content);
      } catch {
        result = { ok: false, error: "Could not save the draft." };
      }
      if (generation !== this.generation) return; // reset while saving: the result describes an abandoned composer
      if (result.ok) {
        this.baseline = draftFingerprint(content);
        const dirty = this.isDirty();
        this.update({ saving: false, hasDraft: true, savedAt: result.updatedAt, error: null, dirty });
        if (dirty) this.schedule();
      } else {
        this.update({ saving: false, error: result.error, dirty: this.isDirty() });
      }
    })();
    this.inFlight = run;
    try {
      await run;
    } finally {
      if (this.inFlight === run) this.inFlight = null;
      if (generation !== this.generation) this.update({ saving: false });
    }
  }

  /**
   * Starts over from `content` (a send, a discard, or a picked template).
   * Pending and in-flight saves are abandoned.
   */
  reset(content: BroadcastDraftContent, draft: { hasDraft: boolean; savedAt: string | null }): void {
    this.generation += 1;
    this.clearTimer();
    this.latest = content;
    this.baseline = draftFingerprint(content);
    this.update({ dirty: false, saving: false, error: null, hasDraft: draft.hasDraft, savedAt: draft.savedAt });
  }

  /** Treats the current content as unsaved, for example when discarding the server copy failed. */
  markUnsaved(): void {
    this.baseline = null;
    this.update({ dirty: true });
    this.schedule();
  }

  /** Pauses autosave (during the send countdown); edits are still tracked. */
  suspend(): void {
    this.suspended = true;
    this.clearTimer();
  }

  resume(): void {
    this.suspended = false;
    if (this.isDirty()) this.schedule();
  }

  /** Leaving the composer: save unsaved work once, without waiting. */
  leave(): void {
    this.clearTimer();
    // Leaving also cancels a pending send, so the work is saved even mid-countdown.
    this.suspended = false;
    if (this.isDirty() && !this.current.saving) void this.saveNow();
  }

  private isDirty(): boolean {
    return this.baseline === null || draftFingerprint(this.latest) !== this.baseline;
  }

  private schedule(): void {
    if (this.suspended) return;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.saveNow();
    }, this.delayMs);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private update(patch: Partial<DraftAutosaveState>): void {
    const next = { ...this.current, ...patch };
    if (
      next.dirty === this.current.dirty &&
      next.saving === this.current.saving &&
      next.hasDraft === this.current.hasDraft &&
      next.savedAt === this.current.savedAt &&
      next.error === this.current.error
    ) return;
    this.current = next;
    this.onChange(next);
  }
}

/** The quiet status line under the message: what the organiser needs to know about their draft. */
/** `formatTime` is null until hydration, so the server and browser render the same text. */
export function draftStatusText(state: DraftAutosaveState, formatTime: ((iso: string) => string) | null): string {
  if (state.saving) return "Saving…";
  if (state.error && state.dirty) return "Couldn't save";
  if (state.dirty) return "Unsaved changes";
  if (state.hasDraft && state.savedAt) return formatTime ? `Draft saved · ${formatTime(state.savedAt)}` : "Draft saved";
  return "Changes are saved as a draft automatically.";
}
