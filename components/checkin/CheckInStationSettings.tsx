"use client";

import { useState, useTransition } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import QRCode from "react-qr-code";
import { createOrRotateCheckInStation, disableCheckInStation, revealCheckInStationPin } from "@/app/actions/checkin-station";
import { useToast } from "@/components/feedback/ToastProvider";
import { useActionErrorToast } from "@/components/auth/useActionErrorToast";

export function CheckInStationSettings({ organisationSlug, eventId, stationUrl, enabled }: { organisationSlug: string; eventId: string; stationUrl: string; enabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [pin, setPin] = useState<string | null>(null);
  const { showToast } = useToast();
  const showActionError = useActionErrorToast();
  const copy = async (value: string, message: string) => {
    try { await navigator.clipboard.writeText(value); showToast(message, "success"); } catch { showToast("Could not copy to the clipboard.", "error"); }
  };
  const generate = () => startTransition(async () => {
    const result = await createOrRotateCheckInStation({ organisationSlug, eventId });
    if (!result.ok) return showActionError(result);
    setPin(result.data!.pin);
    showToast(enabled ? "Venue PIN rotated." : "Venue check-in station enabled.", "success");
  });
  const disable = () => startTransition(async () => {
    const result = await disableCheckInStation({ organisationSlug, eventId });
    if (!result.ok) return showActionError(result);
    setPin(null);
    showToast("Venue check-in station disabled.", "success");
  });
  const reveal = () => startTransition(async () => {
    const result = await revealCheckInStationPin({ organisationSlug, eventId });
    if (!result.ok) return showActionError(result);
    setPin(result.data!.pin);
  });
  return (
    <section aria-labelledby="station-title" className="flex flex-col gap-3 rounded-lg border border-line bg-canvas p-5">
      <div>
        <h2 id="station-title" className="text-title text-ink">Venue check-in station</h2>
        <p className="mt-1 text-body-ui text-ink-secondary">Give trusted door staff the station link and PIN. It permits online check-in only; roster and CSV exports stay in this dashboard.</p>
      </div>
      {enabled ? (
        <div className="flex flex-col gap-2 rounded-md bg-subtle px-3 py-2 sm:flex-row sm:items-center">
          <p className="flex-1 font-mono text-sm text-ink [overflow-wrap:anywhere]">{stationUrl}</p>
          <Button size="sm" variant="quiet" startIcon={<Copy />} onClick={() => copy(stationUrl, "Station link copied.")}>Copy link</Button>
        </div>
      ) : null}
      {enabled ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="w-[156px] shrink-0 rounded-md border border-line bg-white p-2.5 leading-none">
            <QRCode value={stationUrl} size={132} bgColor="#FFFFFF" fgColor="#111111" level="M" style={{ height: "auto", maxWidth: "100%", width: "100%" }} />
          </div>
          <p className="text-body-ui text-ink-secondary">Scan this QR code on a venue device to open the check-in station quickly. Staff will still need the current PIN.</p>
        </div>
      ) : null}
      {pin ? (
        <Callout tone="warning" action={<Button size="sm" variant="secondary" startIcon={<Copy />} onClick={() => copy(pin, "PIN copied.")}>Copy</Button>}>
          PIN: <strong className="font-mono tracking-[0.12em]">{pin}</strong>. Organisation admins can use “Show PIN” here again until it is rotated or disabled.
        </Callout>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={generate} disabled={pending}>{enabled ? "Rotate PIN" : "Create station PIN"}</Button>
        {enabled ? <Button variant="secondary" onClick={reveal} disabled={pending}>Show PIN</Button> : null}
        {enabled ? <Button variant="dangerQuiet" onClick={disable} disabled={pending}>Disable station</Button> : null}
      </div>
    </section>
  );
}
