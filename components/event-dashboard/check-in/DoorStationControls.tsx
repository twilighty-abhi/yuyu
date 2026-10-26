"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import QRCode from "react-qr-code";
import { Copy, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createOrRotateCheckInStation, disableCheckInStation, revealCheckInStationPin } from "@/app/actions/checkin-station";
import { useToast } from "@/components/feedback/ToastProvider";
import { useActionErrorToast } from "@/components/auth/useActionErrorToast";

/*
 * Door station controls for the Check-in tab (organisation admins only). Uses
 * the same server actions as components/checkin/CheckInStationSettings, which
 * re-check admin role, recent sign-in and rate limits. The PIN only reaches
 * the browser when an admin explicitly asks for it and is kept in memory.
 */
export function DoorStationControls({ organisationSlug, eventId, stationUrl, enabled }: { organisationSlug: string; eventId: string; stationUrl: string; enabled: boolean }) {
  const router = useRouter();
  const { showToast } = useToast();
  const showActionError = useActionErrorToast();
  const [pending, startTransition] = useTransition();
  const [pin, setPin] = useState<string | null>(null);

  const copy = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showToast(message, "success");
    } catch {
      showToast("Could not copy to the clipboard.", "error");
    }
  };

  const generate = () =>
    startTransition(async () => {
      const result = await createOrRotateCheckInStation({ organisationSlug, eventId });
      if (!result.ok) return showActionError(result);
      setPin(result.data!.pin);
      showToast(enabled ? "Venue PIN rotated." : "Venue check-in station enabled.", "success");
      router.refresh();
    });

  const disable = () =>
    startTransition(async () => {
      const result = await disableCheckInStation({ organisationSlug, eventId });
      if (!result.ok) return showActionError(result);
      setPin(null);
      showToast("Venue check-in station disabled.", "success");
      router.refresh();
    });

  const reveal = () =>
    startTransition(async () => {
      const result = await revealCheckInStationPin({ organisationSlug, eventId });
      if (!result.ok) return showActionError(result);
      setPin(result.data!.pin);
    });

  if (!enabled) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-secondary">The station is off. Turn it on to get a link and a PIN for the door.</p>
        <Button variant="primary" size="sm" className="self-start" onClick={generate} loading={pending}>
          Turn on station
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3.5">
        <div className="w-24 shrink-0 rounded-lg border border-line bg-white p-1.5 leading-none">
          <QRCode value={stationUrl} size={84} bgColor="#FFFFFF" fgColor="#111111" level="M" title="Station link QR code" style={{ height: "auto", maxWidth: "100%", width: "100%" }} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
          <p className="flex flex-wrap items-center gap-x-2 text-ink">
            PIN
            {pin ? (
              <strong className="font-mono tracking-[0.2em]">{pin}</strong>
            ) : (
              <strong aria-label="Hidden" className="font-mono tracking-[0.2em] text-ink-secondary">• • • • • •</strong>
            )}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {pin ? (
              <>
                <Button size="sm" variant="secondary" startIcon={<Copy />} onClick={() => copy(pin, "PIN copied.")}>
                  Copy PIN
                </Button>
                <Button size="sm" variant="secondary" startIcon={<EyeOff />} onClick={() => setPin(null)}>
                  Hide
                </Button>
              </>
            ) : (
              <Button size="sm" variant="secondary" startIcon={<Eye />} onClick={reveal} disabled={pending}>
                Show PIN
              </Button>
            )}
            <Button size="sm" variant="secondary" startIcon={<Copy />} onClick={() => copy(stationUrl, "Station link copied.")}>
              Copy link
            </Button>
          </div>
        </div>
      </div>
      <p className="font-mono text-xs text-ink-muted [overflow-wrap:anywhere]">{stationUrl}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Button size="sm" variant="quiet" className="text-ink" onClick={generate} disabled={pending}>
          New PIN
        </Button>
        <Button size="sm" variant="dangerQuiet" onClick={disable} disabled={pending}>
          Turn off station
        </Button>
      </div>
      <span aria-live="polite" className="sr-only">{pending ? "Updating the station…" : ""}</span>
    </div>
  );
}
