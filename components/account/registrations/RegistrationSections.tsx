import type { ReactNode } from "react";
import Link from "next/link";
import { Award, ExternalLink, Globe, MapPin, Send, Ticket, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip, DateBlock, EmptyState } from "@/components/ui/display";
import { cn } from "@/lib/cn";
import type { AccountCertificateRow, AccountRegistrationRow } from "@/lib/accountRegistrations";
import { GalleryPagination } from "@/components/event/GalleryPagination";
import { CancelRegistrationButton } from "./CancelRegistrationButton";

export const accountSectionCard = "rounded-2xl border border-line bg-canvas p-5 sm:p-6";

export function AccountSection({ id, title, description, children, className }: { id: string; title: ReactNode; description: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn(accountSectionCard, className)}>
      <h2 id={`${id}-title`} className="text-h4 text-ink">{title}</h2>
      <p className="mt-0.5 text-body-ui text-ink-muted">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function DiscoverAction() {
  return (
    <Button asChild variant="secondary" size="sm">
      <Link href="/discover">Discover events</Link>
    </Button>
  );
}

function RegistrationItem({ row, past }: { row: AccountRegistrationRow; past: boolean }) {
  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 gap-3.5">
        <DateBlock month={row.dateBlock.month} day={row.dateBlock.day} tone={past ? "ink" : "accent"} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="break-words text-label text-ink">{row.title}</p>
          <p className="truncate text-sm text-ink-secondary">{row.organisationName}</p>
          <p className="mt-1 text-sm text-ink-muted">
            <span className="whitespace-nowrap">{row.dateLabel}</span>
            <span aria-hidden> · </span>
            <span>{row.timeLabel}</span>
          </p>
          {row.isOnline || row.location ? (
            <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-ink-muted">
              {row.isOnline ? <Globe aria-hidden className="size-3.5 shrink-0" /> : <MapPin aria-hidden className="size-3.5 shrink-0" />}
              <span className="truncate">{row.isOnline ? "Online" : row.location}</span>
            </p>
          ) : null}
          {row.team ? (
            <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-ink-muted">
              <Users aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">{row.team.isLeader ? `Leading ${row.team.name}` : `In team ${row.team.name}`}</span>
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip tone={row.status.tone} size="sm">{row.status.label}</Chip>
            {row.isSeries ? <Chip tone="outline" size="sm">Series</Chip> : null}
            {row.eventCancelled ? <Chip tone="danger" size="sm">Event cancelled</Chip> : null}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5 pl-[64px] sm:shrink-0 sm:justify-end sm:pl-0">
        {row.ticketHref ? (
          <Button asChild variant="secondary" size="sm">
            {/* The opaque token is only in the href, never rendered as text; no prefetch of ticket pages. */}
            <Link href={row.ticketHref} prefetch={false} rel="noreferrer">
              <Ticket aria-hidden className="size-4" />
              View ticket
            </Link>
          </Button>
        ) : null}
        {row.team?.manageHref && !past ? (
          <Button asChild variant="secondary" size="sm">
            <Link href={row.team.manageHref} prefetch={false}>
              <Users aria-hidden className="size-4" />
              Manage team
            </Link>
          </Button>
        ) : null}
        {row.submissionHref ? (
          <Button asChild variant="secondary" size="sm">
            <Link href={row.submissionHref} prefetch={false}>
              <Send aria-hidden className="size-4" />
              {row.team ? "Team project" : "Project"}
            </Link>
          </Button>
        ) : null}
        {row.eventHref ? (
          <Button asChild variant="quiet" size="sm">
            <Link href={row.eventHref}>
              Event page
              <ExternalLink aria-hidden className="size-3.5" />
            </Link>
          </Button>
        ) : null}
        {row.cancelToken ? <CancelRegistrationButton cancelToken={row.cancelToken} eventTitle={row.title} /> : null}
      </div>
    </li>
  );
}

export function RegistrationList({ rows, past, emptyTitle, emptyBody, footer }: { rows: AccountRegistrationRow[]; past: boolean; emptyTitle: string; emptyBody: string; footer?: ReactNode }) {
  if (!rows.length) {
    return (
      <EmptyState mood="sleepy" title={emptyTitle} action={<DiscoverAction />} className="rounded-xl border-dashed">
        {emptyBody}
      </EmptyState>
    );
  }
  return (
    <>
      <ul className="flex flex-col divide-y divide-line">
        {rows.map((row) => <RegistrationItem key={row.id} row={row} past={past} />)}
      </ul>
      {footer}
    </>
  );
}

export function CertificateList({ rows, footer }: { rows: AccountCertificateRow[]; footer?: ReactNode }) {
  if (!rows.length) {
    return (
      <EmptyState mood="sleepy" title="No certificates yet" action={<DiscoverAction />} className="rounded-xl border-dashed">
        When an event offers a certificate, it appears here after you submit the feedback form.
      </EmptyState>
    );
  }
  return (
    <>
    <ul className="flex flex-col divide-y divide-line">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-col gap-2 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span aria-hidden className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-ink-secondary">
              <Award className="size-[18px]" />
            </span>
            <div className="min-w-0">
              <p className="break-words text-label text-ink">{row.title}</p>
              <p className="truncate text-sm text-ink-muted">{row.organisationName} · Issued {row.issuedLabel}</p>
            </div>
          </div>
          <div className="pl-12 sm:pl-0">
            <Button asChild variant="secondary" size="sm">
              {/* A download route, so a plain anchor: no client navigation or prefetch. */}
              <a href={row.certificateHref} rel="noreferrer" aria-label={`View certificate for ${row.title}`}>View certificate</a>
            </Button>
          </div>
        </li>
      ))}
    </ul>
    {footer}
    </>
  );
}

/**
 * "Showing 51–100 of 140" and page-number links for one section. Plain links
 * (`?past=2#past`), so a page can be shared or reloaded; renders nothing for
 * a single page.
 */
export function SectionPager({
  label,
  pagination,
  hrefFor,
}: {
  label: string;
  pagination: { page: number; totalPages: number; total: number; pageSize: number };
  hrefFor: (page: number) => string;
}) {
  if (pagination.totalPages <= 1) return null;
  const first = (pagination.page - 1) * pagination.pageSize + 1;
  const last = Math.min(pagination.total, pagination.page * pagination.pageSize);
  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
      <p className="text-center text-sm text-ink-muted">
        Showing {first}–{last} of {pagination.total}
      </p>
      <GalleryPagination page={pagination.page} totalPages={pagination.totalPages} hrefFor={hrefFor} label={label} />
    </div>
  );
}
