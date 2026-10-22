"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import type { RsvpStatus } from "@prisma/client";
import { useRouter } from "next/navigation";
import { Check, CloudCheck, CloudOff, Download, Info, Printer, RefreshCw, Search, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Switch } from "@/components/ui/choice";
import { Callout, Chip, ProgressBar, type ChipTone } from "@/components/ui/display";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/menu";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { DotFace } from "@/components/brand/DotFace";
import {
  checkInByRsvpId,
  downloadOfflineCheckInRoster,
  lookupAttendeesForCheckIn,
  previewCheckInByRsvpId,
  previewCheckInByToken,
  syncOfflineCheckIns,
  undoCheckIn,
  type CheckInPreviewData,
  type CheckInResultData,
  type LookupRow,
} from "@/app/actions/checkin";
import { gateCheckInForStatus, parseCheckInPayload } from "@/lib/checkIn";
import {
  getOfflineRoster,
  getPendingOfflineCheckIns,
  queueOfflineCheckIn,
  removeOfflineRoster,
  removeQueuedOfflineCheckIns,
  saveOfflineRoster,
  type OfflineAttendee,
  type OfflineRoster,
} from "@/lib/offline-checkin.client";
import { useToast } from "@/components/feedback/ToastProvider";
import { CheckInQrScanner } from "@/components/checkin/CheckInQrScanner";
import { IdCardPrintDialog } from "@/components/checkin/IdCardPrintDialog";
import { shouldRefreshCheckIn } from "@/lib/checkInRefresh";
import { buildCsv } from "@/lib/csv";
import { InstallCheckInAppButton } from "@/components/checkin/InstallCheckInAppButton";
import { playSuccessFeedback } from "@/components/checkin/checkInFeedback";

export type CheckInRecentRow = {
  rsvpId: string;
  displayName: string;
  email: string | null;
  checkedInAt: string;
};
type StationResponse =
  | { ok: true; data: CheckInPreviewData & CheckInResultData & { rows: LookupRow[] } }
  | { ok: false; error: string; needsForce?: boolean };

function DetailRows({ rows }: { rows: Array<{ key: string; label: string; value: string }> }) {
  if (rows.length === 0) return null;
  return (
    <dl className="m-0 flex flex-col gap-0.5 pt-1">
      {rows.map((detail) => (
        <div key={detail.key} className="flex flex-wrap items-baseline gap-1.5 text-sm">
          <dt className="opacity-75">{detail.label}:</dt>
          <dd className="m-0 font-semibold">{detail.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CheckInDetailsList({ details }: { details: CheckInResultData["checkInDetails"] }) {
  return <DetailRows rows={details.map((detail) => ({ key: detail.label, label: detail.label, value: detail.value }))} />;
}

function RegistrationDetailsList({ details }: { details: CheckInResultData["registrationDetails"] }) {
  return <DetailRows rows={details.map((detail) => ({ key: detail.key, label: detail.label, value: detail.value }))} />;
}

const statusChips: Record<string, { label: string; tone: ChipTone }> = {
  CONFIRMED: { label: "Confirmed", tone: "success" },
  WAITLISTED: { label: "Waitlisted", tone: "warning" },
  PENDING_APPROVAL: { label: "Pending approval", tone: "warning" },
  REJECTED: { label: "Rejected", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

function StatusChip({ status }: { status: string }) {
  const chip = statusChips[status] ?? { label: status, tone: "neutral" as ChipTone };
  return <Chip size="sm" tone={chip.tone}>{chip.label}</Chip>;
}

/** Render a stable server/client value first, then adapt to the device locale. */
function CheckInTimestamp({ value }: { value: string }) {
  const isClient = useSyncExternalStore(() => () => {}, () => true, () => false);
  return <>{isClient ? new Date(value).toLocaleString() : `${value.slice(0, 16).replace("T", " ")} UTC`}</>;
}

export function EventCheckInClient(props: {
  organisationSlug: string;
  organisationName: string;
  organisationLogoUrl: string | null;
  eventId: string;
  eventTitle: string;
  /** A PIN-authorised public station. It is deliberately online-only. */
  stationMode?: boolean;
  eventSlug?: string;
  registrationFields: Array<{ key: string; label: string }>;
  stats: { confirmed: number; checkedIn: number };
  recent: CheckInRecentRow[];
}) {
  const { organisationSlug, organisationName, organisationLogoUrl, eventId, eventTitle, registrationFields, stats, recent, stationMode = false, eventSlug } = props;
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();

  const [manual, setManual] = useState("");
  const [override, setOverride] = useState(false);
  const [lastResult, setLastResult] = useState<
    | (CheckInResultData & { kind?: "success" | "already" })
    | null
  >(null);
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupRows, setLookupRows] = useState<LookupRow[]>([]);
  const [scanPreview, setScanPreview] = useState<CheckInPreviewData | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanIsOffline, setScanIsOffline] = useState(false);
  const [offlineRoster, setOfflineRoster] = useState<OfflineRoster | null>(null);
  const [queuedCount, setQueuedCount] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  const [idCardOpen, setIdCardOpen] = useState(false);
  const [idCardAttendee, setIdCardAttendee] = useState<CheckInResultData | null>(null);
  const [idCardPrintingEnabled, setIdCardPrintingEnabled] = useState(false);
  const [detailsAttendee, setDetailsAttendee] = useState<CheckInPreviewData | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const stationRequest = useCallback(async (action: string, payload: Record<string, unknown>): Promise<StationResponse> => {
    const response = await fetch("/api/check-in/station", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ organisationSlug, eventSlug, action, ...payload }) });
    const result = await response.json() as StationResponse;
    return result;
  }, [eventSlug, organisationSlug]);

  const showIdCard = useCallback((attendee: CheckInResultData) => {
    setIdCardAttendee(attendee);
    setIdCardOpen(true);
  }, []);

  const refreshOfflineState = useCallback(async () => {
    if (stationMode) return;
    const [roster, pendingCheckIns] = await Promise.all([
      getOfflineRoster(eventId),
      getPendingOfflineCheckIns(eventId),
    ]);
    setOfflineRoster(roster ?? null);
    setQueuedCount(pendingCheckIns.length);
  }, [eventId, stationMode]);

  useEffect(() => {
    if (stationMode) return;
    const initialOfflineState = window.setTimeout(() => {
      void refreshOfflineState();
    }, 0);
    const initialStatus = window.setTimeout(() => setIsOnline(navigator.onLine), 0);
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.clearTimeout(initialStatus);
      window.clearTimeout(initialOfflineState);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [refreshOfflineState, stationMode]);

  useEffect(() => {
    // Turbopack's development chunks are replaced frequently and must never be
    // controlled by the offline worker. The worker is only an event-day
    // production feature for the check-in dashboard.
    if (stationMode || process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js", { scope: "/dashboard/", updateViaCache: "none" }).catch(() => {
      // Offline data remains available even if the browser disallows service workers.
    });
  }, [stationMode]);

  const downloadOfflineRoster = useCallback(() => {
    startTransition(async () => {
      if (!navigator.onLine) {
        showToast("Connect to the internet to download the attendee roster.", "warning");
        return;
      }
      const res = await downloadOfflineCheckInRoster({ organisationSlug, eventId });
      if (!res.ok) {
        showToast(res.error, "error");
        return;
      }
      const roster: OfflineRoster = {
        eventId,
        ...res.data!,
        // Attendee data and bearer ticket tokens must not persist on a shared
        // device beyond the event-day operational window.
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      };
      await saveOfflineRoster(roster);
      await refreshOfflineState();
      showToast("Offline roster saved to this device.", "success");
    });
  }, [eventId, organisationSlug, refreshOfflineState, showToast]);

  const syncOfflineQueue = useCallback(() => {
    startTransition(async () => {
      if (!navigator.onLine) {
        showToast("You are offline. Check-ins will sync when connected.", "warning");
        return;
      }
      const pendingCheckIns = await getPendingOfflineCheckIns(eventId);
      if (pendingCheckIns.length === 0) return;
      const res = await syncOfflineCheckIns({
        organisationSlug,
        eventId,
        checkIns: pendingCheckIns.map(({ rsvpId, id, checkedInAt, force }) => ({
          rsvpId,
          clientMutationId: id,
          checkedInAt,
          force,
        })),
      });
      if (!res.ok) {
        showToast(res.error, "error");
        return;
      }
      const completedRsvpIds = new Set([
        ...res.data!.syncedIds,
        ...res.data!.alreadyCheckedInIds,
      ]);
      await removeQueuedOfflineCheckIns(
        pendingCheckIns.filter((item) => completedRsvpIds.has(item.rsvpId)).map((item) => item.id),
      );
      await refreshOfflineState();
      router.refresh();
      if (res.data!.failed.length > 0) {
        showToast(`${res.data!.failed.length} check-in${res.data!.failed.length === 1 ? "" : "s"} need attention.`, "warning");
      } else {
        showToast("Offline check-ins synced.", "success");
      }
    });
  }, [eventId, organisationSlug, refreshOfflineState, router, showToast]);

  const clearOfflineRoster = useCallback(() => {
    startTransition(async () => {
      if (queuedCount > 0) {
        showToast("Sync pending check-ins before removing offline attendee data.", "warning");
        return;
      }
      await removeOfflineRoster(eventId);
      await refreshOfflineState();
      showToast("Offline attendee data removed from this device.", "success");
    });
  }, [eventId, queuedCount, refreshOfflineState, showToast]);

  useEffect(() => {
    if (!stationMode && isOnline && queuedCount > 0) syncOfflineQueue();
  }, [isOnline, queuedCount, stationMode, syncOfflineQueue]);

  useEffect(() => {
    const refreshWhenSafe = () => {
      if (shouldRefreshCheckIn({
        isVisible: document.visibilityState === "visible",
        isOnline,
        scanOpen,
        idCardOpen,
      })) {
        router.refresh();
      }
    };
    const interval = window.setInterval(refreshWhenSafe, 30_000);
    document.addEventListener("visibilitychange", refreshWhenSafe);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenSafe);
    };
  }, [idCardOpen, isOnline, router, scanOpen]);

  const queueLocalCheckIn = useCallback(async (attendee: OfflineAttendee) => {
    const checkedInAt = new Date().toISOString();
    const roster = await getOfflineRoster(eventId);
    if (!roster) {
      showToast("No offline roster is available for this event.", "error");
      return;
    }
    const updatedRoster: OfflineRoster = {
      ...roster,
      rows: roster.rows.map((row) => row.rsvpId === attendee.rsvpId ? { ...row, checkedInAt } : row),
    };
    await saveOfflineRoster(updatedRoster);
    await queueOfflineCheckIn({ eventId, rsvpId: attendee.rsvpId, checkedInAt, force: override });
    setLastResult({
      rsvpId: attendee.rsvpId,
      displayName: attendee.displayName,
      email: attendee.email,
      status: attendee.status,
      alreadyCheckedIn: false,
      checkedInAt,
      checkInQrToken: attendee.ticketToken,
      checkInDetails: attendee.checkInDetails ?? [],
      registrationDetails: attendee.registrationDetails ?? [],
      kind: "success",
    });
    if (idCardPrintingEnabled) showIdCard({
      rsvpId: attendee.rsvpId,
      displayName: attendee.displayName,
      email: attendee.email,
      status: attendee.status,
      alreadyCheckedIn: false,
      checkedInAt,
      checkInQrToken: attendee.ticketToken,
      checkInDetails: attendee.checkInDetails ?? [],
      registrationDetails: attendee.registrationDetails ?? [],
    });
    playSuccessFeedback();
    await refreshOfflineState();
    showToast(`Checked in offline: ${attendee.displayName}`, "success");
  }, [eventId, idCardPrintingEnabled, override, refreshOfflineState, showIdCard, showToast]);

  const openPreviewForScan = useCallback(
    (text: string) => {
      if (!navigator.onLine && !stationMode) {
        void (async () => {
          const roster = await getOfflineRoster(eventId);
          if (!roster) {
            showToast("No offline roster is available. Connect once and select Make available offline.", "warning");
            return;
          }
          const token = parseCheckInPayload(text);
          const attendee = roster.rows.find((row) => row.ticketToken === token);
          if (!attendee) {
            showToast("This ticket is not in the offline roster.", "error");
            return;
          }
          const gate = gateCheckInForStatus(attendee.status as RsvpStatus, override);
          setScanPreview({
            rsvpId: attendee.rsvpId,
            displayName: attendee.displayName,
            email: attendee.email,
            status: attendee.status,
            alreadyCheckedIn: Boolean(attendee.checkedInAt),
            checkedInAt: attendee.checkedInAt,
            checkInQrToken: attendee.ticketToken,
            checkInDetails: attendee.checkInDetails ?? [],
            registrationDetails: attendee.registrationDetails ?? [],
            gate,
          });
          setScanIsOffline(true);
          setScanOpen(true);
        })();
        return;
      }
      startTransition(async () => {
        const res = stationMode
          ? await stationRequest("previewToken", { rawInput: text, force: override })
          : await previewCheckInByToken({ organisationSlug, eventId, rawInput: text, force: override });
        if (!res.ok) {
          showToast(res.error, "error");
          setScanPreview(null);
          setScanOpen(false);
          return;
        }
        setScanPreview(res.data!);
        setScanIsOffline(false);
        setScanOpen(true);
      });
    },
    [eventId, organisationSlug, override, showToast, stationMode, stationRequest],
  );

  const onScan = useCallback(
    (text: string) => {
      // Keep a scanned ticket from being replaced while staff confirm or print
      // the attendee currently at the desk.
      if (scanOpen || idCardOpen) return;
      openPreviewForScan(text);
    },
    [idCardOpen, openPreviewForScan, scanOpen],
  );

  const confirmScan = useCallback(() => {
    if (!scanPreview) return;
    if (scanIsOffline) {
      void (async () => {
        const roster = await getOfflineRoster(eventId);
        const attendee = roster?.rows.find((row) => row.rsvpId === scanPreview.rsvpId);
        if (!attendee) {
          showToast("This attendee is no longer in the offline roster.", "error");
          return;
        }
        if (attendee.checkedInAt) {
          setLastResult({ ...scanPreview, kind: "already" });
          showToast("Already checked in on this device", "info");
        } else {
          await queueLocalCheckIn(attendee);
        }
        setScanOpen(false);
        setScanPreview(null);
        setScanIsOffline(false);
        setManual("");
      })();
      return;
    }
    startTransition(async () => {
      const res = stationMode
        ? await stationRequest("checkInRsvp", { rsvpId: scanPreview.rsvpId, force: override })
        : await checkInByRsvpId({ organisationSlug, eventId, rsvpId: scanPreview.rsvpId, force: override });
      if (!res.ok) {
        if (res.needsForce) {
          showToast(`${res.error} Enable “Override” and try again.`, "warning");
        } else {
          showToast(res.error, "error");
        }
        return;
      }
      const d = res.data!;
      if (d.alreadyCheckedIn) {
        setLastResult({ ...d, kind: "already" });
        showToast("Already checked in", "info");
      } else {
        setLastResult({ ...d, kind: "success" });
        showToast(`Checked in: ${d.displayName}`, "success");
        playSuccessFeedback();
      }
      if (idCardPrintingEnabled) showIdCard(d);
      setLookupRows((rows) => rows.map((row) => (
        row.rsvpId === d.rsvpId
          ? { ...row, checkedInAt: d.checkedInAt }
          : row
      )));
      setScanOpen(false);
      setScanPreview(null);
      setManual("");
      router.refresh();
    });
  }, [eventId, idCardPrintingEnabled, organisationSlug, override, queueLocalCheckIn, router, scanIsOffline, scanPreview, showIdCard, showToast, stationMode, stationRequest]);

  useEffect(() => {
    if (!scanOpen) return;
    const t = window.setTimeout(() => {
      confirmRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [scanOpen]);

  const onManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    openPreviewForScan(manual);
  };

  const runLookup = useCallback(() => {
    if (!navigator.onLine && !stationMode) {
      void (async () => {
        const q = lookupQuery.trim().toLowerCase();
        const roster = await getOfflineRoster(eventId);
        if (!roster) {
          showToast("No offline roster is available for this event.", "warning");
          return;
        }
        setLookupRows(
          q.length < 2
            ? []
            : roster.rows
                .filter((row) => row.displayName.toLowerCase().includes(q) || row.email?.toLowerCase().includes(q))
                .slice(0, 12)
                .map(({ rsvpId, displayName, email, status, checkedInAt }) => ({ rsvpId, displayName, email, status, checkedInAt })),
        );
      })();
      return;
    }
    startTransition(async () => {
      const res = stationMode
        ? await stationRequest("lookup", { query: lookupQuery })
        : await lookupAttendeesForCheckIn({ organisationSlug, eventId, query: lookupQuery });
      if (!res.ok) {
        showToast(res.error, "error");
        return;
      }
      setLookupRows(res.data!.rows);
    });
  }, [eventId, lookupQuery, organisationSlug, showToast, stationMode, stationRequest]);

  const checkInRow = (row: LookupRow, force: boolean) => {
    if (!navigator.onLine && !stationMode) {
      void (async () => {
        const roster = await getOfflineRoster(eventId);
        const attendee = roster?.rows.find((item) => item.rsvpId === row.rsvpId);
        if (!attendee) {
          showToast("This attendee is not available in the offline roster.", "error");
          return;
        }
        const gate = gateCheckInForStatus(attendee.status as RsvpStatus, force);
        if (!gate.ok) {
          showToast(gate.reason, "warning");
          return;
        }
        if (attendee.checkedInAt) {
          showToast(`${attendee.displayName} was already checked in.`, "info");
          return;
        }
        setScanPreview({
          rsvpId: attendee.rsvpId,
          displayName: attendee.displayName,
          email: attendee.email,
          status: attendee.status,
          alreadyCheckedIn: false,
          checkedInAt: null,
          checkInQrToken: attendee.ticketToken,
          checkInDetails: attendee.checkInDetails ?? [],
          registrationDetails: attendee.registrationDetails ?? [],
          gate,
        });
        setScanIsOffline(true);
        setScanOpen(true);
      })();
      return;
    }
    startTransition(async () => {
      const res = stationMode
        ? await stationRequest("previewRsvp", { rsvpId: row.rsvpId, force })
        : await previewCheckInByRsvpId({ organisationSlug, eventId, rsvpId: row.rsvpId, force });
      if (!res.ok) {
        if (res.needsForce) {
          showToast(`${res.error} Enable “Override” and try again.`, "warning");
        } else {
          showToast(res.error, "error");
        }
        return;
      }
      setScanPreview(res.data!);
      setScanIsOffline(false);
      setScanOpen(true);
    });
  };

  const viewAttendee = (row: LookupRow) => {
    startTransition(async () => {
      const res = stationMode
        ? await stationRequest("previewRsvp", { rsvpId: row.rsvpId, force: false })
        : await previewCheckInByRsvpId({ organisationSlug, eventId, rsvpId: row.rsvpId, force: false });
      if (!res.ok) return showToast(res.error, "error");
      setDetailsAttendee(res.data!);
    });
  };

  const onUndo = (rsvpId: string) => {
    startTransition(async () => {
      const res = stationMode ? await stationRequest("undo", { rsvpId }) : await undoCheckIn({ organisationSlug, eventId, rsvpId });
      if (!res.ok) {
        showToast(res.error, "error");
        return;
      }
      showToast("Check-in removed", "success");
      router.refresh();
    });
  };

  const csvBlob = useMemo(() => {
    const body = buildCsv([
      ["Name", "Email", "Checked in at"],
      ...recent.map((r) => [r.displayName, r.email ?? "", new Date(r.checkedInAt).toISOString()]),
    ]);
    return new Blob([body], { type: "text/csv;charset=utf-8" });
  }, [recent]);

  const downloadCsv = () => {
    const url = URL.createObjectURL(csvBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `checkins-${eventId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const rate =
    stats.confirmed > 0
      ? Math.round((stats.checkedIn / stats.confirmed) * 1000) / 10
      : 0;

  const closeScan = () => {
    setScanOpen(false);
    setScanPreview(null);
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          {stationMode ? (
            <>
              <p className="text-sm font-semibold text-ink-muted">Venue check-in</p>
              <h1 className="break-words font-display text-[26px] font-extrabold leading-tight tracking-[-0.02em] text-ink">{eventTitle}</h1>
            </>
          ) : (
            <h2 className="text-h4 text-ink">Check-in desk</h2>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="min-w-[132px]">
            <p className="font-display text-ink">
              <span className="text-[28px] font-extrabold">{stats.checkedIn}</span>
              <span className="text-base font-semibold text-ink-muted"> / {stats.confirmed} confirmed</span>
            </p>
            <p className="text-caption text-ink-muted">{stats.confirmed > 0 ? `${rate}% checked in` : "No confirmed RSVPs yet"}</p>
            {stats.confirmed > 0 ? <ProgressBar value={stats.checkedIn} max={stats.confirmed} tone="success" label="Checked in" className="mt-1.5" /> : null}
          </div>
          {!stationMode ? <Chip tone={isOnline ? "success" : "warning"} icon={<span className="size-2 rounded-full bg-current" />}>{isOnline ? "Online" : "Offline"}</Chip> : null}
        </div>
      </header>

      {!stationMode ? (
        <section className={cn("flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between", offlineRoster ? "border-transparent bg-success-bg" : "border-line bg-subtle")}>
          <div className="flex items-start gap-3">
            <span aria-hidden className={cn("mt-0.5 [&_svg]:size-5", offlineRoster ? "text-success-fg" : "text-ink-muted")}>{offlineRoster ? <CloudCheck /> : <CloudOff />}</span>
            <div>
              <p className="text-label text-ink">{offlineRoster ? "Offline check-in ready" : "Offline check-in is not ready"}</p>
              <p className="text-sm text-ink-secondary">
                {offlineRoster
                  ? `${offlineRoster.rows.length} attendees saved on this device${queuedCount ? ` · ${queuedCount} waiting to sync` : ""}.`
                  : "Download the attendee roster while online to scan and search without a connection."}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <InstallCheckInAppButton />
            <Button size="sm" variant="secondary" startIcon={<Download />} onClick={downloadOfflineRoster} disabled={pending || !isOnline}>
              {offlineRoster ? "Refresh roster" : "Make available offline"}
            </Button>
            {offlineRoster ? (
              <Button size="sm" variant="dangerQuiet" onClick={clearOfflineRoster} disabled={pending || queuedCount > 0}>
                Remove offline data
              </Button>
            ) : null}
            {queuedCount > 0 ? (
              <Button size="sm" variant="primary" startIcon={<RefreshCw />} onClick={syncOfflineQueue} disabled={pending || !isOnline}>
                Sync {queuedCount}
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="flex flex-col gap-3 rounded-lg border border-line bg-canvas p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <Switch id="check-in-override" checked={override} onCheckedChange={setOverride} />
          <label htmlFor="check-in-override" className="text-label text-ink">Override waitlist</label>
          <Tooltip content="Allows check-in for waitlisted attendees only. Pending approval and rejected registrations remain blocked.">
            <IconButton label="About override check-in" size="sm"><Info /></IconButton>
          </Tooltip>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2.5">
            <Switch id="check-in-id-cards" checked={idCardPrintingEnabled} onCheckedChange={(enabled) => { setIdCardPrintingEnabled(enabled); if (!enabled) setIdCardOpen(false); }} aria-describedby="check-in-id-cards-help" />
            <label htmlFor="check-in-id-cards" className="text-label text-ink">ID card printing</label>
          </div>
          {idCardPrintingEnabled ? <Button size="sm" variant="secondary" startIcon={<Printer />} onClick={() => { setIdCardAttendee(null); setIdCardOpen(true); }}>Set up cards</Button> : null}
        </div>
        <p id="check-in-id-cards-help" className="sr-only">Off by default. Enable it when this desk should offer cards after check-in.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <section aria-labelledby="scan-title" className="flex flex-col gap-3">
            <div>
              <h2 id="scan-title" className="text-h4 text-ink">Scan QR</h2>
              <p className="text-sm text-ink-muted">Point the camera at an attendee ticket QR. Codes contain only a secret ticket link — no personal data in the barcode.</p>
            </div>
            <CheckInQrScanner onScan={onScan} disabled={pending} />
          </section>

          <section aria-labelledby="manual-title" className="flex flex-col gap-3 rounded-lg border border-line bg-canvas p-4">
            <div>
              <h2 id="manual-title" className="text-title text-ink">Manual code</h2>
              <p className="text-sm text-ink-muted">Paste a ticket URL or the opaque code from the attendee&apos;s phone.</p>
            </div>
            <form onSubmit={onManualSubmit} className="flex flex-col gap-2.5">
              <label htmlFor="check-in-manual" className="sr-only">URL or code</label>
              <Textarea id="check-in-manual" rows={2} placeholder="URL or code" value={manual} onChange={(e) => setManual(e.target.value)} disabled={pending} />
              <Button type="submit" variant="primary" disabled={pending || !manual.trim()} className="self-start">
                Preview
              </Button>
            </form>
          </section>
        </div>

        <div className="flex flex-col gap-5">
          {lastResult ? (
            <section
              role="status"
              className={cn("flex flex-col gap-3 rounded-xl p-6", lastResult.kind === "already" ? "bg-emphasis text-ink" : "bg-success-solid text-white")}
            >
              {lastResult.kind === "already" ? (
                <span aria-hidden className="flex size-14 items-center justify-center rounded-full bg-canvas">
                  <Info className="size-6" />
                </span>
              ) : (
                <span className="self-start rounded-[20px] bg-white p-3">
                  <DotFace mood="wink" size={72} colors={{ O: "#18181B" }} />
                </span>
              )}
              <div>
                <p className="text-[15px] font-semibold">{lastResult.kind === "already" ? "Already checked in" : "Checked in"}</p>
                <p className="break-words font-display text-[34px] font-extrabold leading-none tracking-[-0.03em]">{lastResult.displayName}</p>
                <p className="mt-2 text-sm opacity-90">
                  {lastResult.email ?? ""}
                  {lastResult.email && lastResult.checkedInAt ? " · " : ""}
                  {lastResult.checkedInAt ? <CheckInTimestamp value={lastResult.checkedInAt} /> : null}
                </p>
                <CheckInDetailsList details={lastResult.checkInDetails} />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant={lastResult.kind === "already" ? "secondary" : "inverse"} startIcon={<X />} onClick={() => setLastResult(null)}>
                  Next guest
                </Button>
                {idCardPrintingEnabled ? (
                  <Button size="sm" variant="secondary" startIcon={<Printer />} onClick={() => showIdCard(lastResult)}>
                    Print ID card
                  </Button>
                ) : null}
              </div>
            </section>
          ) : null}

          <section aria-labelledby="search-title" className="flex flex-col gap-3 rounded-lg border border-line bg-canvas p-4">
            <h2 id="search-title" className="text-title text-ink">Search attendees</h2>
            <div className="flex gap-2">
              <label htmlFor="check-in-search" className="sr-only">Name or email</label>
              <Input
                id="check-in-search"
                placeholder="Name or email"
                value={lookupQuery}
                onChange={(e) => setLookupQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    runLookup();
                  }
                }}
              />
              <Button variant="primary" startIcon={<Search />} onClick={runLookup} disabled={pending}>
                Search
              </Button>
            </div>
            {lookupRows.length > 0 ? (
              <ul className="flex flex-col divide-y divide-line">
                {lookupRows.map((row) => (
                  <li key={row.rsvpId} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <button type="button" onClick={() => viewAttendee(row)} disabled={pending} className="block max-w-full truncate text-left text-[15px] font-semibold text-ink underline-offset-4 hover:underline">
                        {row.displayName}
                      </button>
                      {row.email ? <p className="truncate text-sm text-ink-muted">{row.email}</p> : null}
                      <div className="mt-1 flex flex-wrap gap-1">
                        <StatusChip status={row.status} />
                        {row.checkedInAt ? <Chip size="sm" tone="success" icon={<Check />}>Checked in</Chip> : null}
                      </div>
                    </div>
                    {row.checkedInAt ? (
                      <Button size="sm" variant="quiet" onClick={() => onUndo(row.rsvpId)} disabled={pending || !isOnline}>Undo</Button>
                    ) : (
                      <Button size="sm" variant="primary" onClick={() => checkInRow(row, override)} disabled={pending}>Check in</Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>
      </div>

      <Dialog open={scanOpen} onOpenChange={(next) => { if (!next) closeScan(); }}>
        <DialogContent
          size="sm"
          hideClose={stationMode}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (scanPreview?.gate.ok) confirmScan();
            }
          }}
        >
          <DialogHeader title="Confirm check-in" />
          <DialogBody className="flex flex-col gap-2">
            {scanPreview ? (
              <>
                <p className="font-display text-[24px] font-extrabold leading-tight text-ink">{scanPreview.displayName}</p>
                <p className="text-sm text-ink-muted">{scanPreview.email ?? "—"}</p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <StatusChip status={scanPreview.status} />
                  {scanPreview.alreadyCheckedIn ? <Chip size="sm" tone="neutral">Already checked in</Chip> : null}
                </div>
                {!scanPreview.gate.ok ? <Callout tone={scanPreview.gate.blocked ? "danger" : "warning"}>{scanPreview.gate.reason}</Callout> : null}
                <div className="text-ink"><CheckInDetailsList details={scanPreview.checkInDetails} /></div>
                <p className="text-caption text-ink-muted">Press Enter to confirm.</p>
              </>
            ) : null}
          </DialogBody>
          <DialogFooter>
            {!stationMode ? <Button variant="secondary" onClick={closeScan}>Cancel</Button> : null}
            <Button
              ref={(el) => {
                confirmRef.current = el;
              }}
              variant="primary"
              onClick={confirmScan}
              disabled={!scanPreview?.gate.ok || pending}
              autoFocus
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <IdCardPrintDialog
        key={eventId}
        open={idCardOpen}
        onClose={() => setIdCardOpen(false)}
        eventId={eventId}
        eventTitle={eventTitle}
        organisationName={organisationName}
        organisationLogoUrl={organisationLogoUrl}
        attendee={idCardAttendee ? {
          displayName: idCardAttendee.displayName,
          email: idCardAttendee.email,
          checkInQrToken: idCardAttendee.checkInQrToken,
          checkInDetails: idCardAttendee.checkInDetails,
          registrationDetails: idCardAttendee.registrationDetails,
        } : null}
        registrationFields={registrationFields}
      />

      <Dialog open={Boolean(detailsAttendee)} onOpenChange={(next) => { if (!next) setDetailsAttendee(null); }}>
        <DialogContent size="sm">
          <DialogHeader title="Attendee details" />
          <DialogBody className="flex flex-col gap-2.5 text-ink">
            {detailsAttendee ? (
              <>
                <p className="text-[19px] font-bold">{detailsAttendee.displayName}</p>
                <p className="text-sm text-ink-muted">{detailsAttendee.email ?? "No email address"}</p>
                <div className="flex flex-wrap gap-1.5">
                  <StatusChip status={detailsAttendee.status} />
                  {detailsAttendee.alreadyCheckedIn ? <Chip size="sm" tone="success">Already checked in</Chip> : null}
                </div>
                {detailsAttendee.checkedInAt ? <p className="text-sm">Checked in: <CheckInTimestamp value={detailsAttendee.checkedInAt} /></p> : null}
                {detailsAttendee.checkInDetails.length > 0 ? <div><p className="text-label">Check-in details</p><CheckInDetailsList details={detailsAttendee.checkInDetails} /></div> : null}
                {detailsAttendee.registrationDetails.length > 0 ? <div><p className="text-label">Registration details</p><RegistrationDetailsList details={detailsAttendee.registrationDetails} /></div> : null}
              </>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDetailsAttendee(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <section aria-labelledby="recent-title" className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="recent-title" className="text-h4 text-ink">Recent check-ins</h2>
            {!stationMode ? <p className="text-caption text-ink-muted">Export includes the list on this page (up to 200). This page refreshes automatically while it is open.</p> : null}
          </div>
          <Button size="sm" variant="secondary" startIcon={<Download />} onClick={downloadCsv} disabled={recent.length === 0}>
            Export CSV (shown below)
          </Button>
        </div>
        {recent.length === 0 ? (
          <p className="text-body-ui text-ink-muted">No check-ins yet.</p>
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-canvas px-4 sm:hidden">
              {recent.map((r) => (
                <li key={r.rsvpId} className="flex items-center gap-3 py-3">
                  <Check aria-hidden className="size-4 shrink-0 text-success-fg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-ink">{r.displayName}</p>
                    {r.email ? <p className="truncate text-sm text-ink-muted">{r.email}</p> : null}
                    <p className="text-caption text-ink-muted"><CheckInTimestamp value={r.checkedInAt} /></p>
                  </div>
                  <Button size="sm" variant="quiet" onClick={() => onUndo(r.rsvpId)} disabled={pending || !isOnline}>Undo check-in</Button>
                </li>
              ))}
            </ul>
            <div className="hidden sm:block">
              <Table label="Recent check-ins">
                <THead>
                  <tr>
                    <TH>Name</TH>
                    <TH>Email</TH>
                    <TH>Checked in</TH>
                    <TH className="text-right">Undo</TH>
                  </tr>
                </THead>
                <TBody>
                  {recent.map((r) => (
                    <TR key={r.rsvpId}>
                      <TD className="font-semibold">{r.displayName}</TD>
                      <TD className="text-ink-secondary">{r.email ?? "—"}</TD>
                      <TD className="text-ink-secondary"><CheckInTimestamp value={r.checkedInAt} /></TD>
                      <TD className="text-right">
                        <Button size="sm" variant="quiet" onClick={() => onUndo(r.rsvpId)} disabled={pending || !isOnline}>Undo</Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </>
        )}
      </section>

      {!stationMode ? (
        <p className="text-sm text-ink-muted">
          Each attendee has a unique ticket URL under <code className="font-mono text-[0.85em]">/ticket/&lt;code&gt;</code>. Use <strong>Copy ticket</strong> in the attendee list to share it, or open the check-in page from the event dashboard on a tablet at the door.
        </p>
      ) : null}
    </div>
  );
}
