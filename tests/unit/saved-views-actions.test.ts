import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  rateLimit: vi.fn(),
  resolve: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  rename: vi.fn(),
  share: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.rateLimit }));
vi.mock("@/lib/core/savedViews", () => ({
  resolveSavedViewAccess: mocks.resolve,
  listSavedViews: mocks.list,
  createSavedView: mocks.create,
  renameSavedView: mocks.rename,
  setSavedViewShared: mocks.share,
  deleteSavedView: mocks.remove,
}));

import { deleteView, renameView, saveView, shareView } from "@/app/actions/saved-views";

const scope = { organisationSlug: "club", eventId: "event_1", surface: "GUESTS_PEOPLE" };
const ctx = { userId: "user_1", organisationId: "org_1", orgSlug: "club", eventId: "event_1", surface: "GUESTS_PEOPLE", isAdmin: false };
const view = { id: "view_1", name: "Late", params: { status: "waitlist" }, shared: false, mine: true, canDelete: true, createdBy: "Asha" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "user_1" } });
  mocks.rateLimit.mockResolvedValue(false);
  mocks.resolve.mockResolvedValue(ctx);
  mocks.list.mockResolvedValue([view]);
  mocks.create.mockResolvedValue({ ok: true, data: view });
  mocks.rename.mockResolvedValue({ ok: true, data: view });
  mocks.share.mockResolvedValue({ ok: true, data: { ...view, shared: true } });
  mocks.remove.mockResolvedValue({ ok: true, data: { id: "view_1" } });
});

describe("saved view actions", () => {
  it("re-checks the surface permission for the event before saving, and returns the refreshed list", async () => {
    const res = await saveView({ ...scope, name: "Late", params: { status: "waitlist" }, shared: false, userId: "someone_else" });
    expect(mocks.rateLimit).toHaveBeenCalledWith("action", "user_1");
    expect(mocks.resolve).toHaveBeenCalledWith("user_1", "club", "event_1", "GUESTS_PEOPLE");
    expect(mocks.create).toHaveBeenCalledWith(ctx, { name: "Late", params: { status: "waitlist" }, shared: false });
    expect(res).toEqual({ ok: true, data: { view, views: [view] } });
  });

  it("refuses signed-out, rate-limited, unknown surfaces and callers without the surface permission", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    expect(await saveView({ ...scope, name: "x", params: {} })).toEqual({ ok: false, error: "You must be signed in." });

    mocks.rateLimit.mockResolvedValueOnce(true);
    expect(await renameView({ ...scope, viewId: "view_1", name: "x" })).toEqual({ ok: false, error: "Too many changes. Try again shortly." });

    expect(await shareView({ ...scope, surface: "EVERYTHING", viewId: "view_1", shared: true })).toEqual({ ok: false, error: "Invalid input." });

    mocks.resolve.mockResolvedValueOnce(null);
    expect(await deleteView({ ...scope, viewId: "view_1" })).toEqual({ ok: false, error: "You do not have permission to use views on this list." });

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.rename).not.toHaveBeenCalled();
    expect(mocks.share).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("passes only the view id and change to the cores", async () => {
    await renameView({ ...scope, viewId: "view_1", name: "Renamed" });
    expect(mocks.rename).toHaveBeenCalledWith(ctx, "view_1", "Renamed");
    await shareView({ ...scope, viewId: "view_1", shared: true });
    expect(mocks.share).toHaveBeenCalledWith(ctx, "view_1", true);
    await deleteView({ ...scope, viewId: "view_1" });
    expect(mocks.remove).toHaveBeenCalledWith(ctx, "view_1");
  });

  it("returns the core's error without listing", async () => {
    mocks.remove.mockResolvedValueOnce({ ok: false, error: "Only the person who saved this view can delete it." });
    expect(await deleteView({ ...scope, viewId: "view_2" })).toEqual({ ok: false, error: "Only the person who saved this view can delete it." });
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
