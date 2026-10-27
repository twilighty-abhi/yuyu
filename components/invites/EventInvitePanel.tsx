"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Avatar, Callout, EmptyState } from "@/components/ui/display";
import { formatDate, formatRelativeTime } from "@/lib/format/datetime";
import { Input, SearchInput } from "@/components/ui/field";
import { addEventInvite, loadInvitesPage, removeEventInvite } from "@/app/actions/invites";
import { useToast } from "@/components/feedback/ToastProvider";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";
import { PageNumberPager } from "@/components/ui/page-number-pager";
import { useDebouncedValue } from "@/components/event-dashboard/guests/useServerPages";
import type { EventInvitesPage } from "@/lib/eventDashboard/invites";

const SEARCH_DELAY_MS = 300;
// A request that throws (such as a dropped connection) shows an error instead of loading forever.
const LOAD_FAILED = { ok: false as const, error: "Couldn't load the list. Try again." };

/**
 * Guests · Invites. Numbered pages of 50, newest first, searched by email on
 * the server (`loadInvitesPage`, the same MANAGE_INVITATIONS check as adding
 * an invite). After an add or a remove the server refresh re-reads the page
 * being shown.
 */
export function EventInvitePanel(props: {
  organisationSlug: string;
  eventId: string;
  eventHasEnded: boolean;
  /** The first page with no search, and the totals. */
  initialPage: EventInvitesPage;
  /** Event timezone for "Invited …" labels. */
  timeZone?: string;
  /** Server render time (ISO) so relative labels match between server and client. */
  now?: string;
}) {
  const { organisationSlug, eventId, eventHasEnded, initialPage, timeZone = "UTC", now } = props;
  const router = useRouter();
  const { showToast } = useToast();
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();
  const [removeTarget, setRemoveTarget] = useState<{
    id: string;
    email: string;
  } | null>(null);

  const [query, setQuery] = useState("");
  const searched = useDebouncedValue(query.trim(), SEARCH_DELAY_MS);
  // A page number belongs to the search it was chosen under; a new search starts at page 1.
  const [paging, setPaging] = useState({ query: "", page: 1 });
  const page = paging.query === searched ? paging.page : 1;
  const [data, setData] = useState<EventInvitesPage>(initialPage);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const seq = useRef(0);

  // The default view (page 1, no search) is the server's first page; anything
  // else is fetched. A server refresh (new `initialPage`) re-reads the view.
  useEffect(() => {
    const mine = ++seq.current;
    const timer = window.setTimeout(async () => {
      if (page === 1 && !searched) {
        setLoading(false);
        setListError(null);
        setData(initialPage);
        return;
      }
      setLoading(true);
      setListError(null);
      const res = await loadInvitesPage({ organisationSlug, eventId, query: searched, page }).catch(() => LOAD_FAILED);
      if (mine !== seq.current) return;
      setLoading(false);
      if (!res.ok || !res.data) {
        setListError(res.ok ? "Could not load invites." : res.error);
        return;
      }
      setData(res.data);
      // The page asked for can be past the end after a removal; follow the server.
      if (res.data.page !== page) setPaging({ query: searched, page: res.data.page });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [organisationSlug, eventId, searched, page, initialPage]);

  const invites = data.invites;
  const first = data.matching === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const last = (data.page - 1) * data.pageSize + invites.length;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-h4 text-ink">Invites</h2>
        <p className="text-body-ui text-ink-muted">
          {eventHasEnded
            ? "This event has ended, so no new invites can be sent."
            : "Required for invite-only events. Emails are matched case-insensitively."}
        </p>
      </div>
      <form
        className="flex flex-col gap-2.5 sm:flex-row sm:items-center"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const res = await addEventInvite({
              organisationSlug,
              eventId,
              email,
            });
            if (!res.ok) {
              showToast(res.error, "error");
              return;
            }
            setEmail("");
            showToast("Invite added", "success");
            router.refresh();
          });
        }}
      >
        <label htmlFor="event-invite-email" className="sr-only">Email address to invite</label>
        <div className="min-w-0 sm:w-[360px]">
          <Input
            id="event-invite-email"
            type="email"
            placeholder="name@example.org"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={eventHasEnded || pending}
          />
        </div>
        <Button type="submit" variant="primary" startIcon={<Plus />} loading={pending && !removeTarget} disabled={eventHasEnded || pending}>
          Add
        </Button>
      </form>
      {data.total > 0 ? (
        <div className="w-full min-w-0 sm:w-[300px]">
          <label htmlFor="event-invite-search" className="sr-only">Search invites by email</label>
          <SearchInput
            id="event-invite-search"
            placeholder="Search invited emails"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery("")}
            autoComplete="off"
            className="py-2 sm:text-sm"
          />
        </div>
      ) : null}
      {listError ? <Callout tone="danger" role="alert">{listError}</Callout> : null}
      {data.total === 0 ? (
        <EmptyState mood="sleepy" title="No invites yet.">
          {eventHasEnded ? null : "Add an email address to let that person register."}
        </EmptyState>
      ) : invites.length === 0 ? (
        <EmptyState>{searched ? "No invites match that search." : "No invites on this page."}</EmptyState>
      ) : (
        <ul aria-label="Invited emails" aria-busy={loading} className="flex flex-col gap-2">
          {invites.map((inv) => (
            <li key={inv.id} className="flex min-w-0 items-center gap-3.5 rounded-xl border border-line bg-canvas px-4 py-3">
              <Avatar name={inv.email} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-ink">{inv.email}</p>
                <p className="text-caption text-ink-muted">Invited {invitedWhen(inv.createdAt, timeZone, now)}</p>
              </div>
              <IconButton label={`Remove invite for ${inv.email}`} variant="danger" size="sm" disabled={pending} onClick={() => setRemoveTarget(inv)}>
                <Trash2 />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      {invites.length > 0 ? (
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
          <span className="text-sm text-ink-secondary" aria-live="polite">
            Showing {first}–{last} of {data.matching} {data.matching === 1 ? "invite" : "invites"}
          </span>
          <PageNumberPager
            label="Invite pages"
            page={data.page}
            totalPages={data.pageCount}
            disabled={loading}
            onPage={(next) => setPaging({ query: searched, page: next })}
          />
        </div>
      ) : null}
      <ConfirmationDialog
        open={Boolean(removeTarget)}
        title="Remove event invite?"
        message={`Remove ${removeTarget?.email ?? "this email"} from the event allowlist?`}
        confirmLabel="Remove invite"
        loading={pending}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => {
          if (!removeTarget) return;
          startTransition(async () => {
            const res = await removeEventInvite({
              organisationSlug,
              eventId,
              inviteId: removeTarget.id,
            });
            if (!res.ok) return showToast(res.error, "error");
            setRemoveTarget(null);
            showToast("Invite removed", "success");
            router.refresh();
          });
        }}
      />
    </div>
  );
}

function invitedWhen(createdAt: string, timeZone: string, now?: string) {
  const label = formatRelativeTime(createdAt, timeZone, now);
  return label === formatDate(createdAt, timeZone) ? `on ${label}` : `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}
