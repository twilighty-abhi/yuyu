import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DRAFT_AUTOSAVE_DELAY_MS,
  DraftAutosave,
  draftFingerprint,
  draftStatusText,
  type BroadcastDraftContent,
  type DraftAutosaveState,
  type DraftSaveResult,
} from "@/lib/broadcastDraftAutosave";

const start: BroadcastDraftContent = {
  subject: "Update",
  body: "<p>Hello</p>",
  design: "classic",
  statuses: ["CONFIRMED", "WAITLISTED"],
  attendance: "ANY",
  templateId: "update",
};

function deferred() {
  let resolve!: (value: DraftSaveResult) => void;
  const promise = new Promise<DraftSaveResult>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup(options: { savedAt?: string | null; save?: (content: BroadcastDraftContent) => Promise<DraftSaveResult> } = {}) {
  const states: DraftAutosaveState[] = [];
  let counter = 0;
  const save = vi.fn(options.save ?? (async () => ({ ok: true as const, updatedAt: `2030-01-01T10:00:0${counter++}.000Z` })));
  const autosave = new DraftAutosave({ initial: start, savedAt: options.savedAt ?? null, save, onChange: (state) => states.push(state) });
  return { autosave, save, states };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("draftFingerprint", () => {
  it("ignores status order but not content", () => {
    expect(draftFingerprint({ ...start, statuses: ["WAITLISTED", "CONFIRMED"] })).toBe(draftFingerprint(start));
    expect(draftFingerprint({ ...start, subject: "Update!" })).not.toBe(draftFingerprint(start));
    expect(draftFingerprint({ ...start, design: "letter" })).not.toBe(draftFingerprint(start));
    expect(draftFingerprint({ ...start, templateId: null })).not.toBe(draftFingerprint(start));
  });
});

describe("DraftAutosave", () => {
  it("is clean at the starting point and does not save it", async () => {
    const { autosave, save } = setup();
    autosave.edit({ ...start, statuses: ["WAITLISTED", "CONFIRMED"] });
    await vi.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DELAY_MS * 2);
    expect(save).not.toHaveBeenCalled();
    expect(autosave.state).toEqual({ dirty: false, saving: false, hasDraft: false, savedAt: null, error: null });
  });

  it("debounces typing and saves the latest content once typing stops", async () => {
    const { autosave, save } = setup();
    autosave.edit({ ...start, subject: "U" });
    await vi.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DELAY_MS - 100);
    autosave.edit({ ...start, subject: "Up" });
    await vi.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DELAY_MS - 100);
    expect(save).not.toHaveBeenCalled();
    expect(autosave.state.dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ ...start, subject: "Up" });
    expect(autosave.state).toMatchObject({ dirty: false, saving: false, hasDraft: true, error: null });
    expect(autosave.state.savedAt).toMatch(/^2030-/);
  });

  it("returning to the saved content is not a change", async () => {
    const { autosave, save } = setup();
    autosave.edit({ ...start, subject: "Draft" });
    await autosave.saveNow();
    autosave.edit({ ...start, subject: "Draft!" });
    expect(autosave.state.dirty).toBe(true);
    autosave.edit({ ...start, subject: "Draft" });
    expect(autosave.state.dirty).toBe(false);
    await vi.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DELAY_MS * 2);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("never runs two saves at once and saves edits made during a save afterwards", async () => {
    const first = deferred();
    const calls: BroadcastDraftContent[] = [];
    const { autosave } = setup({
      save: async (content) => {
        calls.push(content);
        if (calls.length === 1) return first.promise;
        return { ok: true, updatedAt: "2030-01-01T10:00:09.000Z" };
      },
    });
    autosave.edit({ ...start, subject: "A" });
    const saving = autosave.saveNow();
    expect(autosave.state.saving).toBe(true);
    autosave.edit({ ...start, subject: "AB" });
    const again = autosave.saveNow();
    expect(calls).toHaveLength(1);
    first.resolve({ ok: true, updatedAt: "2030-01-01T10:00:01.000Z" });
    await saving;
    await again;
    expect(calls.map((content) => content.subject)).toEqual(["A", "AB"]);
    expect(autosave.state).toMatchObject({ dirty: false, saving: false, savedAt: "2030-01-01T10:00:09.000Z" });
  });

  it("reports a failed save, keeps the changes unsaved, and retries", async () => {
    let fail = true;
    const { autosave, save } = setup({ save: async () => (fail ? { ok: false, error: "Saving too often." } : { ok: true, updatedAt: "2030-01-01T10:00:00.000Z" }) });
    autosave.edit({ ...start, body: "<p>Hi</p>" });
    await vi.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DELAY_MS);
    expect(autosave.state).toMatchObject({ dirty: true, saving: false, error: "Saving too often.", hasDraft: false });
    expect(draftStatusText(autosave.state, null)).toBe("Couldn't save");
    fail = false;
    await autosave.saveNow();
    expect(save).toHaveBeenCalledTimes(2);
    expect(autosave.state).toMatchObject({ dirty: false, error: null, hasDraft: true });
  });

  it("treats a thrown save as a failure", async () => {
    const { autosave } = setup({ save: async () => { throw new Error("offline"); } });
    autosave.edit({ ...start, subject: "x" });
    await autosave.saveNow();
    expect(autosave.state).toMatchObject({ dirty: true, saving: false, error: "Could not save the draft." });
  });

  it("ignores a save that finishes after the composer was reset", async () => {
    const pending = deferred();
    const { autosave } = setup({ save: () => pending.promise });
    autosave.edit({ ...start, subject: "Old" });
    const saving = autosave.saveNow();
    autosave.reset(start, { hasDraft: false, savedAt: null });
    pending.resolve({ ok: true, updatedAt: "2030-01-01T10:00:00.000Z" });
    await saving;
    expect(autosave.state).toEqual({ dirty: false, saving: false, hasDraft: false, savedAt: null, error: null });
  });

  it("does not autosave while suspended for the send countdown, and resumes afterwards", async () => {
    const { autosave, save } = setup();
    autosave.edit({ ...start, subject: "Sending" });
    autosave.suspend();
    await vi.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DELAY_MS * 4);
    await autosave.saveNow();
    expect(save).not.toHaveBeenCalled();
    expect(autosave.state.dirty).toBe(true);
    autosave.resume();
    await vi.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("after a send, only edits made since the snapshot remain unsaved", async () => {
    const { autosave, save } = setup({ savedAt: "2030-01-01T09:00:00.000Z" });
    const sent = { ...start, subject: "Sent" };
    autosave.edit(sent);
    autosave.suspend();
    autosave.reset(sent, { hasDraft: false, savedAt: null });
    autosave.resume();
    autosave.edit(sent);
    expect(autosave.state).toMatchObject({ dirty: false, hasDraft: false });
    autosave.edit({ ...sent, subject: "Sent, then edited" });
    await vi.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DELAY_MS);
    expect(save).toHaveBeenCalledWith({ ...sent, subject: "Sent, then edited" });
  });

  it("markUnsaved forces the next save even when content matches", async () => {
    const { autosave, save } = setup({ savedAt: "2030-01-01T09:00:00.000Z" });
    autosave.markUnsaved();
    expect(autosave.state.dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(DRAFT_AUTOSAVE_DELAY_MS);
    expect(save).toHaveBeenCalledWith(start);
    expect(autosave.state.dirty).toBe(false);
  });

  it("saves unsaved work once when the composer is left, even mid-countdown", async () => {
    const { autosave, save } = setup();
    autosave.leave();
    expect(save).not.toHaveBeenCalled();
    autosave.edit({ ...start, subject: "Leaving" });
    autosave.suspend();
    autosave.leave();
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("only notifies on real state changes", () => {
    const { autosave, states } = setup();
    autosave.edit({ ...start, subject: "a" });
    autosave.edit({ ...start, subject: "ab" });
    autosave.edit({ ...start, subject: "abc" });
    expect(states).toHaveLength(1);
  });
});

describe("draftStatusText", () => {
  const base: DraftAutosaveState = { dirty: false, saving: false, hasDraft: false, savedAt: null, error: null };
  const time = () => "2:41 PM";
  it("describes each state quietly", () => {
    expect(draftStatusText({ ...base, saving: true, dirty: true }, time)).toBe("Saving…");
    expect(draftStatusText({ ...base, dirty: true }, time)).toBe("Unsaved changes");
    expect(draftStatusText({ ...base, dirty: true, error: "x" }, time)).toBe("Couldn't save");
    expect(draftStatusText({ ...base, hasDraft: true, savedAt: "2030-01-01T10:00:00.000Z" }, time)).toBe("Draft saved · 2:41 PM");
    expect(draftStatusText({ ...base, hasDraft: true, savedAt: "2030-01-01T10:00:00.000Z" }, null)).toBe("Draft saved");
    expect(draftStatusText(base, time)).toBe("Changes are saved as a draft automatically.");
  });
});
