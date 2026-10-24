"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { RsvpStatus } from "@prisma/client";
import { ArrowRight, Share2 } from "lucide-react";
import { RsvpForm } from "@/components/rsvp/RsvpForm";
import type { RegistrationFieldDefinition } from "@/components/rsvp/registrationTypes";
import type { TeamRegistrationConfig } from "@/components/rsvp/TeamRegistrationFields";
import { Button } from "@/components/ui/button";
import { Callout, Chip, OrgLogo, ProgressBar } from "@/components/ui/display";
import { Dialog, DialogBody, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { accentStyle } from "@/lib/theme/accent";
import { registrationActionLabel } from "@/lib/registrationLabel";

type RegistrationState = {
  cancelled: boolean;
  open: boolean;
  /** At or over capacity: new registrations join the waitlist. */
  full: boolean;
  approvalRequired: boolean;
};

const statusLabels: Partial<Record<RsvpStatus, { chip: string; tone: "success" | "warning" | "neutral"; action: string }>> = {
  CONFIRMED: { chip: "You're in", tone: "success", action: "View your ticket" },
  WAITLISTED: { chip: "On the waitlist", tone: "warning", action: "View waitlist status" },
  PENDING_APPROVAL: { chip: "Waiting for approval", tone: "warning", action: "View approval status" },
};

function useSavedRsvp(storageKey: string) {
  const [saved, setSaved] = useState<{ token: string; status: RsvpStatus | null } | null>(null);
  useEffect(() => {
    const read = () => {
      try {
        const raw = window.localStorage.getItem(storageKey);
        const parsed = raw ? (JSON.parse(raw) as { ticketToken?: string; status?: RsvpStatus }) : null;
        setSaved(parsed?.ticketToken ? { token: parsed.ticketToken, status: parsed.status ?? null } : null);
      } catch {
        setSaved(null);
      }
    };
    const timer = window.setTimeout(read, 0);
    window.addEventListener("pageshow", read);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pageshow", read);
    };
  }, [storageKey]);
  return [saved, setSaved] as const;
}

/**
 * Event registration card (docs/DESIGN.md §4.10) with a sticky mobile
 * Register bar. Registration itself is unchanged: the same RSVP form in a
 * dialog, and a remembered ticket link in this browser.
 */
export function RegistrationCard(props: {
  orgSlug: string;
  eventSlug?: string;
  eventInstanceId?: string;
  eventTitle: string;
  organisation: { name: string; slug: string; logoUrl: string | null };
  registrationFields: RegistrationFieldDefinition[];
  confirmedCount: number | null;
  capacity: number | null;
  state: RegistrationState;
  title?: string;
  /** The event's accent. The sign-up dialog renders in a portal outside the page's accent scope, so it re-applies it. */
  accentColor?: string | null;
  /** Team event settings (docs/TEAMS.md): counts become places (one per team or solo entrant). */
  team?: TeamRegistrationConfig | null;
}) {
  const { orgSlug, eventSlug, eventInstanceId, eventTitle, organisation, registrationFields, confirmedCount, capacity, state, accentColor, team } = props;
  const storageKey = eventInstanceId ? `yuyu:rsvp:${orgSlug}:i:${eventInstanceId}` : `yuyu:rsvp:${orgSlug}:e:${eventSlug ?? ""}`;
  const [saved, setSaved] = useSavedRsvp(storageKey);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [shared, setShared] = useState(false);
  const [cardVisible, setCardVisible] = useState(true);
  const cardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = cardRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setCardVisible(Boolean(entry?.isIntersecting)), { rootMargin: "0px 0px -40px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: eventTitle, url: location.href });
      else await navigator.clipboard.writeText(location.href);
      setShared(true);
    } catch {
      /* sharing cancelled */
    }
  };

  const savedLabel = saved ? statusLabels[saved.status ?? "CONFIRMED"] ?? { chip: "Registered", tone: "neutral" as const, action: "View registration" } : null;
  const registerLabel = registrationActionLabel(state, team ?? null);
  const spotsLeft = capacity != null && confirmedCount != null ? Math.max(0, capacity - confirmedCount) : null;

  const primaryAction = state.cancelled ? null : saved && savedLabel ? (
    <Button asChild variant="accent" size="lg" fullWidth>
      <Link href={`/ticket/${saved.token}`}>{savedLabel.action}</Link>
    </Button>
  ) : state.open ? (
    <Button variant="accent" size="lg" fullWidth onClick={() => setDialogOpen(true)}>
      {registerLabel}
    </Button>
  ) : (
    <Button variant="accent" size="lg" fullWidth disabled>
      Registration closed
    </Button>
  );

  return (
    <>
      <section ref={cardRef} aria-labelledby="join-title" className="flex flex-col gap-4 rounded-xl border border-line bg-canvas p-5 shadow-raised">
        <div className="flex items-center justify-between gap-2">
          <h2 id="join-title" className="text-h3 text-ink">{props.title ?? "Join this event"}</h2>
          {saved && savedLabel ? <Chip tone={savedLabel.tone}>{savedLabel.chip}</Chip> : state.full && state.open ? <Chip tone="warning">Full</Chip> : null}
        </div>
        {confirmedCount != null ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-semibold text-ink">{team ? `${confirmedCount} ${confirmedCount === 1 ? "place" : "places"} taken` : `${confirmedCount} going`}</span>
              {spotsLeft != null ? <span className="text-ink-muted">{spotsLeft} {team ? (spotsLeft === 1 ? "place" : "places") : spotsLeft === 1 ? "spot" : "spots"} left</span> : null}
            </div>
            {capacity != null ? <ProgressBar value={confirmedCount} max={capacity} label="Places taken" /> : null}
            {team ? <p className="text-caption text-ink-muted">{team.soloPolicy === "TEAMS_ONLY" ? "Each team takes one place." : "Each team, and each solo entrant, takes one place."}</p> : null}
          </div>
        ) : null}
        {state.cancelled ? <Callout tone="danger" title="Event cancelled" /> : null}
        {primaryAction}
        {!state.cancelled && !state.open && !saved ? <p className="-mt-2 text-caption text-ink-muted">Registration is closed.</p> : null}
        <Button variant="secondary" fullWidth onClick={share}>
          <Share2 aria-hidden className="size-[18px]" />
          {shared ? "Link copied" : "Share"}
        </Button>
      </section>

      <Link href={`/${organisation.slug}`} className="mt-3 flex items-center gap-3 rounded-lg border border-line bg-canvas p-4 transition-colors hover:bg-subtle">
        <OrgLogo name={organisation.name} src={organisation.logoUrl} size="md" />
        <span className="min-w-0 flex-1">
          <span className="block text-caption text-ink-muted">Hosted by</span>
          <span className="block truncate text-[15px] font-semibold text-ink">{organisation.name}</span>
        </span>
        <ArrowRight aria-hidden className="size-4 text-ink-muted" />
      </Link>

      {primaryAction && !cardVisible ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/95 p-3 backdrop-blur-md md:hidden">
          {primaryAction}
        </div>
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent size="md" style={accentStyle(accentColor)} className="yy-accent-scope">
          <DialogHeader
            title={`Register for ${eventTitle}`}
            description={
              team
                ? team.soloPolicy === "TEAMS_ONLY"
                  ? "Create a team or join one with its link. Each team takes one place. We'll email your ticket."
                  : "Create a team, join one with its link, or take part on your own. We'll email your ticket."
                : "Free to attend. We'll email your ticket."
            }
          />
          <DialogBody className="pb-6">
            <RsvpForm
              orgSlug={orgSlug}
              eventSlug={eventSlug}
              eventInstanceId={eventInstanceId}
              registrationFields={registrationFields}
              team={team}
              onRsvpSaved={({ ticketToken, status, teamMode }) => {
                if (ticketToken) setSaved({ token: ticketToken, status });
                // A new team leader needs the form's done message (the team page
                // link is on its way by email), so that dialog stays open.
                // Otherwise close it and let the card switch to the ticket link.
                if (teamMode !== "create") setDialogOpen(false);
              }}
            />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
