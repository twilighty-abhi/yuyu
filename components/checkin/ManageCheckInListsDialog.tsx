"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArrowDown, ArrowUp, ListChecks, Plus, RotateCcw } from "lucide-react";
import { createCheckInList, reorderCheckInLists, updateCheckInList } from "@/app/actions/checkin-lists";
import { Button, IconButton } from "@/components/ui/button";
import { Switch, SwitchRow } from "@/components/ui/choice";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/feedback/ToastProvider";
import { CHECK_IN_LIST_NAME_MAX } from "@/lib/checkInLists";

export type ManagedCheckInList = { id: string; name: string; archived: boolean; requiresEntryCheckIn: boolean };

/*
 * Create, rename, reorder, archive and restore an event's custom check-in
 * lists. Shown only to organisation admins and `EDIT_DETAILS` co-organisers;
 * every action re-checks that on the server (lib/core/checkinLists.ts).
 */
export function ManageCheckInListsDialog({ organisationSlug, eventId, lists, triggerLabel = "Manage lists" }: {
  organisationSlug: string;
  eventId: string;
  lists: ManagedCheckInList[];
  triggerLabel?: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");
  const [newRequiresEntry, setNewRequiresEntry] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const active = lists.filter((list) => !list.archived);
  const archived = lists.filter((list) => list.archived);
  const target = { organisationSlug, eventId };

  const run = (work: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) => {
    startTransition(async () => {
      const res = await work();
      if (!res.ok) {
        setStatus(res.error ?? "Something went wrong.");
        showToast(res.error ?? "Something went wrong.", "error");
        return;
      }
      setStatus(success);
      after?.();
      router.refresh();
    });
  };

  const create = () => {
    const name = newName.trim();
    if (!name) return;
    run(() => createCheckInList({ ...target, name, requiresEntryCheckIn: newRequiresEntry }), `Added ${name}.`, () => {
      setNewName("");
      setNewRequiresEntry(false);
    });
  };

  const rename = (list: ManagedCheckInList) => {
    const name = (drafts[list.id] ?? list.name).trim();
    if (!name || name === list.name) return;
    run(() => updateCheckInList({ ...target, listId: list.id, name }), `Renamed to ${name}.`, () => setDrafts((current) => {
      const next = { ...current };
      delete next[list.id];
      return next;
    }));
  };

  const move = (index: number, delta: -1 | 1) => {
    const order = active.map((list) => list.id);
    const swap = index + delta;
    if (swap < 0 || swap >= order.length) return;
    [order[index], order[swap]] = [order[swap]!, order[index]!];
    run(() => reorderCheckInLists({ ...target, listIds: order }), "Order saved.");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" startIcon={<ListChecks />}>{triggerLabel}</Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader title="Check-in lists" description="Track who has collected or attended something beyond entry, like swag, lunch or a workshop." />
        <DialogBody className="flex flex-col gap-5">
          <p role="status" aria-live="polite" className="sr-only">{status}</p>
          <form
            className="flex flex-col gap-3 rounded-lg border border-line bg-subtle p-4"
            onSubmit={(event) => {
              event.preventDefault();
              create();
            }}
          >
            <label htmlFor="new-check-in-list" className="text-label text-ink">New list</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input id="new-check-in-list" placeholder="Swag collection" maxLength={CHECK_IN_LIST_NAME_MAX} value={newName} onChange={(event) => setNewName(event.target.value)} disabled={pending} />
              <Button type="submit" variant="primary" startIcon={<Plus />} disabled={pending || !newName.trim()}>Add list</Button>
            </div>
            <SwitchRow label="Only after entry check-in" description="Guests must be checked in at the door first." checked={newRequiresEntry} onCheckedChange={setNewRequiresEntry} disabled={pending} />
          </form>

          {active.length === 0 ? (
            <p className="text-body-ui text-ink-muted">No lists yet. Entry check-in works as before.</p>
          ) : (
            <ul aria-label="Open lists" className="flex flex-col gap-3">
              {active.map((list, index) => {
                const draft = drafts[list.id] ?? list.name;
                const renameId = `rename-${list.id}`;
                const entryId = `entry-${list.id}`;
                return (
                  <li key={list.id} className="flex flex-col gap-3 rounded-lg border border-line bg-canvas p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <label htmlFor={renameId} className="sr-only">Name of {list.name}</label>
                      <Input
                        id={renameId}
                        value={draft}
                        maxLength={CHECK_IN_LIST_NAME_MAX}
                        onChange={(event) => setDrafts((current) => ({ ...current, [list.id]: event.target.value }))}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            rename(list);
                          }
                        }}
                        disabled={pending}
                      />
                      <div className="flex items-center gap-1.5">
                        {draft.trim() && draft.trim() !== list.name ? (
                          <Button size="sm" variant="primary" onClick={() => rename(list)} disabled={pending}>Save name</Button>
                        ) : null}
                        <IconButton size="sm" variant="secondary" label={`Move ${list.name} up`} onClick={() => move(index, -1)} disabled={pending || index === 0}><ArrowUp /></IconButton>
                        <IconButton size="sm" variant="secondary" label={`Move ${list.name} down`} onClick={() => move(index, 1)} disabled={pending || index === active.length - 1}><ArrowDown /></IconButton>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <Switch
                          id={entryId}
                          checked={list.requiresEntryCheckIn}
                          onCheckedChange={(checked) => run(() => updateCheckInList({ ...target, listId: list.id, requiresEntryCheckIn: checked }), checked ? `${list.name} now needs entry check-in first.` : `${list.name} no longer needs entry check-in.`)}
                          disabled={pending}
                        />
                        <label htmlFor={entryId} className="text-sm text-ink">Only after entry check-in</label>
                      </div>
                      <Button size="sm" variant="quiet" startIcon={<Archive />} onClick={() => run(() => updateCheckInList({ ...target, listId: list.id, archived: true }), `Archived ${list.name}.`)} disabled={pending}>
                        Archive
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {archived.length > 0 ? (
            <section aria-labelledby="archived-lists-title" className="flex flex-col gap-2">
              <h3 id="archived-lists-title" className="text-label text-ink">Archived</h3>
              <p className="text-caption text-ink-muted">Archived lists keep their check-ins and stay in the attendee export, but are read-only and hidden from the desk.</p>
              <ul aria-label="Archived lists" className="flex flex-col divide-y divide-line rounded-lg border border-line px-3">
                {archived.map((list) => (
                  <li key={list.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 truncate text-sm text-ink-secondary">{list.name}</span>
                    <Button size="sm" variant="quiet" startIcon={<RotateCcw />} onClick={() => run(() => updateCheckInList({ ...target, listId: list.id, archived: false }), `Restored ${list.name}.`)} disabled={pending}>
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
