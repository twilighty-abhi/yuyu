import { NavTabs } from "@/components/ui/tabs";
import { ManageCheckInListsDialog, type ManagedCheckInList } from "@/components/checkin/ManageCheckInListsDialog";

/*
 * "Entry" (the venue door, unchanged) plus the event's open custom check-in
 * lists, as link tabs so each list has its own address (`?list=<id>`).
 */
export function CheckInListSwitcher({ deskPath, lists, selectedId, manage }: {
  deskPath: string;
  lists: Array<{ id: string; name: string; collected: number; eligible: number }>;
  selectedId: string | null;
  manage: { organisationSlug: string; eventId: string; lists: ManagedCheckInList[] } | null;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 flex-1">
        <NavTabs
          label="Check-in list"
          items={[
            { href: deskPath, label: "Entry", active: selectedId === null },
            ...lists.map((list) => ({
              href: `${deskPath}?list=${encodeURIComponent(list.id)}`,
              label: (
                <span className="inline-flex items-baseline gap-1.5">
                  {list.name}
                  <span className="text-caption font-semibold text-ink-muted">
                    {list.collected}/{list.eligible}
                  </span>
                </span>
              ),
              active: selectedId === list.id,
            })),
          ]}
        />
      </div>
      {manage ? (
        <div className="shrink-0">
          <ManageCheckInListsDialog organisationSlug={manage.organisationSlug} eventId={manage.eventId} lists={manage.lists} />
        </div>
      ) : null}
    </div>
  );
}
