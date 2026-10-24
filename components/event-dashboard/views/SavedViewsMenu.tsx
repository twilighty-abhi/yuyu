"use client";

import { useState, useTransition } from "react";
import { Bookmark, Check, ChevronDown, Link2, Pencil, Plus, Settings2, Trash2, X } from "lucide-react";
import { deleteView, renameView, saveView, shareView, type SavedViewsActionData } from "@/app/actions/saved-views";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button, IconButton } from "@/components/ui/button";
import { CheckboxField, Switch } from "@/components/ui/choice";
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Chip, EmptyState } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import {
  SAVED_VIEW_NAME_MAX_LENGTH,
  presetsFor,
  sameViewParams,
  viewLink,
  type SavedViewDto,
  type SavedViewSurfaceKey,
  type ViewParams,
} from "@/lib/savedViews";

type Scope = { organisationSlug: string; eventId: string };
type ActionResult = { ok: true; data?: SavedViewsActionData } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * The "Views" menu on an event-dashboard list (docs/FEATURES.md, "Saved
 * views"): built-in presets, the viewer's own views and views teammates
 * shared, then Save current view, Manage views and Copy link. Applying a view
 * only sets the list's filters; every list re-checks permission on the
 * server, so a view never shows anything its viewer couldn't see anyway.
 */
export function SavedViewsMenu({
  surface,
  scope,
  params,
  onApply,
  initialViews,
  teamMode = false,
}: {
  surface: SavedViewSurfaceKey;
  scope: Scope;
  /** The list's current filters (sanitised). */
  params: ViewParams;
  onApply: (params: ViewParams) => void;
  initialViews: readonly SavedViewDto[];
  teamMode?: boolean;
}) {
  const { showToast } = useToast();
  const [views, setViews] = useState<readonly SavedViewDto[]>(initialViews);
  // A server refresh brings a new list (someone shared or deleted a view): adopt it.
  const [seenInitial, setSeenInitial] = useState(initialViews);
  if (seenInitial !== initialViews) {
    setSeenInitial(initialViews);
    setViews(initialViews);
  }
  const [saving, setSaving] = useState(false);
  const [managing, setManaging] = useState(false);
  const presets = presetsFor(surface, { teamMode });
  const mine = views.filter((view) => view.mine);
  const sharedWithMe = views.filter((view) => !view.mine);
  const filtered = Object.keys(params).length > 0;
  const active =
    presets.find((preset) => sameViewParams(surface, preset.params, params))?.label ??
    views.find((view) => sameViewParams(surface, view.params, params))?.name ??
    (filtered ? "Custom filters" : null);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(viewLink(window.location.href, surface, params));
      showToast("Link copied", "success");
    } catch {
      showToast("Could not copy", "error");
    }
  }

  const item = (key: string, label: string, viewParams: ViewParams, description?: string) => {
    const on = sameViewParams(surface, viewParams, params);
    return (
      <MenuItem key={key} onSelect={() => onApply(viewParams)} icon={on ? <Check /> : <span className="inline-block size-[18px]" />} description={description}>
        {label}
      </MenuItem>
    );
  };

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="secondary" size="sm" startIcon={<Bookmark />} endIcon={<ChevronDown />} aria-label={active ? `Views, showing ${active}` : "Views"}>
            <span className="max-w-[180px] truncate">{active ? `Views · ${active}` : "Views"}</span>
          </Button>
        </MenuTrigger>
        <MenuContent className="max-h-[min(70vh,520px)] w-[280px] overflow-y-auto">
          <MenuLabel>Presets</MenuLabel>
          {item("all", "All", {})}
          {presets.map((preset) => item(`preset:${preset.id}`, preset.label, preset.params))}
          {mine.length > 0 ? (
            <>
              <MenuSeparator />
              <MenuLabel>Your views</MenuLabel>
              {mine.map((view) => item(`view:${view.id}`, view.name, view.params, view.shared ? "Shared" : undefined))}
            </>
          ) : null}
          {sharedWithMe.length > 0 ? (
            <>
              <MenuSeparator />
              <MenuLabel>Shared views</MenuLabel>
              {sharedWithMe.map((view) => item(`view:${view.id}`, view.name, view.params, `By ${view.createdBy}`))}
            </>
          ) : null}
          <MenuSeparator />
          <MenuItem icon={<Plus />} disabled={!filtered} onSelect={() => setSaving(true)} description={filtered ? undefined : "Pick some filters first"}>
            Save current view…
          </MenuItem>
          {views.length > 0 ? (
            <MenuItem icon={<Settings2 />} onSelect={() => setManaging(true)}>
              Manage views…
            </MenuItem>
          ) : null}
          <MenuItem icon={<Link2 />} onSelect={() => void copyLink()}>
            Copy link
          </MenuItem>
          {filtered ? (
            <MenuItem icon={<X />} onSelect={() => onApply({})}>
              Clear filters
            </MenuItem>
          ) : null}
        </MenuContent>
      </Menu>

      <SaveViewDialog
        open={saving}
        onOpenChange={setSaving}
        onSave={async (name, shared) => {
          const res = (await saveView({ ...scope, surface, name, params, shared })) as ActionResult;
          if (res.ok && res.data) {
            setViews(res.data.views);
            showToast(shared ? "View saved and shared" : "View saved", "success");
          }
          return res;
        }}
      />

      <ManageViewsDialog
        open={managing}
        onOpenChange={setManaging}
        views={views}
        run={async (action) => {
          const res = (await action()) as ActionResult;
          if (!res.ok) {
            showToast(res.error, "error");
            return res;
          }
          if (res.data) setViews(res.data.views);
          return res;
        }}
        rename={(view, name) => renameView({ ...scope, surface, viewId: view.id, name })}
        share={(view, shared) => shareView({ ...scope, surface, viewId: view.id, shared })}
        remove={(view) => deleteView({ ...scope, surface, viewId: view.id })}
      />
    </>
  );
}

function SaveViewDialog({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string, shared: boolean) => Promise<ActionResult>;
}) {
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  function close(next: boolean) {
    if (pending) return;
    if (!next) {
      setName("");
      setShared(false);
      setError(undefined);
    }
    onOpenChange(next);
  }
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="sm">
        <DialogHeader title="Save view" description="Save these filters and search so you can come back to them in one click." />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError(undefined);
            startTransition(async () => {
              const res = await onSave(name, shared);
              if (!res.ok) {
                setError(res.fieldErrors?.name?.[0] ?? res.error);
                return;
              }
              setName("");
              setShared(false);
              onOpenChange(false);
            });
          }}
        >
          <DialogBody className="flex flex-col gap-4">
            <Field label="Name" error={error} helperText={`Up to ${SAVED_VIEW_NAME_MAX_LENGTH} characters.`}>
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={SAVED_VIEW_NAME_MAX_LENGTH} autoComplete="off" autoFocus required />
            </Field>
            <CheckboxField
              label="Share with the team"
              description="Everyone who can open this list on this event will see the view. It never gives anyone more access."
              checked={shared}
              onCheckedChange={(value) => setShared(value === true)}
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => close(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending} loadingLabel="Saving…" disabled={!name.trim()}>
              Save view
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ManageViewsDialog({
  open,
  onOpenChange,
  views,
  run,
  rename,
  share,
  remove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  views: readonly SavedViewDto[];
  run: (action: () => Promise<unknown>) => Promise<ActionResult>;
  rename: (view: SavedViewDto, name: string) => Promise<unknown>;
  share: (view: SavedViewDto, shared: boolean) => Promise<unknown>;
  remove: (view: SavedViewDto) => Promise<unknown>;
}) {
  const { showToast } = useToast();
  const [editing, setEditing] = useState<{ id: string; name: string; error?: string } | null>(null);
  const [deleting, setDeleting] = useState<SavedViewDto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function act(key: string, action: () => Promise<unknown>, success?: string, after?: (res: ActionResult) => void) {
    setBusy(key);
    startTransition(async () => {
      const res = await run(action);
      setBusy(null);
      if (res.ok && success) showToast(success, "success");
      after?.(res);
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="md">
          <DialogHeader title="Manage views" description="Rename, share or delete your views. Owners and admins can also delete views others shared." />
          <DialogBody>
            {views.length === 0 ? (
              <EmptyState>No saved views yet.</EmptyState>
            ) : (
              <ul aria-label="Saved views" className="flex flex-col divide-y divide-line">
                {views.map((view) => (
                  <li key={view.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3">
                    {editing?.id === view.id ? (
                      <form
                        className="flex min-w-0 flex-1 items-start gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          act(`rename:${view.id}`, () => rename(view, editing.name), "View renamed", (res) => {
                            if (res.ok) setEditing(null);
                            else setEditing({ ...editing, error: res.fieldErrors?.name?.[0] ?? res.error });
                          });
                        }}
                      >
                        <Field label={`New name for ${view.name}`} hideLabel error={editing.error} className="min-w-0 flex-1">
                          <Input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} maxLength={SAVED_VIEW_NAME_MAX_LENGTH} autoFocus />
                        </Field>
                        <Button type="submit" size="sm" variant="primary" loading={busy === `rename:${view.id}`} loadingLabel="Saving…" disabled={!editing.name.trim()}>
                          Save
                        </Button>
                        <Button size="sm" variant="quiet" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </form>
                    ) : (
                      <div className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-ink">{view.name}</span>
                        <span className="flex flex-wrap items-center gap-1.5 text-caption text-ink-muted">
                          {view.mine ? "Yours" : `By ${view.createdBy}`}
                          {view.shared ? (
                            <Chip size="sm" tone="accent">
                              Shared
                            </Chip>
                          ) : null}
                        </span>
                      </div>
                    )}
                    {editing?.id === view.id ? null : (
                      <div className="flex items-center gap-1.5">
                        {view.mine ? (
                          <>
                            <label className="flex items-center gap-2 text-caption text-ink-secondary">
                              <Switch
                                checked={view.shared}
                                disabled={busy != null}
                                aria-label={`Share ${view.name} with the team`}
                                onCheckedChange={(on) => act(`share:${view.id}`, () => share(view, on), on ? "View shared" : "View no longer shared")}
                              />
                              <span aria-hidden>Share</span>
                            </label>
                            <IconButton label={`Rename ${view.name}`} size="sm" onClick={() => setEditing({ id: view.id, name: view.name })} disabled={busy != null}>
                              <Pencil />
                            </IconButton>
                          </>
                        ) : null}
                        {view.canDelete ? (
                          <IconButton label={`Delete ${view.name}`} size="sm" variant="danger" onClick={() => setDeleting(view)} disabled={busy != null}>
                            <Trash2 />
                          </IconButton>
                        ) : null}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting != null}
        title="Delete this view?"
        message={deleting ? (deleting.mine ? `"${deleting.name}" will be removed${deleting.shared ? " for everyone it was shared with" : ""}.` : `"${deleting.name}" was shared by ${deleting.createdBy}. It will be removed for everyone.`) : undefined}
        confirmLabel="Delete view"
        loading={deleting != null && busy === `delete:${deleting.id}`}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          const view = deleting;
          act(`delete:${view.id}`, () => remove(view), "View deleted", () => setDeleting(null));
        }}
      />
    </>
  );
}
