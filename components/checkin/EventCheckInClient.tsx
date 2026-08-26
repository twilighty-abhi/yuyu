"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { RsvpStatus } from "@prisma/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import CloudDoneOutlinedIcon from "@mui/icons-material/CloudDoneOutlined";
import CloudOffOutlinedIcon from "@mui/icons-material/CloudOffOutlined";
import SyncOutlinedIcon from "@mui/icons-material/SyncOutlined";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
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
  removeQueuedOfflineCheckIns,
  saveOfflineRoster,
  type OfflineAttendee,
  type OfflineRoster,
} from "@/lib/offline-checkin.client";
import { useToast } from "@/components/feedback/ToastProvider";
import { CheckInQrScanner } from "@/components/checkin/CheckInQrScanner";
import { IdCardPrintDialog } from "@/components/checkin/IdCardPrintDialog";

export type CheckInRecentRow = {
  rsvpId: string;
  displayName: string;
  email: string | null;
  checkedInAt: string;
};

function CheckInDetailsList({ details }: { details: CheckInResultData["checkInDetails"] }) {
  if (details.length === 0) return null;
  return (
    <Stack component="dl" spacing={0.25} sx={{ m: 0, pt: 0.5 }}>
      {details.map((detail) => (
        <Stack component="div" direction="row" spacing={0.75} key={detail.label} sx={{ alignItems: "baseline" }}>
          <Typography component="dt" variant="body2" color="text.secondary">{detail.label}:</Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0, fontWeight: 600 }}>{detail.value}</Typography>
        </Stack>
      ))}
    </Stack>
  );
}

function playSuccessFeedback() {
  if (typeof window === "undefined") return;
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.value = 0.08;
    o.start();
    setTimeout(() => {
      o.stop();
      ctx.close();
    }, 120);
  } catch {
    /* ignore */
  }
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    navigator.vibrate(40);
  }
}

export function EventCheckInClient(props: {
  organisationSlug: string;
  organisationName: string;
  organisationLogoUrl: string | null;
  eventId: string;
  eventTitle: string;
  registrationFields: Array<{ key: string; label: string }>;
  stats: { confirmed: number; checkedIn: number };
  recent: CheckInRecentRow[];
}) {
  const { organisationSlug, organisationName, organisationLogoUrl, eventId, eventTitle, registrationFields, stats, recent } = props;
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
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  const showIdCard = useCallback((attendee: CheckInResultData) => {
    setIdCardAttendee(attendee);
    setIdCardOpen(true);
  }, []);

  const refreshOfflineState = useCallback(async () => {
    const [roster, pendingCheckIns] = await Promise.all([
      getOfflineRoster(eventId),
      getPendingOfflineCheckIns(eventId),
    ]);
    setOfflineRoster(roster ?? null);
    setQueuedCount(pendingCheckIns.length);
  }, [eventId]);

  useEffect(() => {
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
  }, [refreshOfflineState]);

  useEffect(() => {
    // Turbopack's development chunks are replaced frequently and must never be
    // controlled by the offline worker. The worker is only an event-day
    // production feature for the check-in dashboard.
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js", { scope: "/dashboard/", updateViaCache: "none" }).catch(() => {
      // Offline data remains available even if the browser disallows service workers.
    });
  }, []);

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

  useEffect(() => {
    if (isOnline && queuedCount > 0) syncOfflineQueue();
  }, [isOnline, queuedCount, syncOfflineQueue]);

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
      checkInDetails: attendee.checkInDetails ?? [],
      registrationDetails: attendee.registrationDetails ?? [],
      kind: "success",
    });
    showIdCard({
      rsvpId: attendee.rsvpId,
      displayName: attendee.displayName,
      email: attendee.email,
      status: attendee.status,
      alreadyCheckedIn: false,
      checkedInAt,
      checkInDetails: attendee.checkInDetails ?? [],
      registrationDetails: attendee.registrationDetails ?? [],
    });
    playSuccessFeedback();
    await refreshOfflineState();
    showToast(`Checked in offline: ${attendee.displayName}`, "success");
  }, [eventId, override, refreshOfflineState, showIdCard, showToast]);

  const openPreviewForScan = useCallback(
    (text: string) => {
      if (!navigator.onLine) {
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
        const res = await previewCheckInByToken({
          organisationSlug,
          eventId,
          rawInput: text,
          force: override,
        });
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
    [eventId, organisationSlug, override, showToast],
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
      const res = await checkInByRsvpId({
        organisationSlug,
        eventId,
        rsvpId: scanPreview.rsvpId,
        force: override,
      });
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
      showIdCard(d);
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
  }, [eventId, organisationSlug, override, queueLocalCheckIn, router, scanIsOffline, scanPreview, showIdCard, showToast]);

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
    if (!navigator.onLine) {
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
      const res = await lookupAttendeesForCheckIn({
        organisationSlug,
        eventId,
        query: lookupQuery,
      });
      if (!res.ok) {
        showToast(res.error, "error");
        return;
      }
      setLookupRows(res.data!.rows);
    });
  }, [eventId, lookupQuery, organisationSlug, showToast]);

  const checkInRow = (row: LookupRow, force: boolean) => {
    if (!navigator.onLine) {
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
      const res = await previewCheckInByRsvpId({
        organisationSlug,
        eventId,
        rsvpId: row.rsvpId,
        force,
      });
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

  const onUndo = (rsvpId: string) => {
    startTransition(async () => {
      const res = await undoCheckIn({ organisationSlug, eventId, rsvpId });
      if (!res.ok) {
        showToast(res.error, "error");
        return;
      }
      showToast("Check-in removed", "success");
      router.refresh();
    });
  };

  const csvBlob = useMemo(() => {
    const header = ["Name", "Email", "Checked in at"];
    const lines = recent.map((r) => [
      `"${r.displayName.replace(/"/g, '""')}"`,
      `"${(r.email ?? "").replace(/"/g, '""')}"`,
      `"${new Date(r.checkedInAt).toISOString()}"`,
    ]);
    const body = [header.join(","), ...lines.map((l) => l.join(","))].join(
      "\n",
    );
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

  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        useFlexGap
        sx={{ alignItems: "stretch" }}
      >
        <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Progress
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 600 }}>
            {stats.checkedIn}{" "}
            <Typography component="span" variant="body1" color="text.secondary">
              / {stats.confirmed} confirmed
            </Typography>
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {stats.confirmed > 0 ? `${rate}% checked in` : "No confirmed RSVPs yet"}
          </Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Event
          </Typography>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>
            {eventTitle}
          </Typography>
          <Button
            component={Link}
            href={`/dashboard/${organisationSlug}/event/${eventId}`}
            size="small"
            sx={{ mt: 1 }}
          >
            Back to event
          </Button>
        </Paper>
      </Stack>

      <Paper
        variant="outlined"
        sx={{
          p: 2,
          borderRadius: "16px",
          borderColor: offlineRoster ? "rgba(10,132,255,0.28)" : "rgba(255,255,255,0.08)",
          backgroundColor: offlineRoster ? "rgba(10,132,255,0.05)" : "rgba(255,255,255,0.02)",
        }}
      >
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { xs: "flex-start", sm: "center" }, justifyContent: "space-between" }}>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
            {offlineRoster ? <CloudDoneOutlinedIcon color="primary" /> : <CloudOffOutlinedIcon color="disabled" />}
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {offlineRoster ? "Offline check-in ready" : "Offline check-in is not ready"}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {offlineRoster
                  ? `${offlineRoster.rows.length} attendees saved on this device${queuedCount ? ` · ${queuedCount} waiting to sync` : ""}.`
                  : "Download the attendee roster while online to scan and search without a connection."}
              </Typography>
            </Box>
          </Stack>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
            <Button size="small" variant="outlined" startIcon={<DownloadOutlinedIcon />} onClick={downloadOfflineRoster} disabled={pending || !isOnline} sx={{ textTransform: "none" }}>
              {offlineRoster ? "Refresh roster" : "Make available offline"}
            </Button>
            {queuedCount > 0 ? (
              <Button size="small" variant="contained" startIcon={<SyncOutlinedIcon />} onClick={syncOfflineQueue} disabled={pending || !isOnline} sx={{ textTransform: "none" }}>
                Sync {queuedCount}
              </Button>
            ) : null}
          </Stack>
        </Stack>
      </Paper>

      <FormControlLabel
        control={
          <Switch
            checked={override}
            onChange={(_, v) => setOverride(v)}
            color="warning"
          />
        }
        label="Override (waitlist / pending approval)"
      />

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}>
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>ID card printing</Typography>
            <Typography variant="body2" color="text.secondary">A6 portrait is ready by default. Set a custom size and card text for this check-in device.</Typography>
          </Box>
          <Button variant="outlined" startIcon={<PrintOutlinedIcon />} onClick={() => { setIdCardAttendee(null); setIdCardOpen(true); }}>
            Set up cards
          </Button>
        </Stack>
      </Paper>

      <Stack direction={{ xs: "column", lg: "row" }} spacing={3} useFlexGap>
        <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
            Scan QR
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Point the camera at an attendee ticket QR. Codes contain only a
            secret ticket link — no personal data in the barcode.
          </Typography>
          <CheckInQrScanner onScan={onScan} disabled={pending} />
        </Paper>

        <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
            Manual code
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Paste a ticket URL or the opaque code from the attendee&apos;s phone.
          </Typography>
          <Box component="form" onSubmit={onManualSubmit}>
            <Stack spacing={2}>
              <TextField
                label="URL or code"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                fullWidth
                multiline
                minRows={2}
                size="small"
                disabled={pending}
              />
              <Button
                type="submit"
                variant="contained"
                disabled={pending || !manual.trim()}
              >
                Preview
              </Button>
            </Stack>
          </Box>
        </Paper>
      </Stack>

      <Dialog
        open={scanOpen}
        onClose={() => {
          setScanOpen(false);
          setScanPreview(null);
        }}
        maxWidth="xs"
        fullWidth
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (scanPreview?.gate.ok) confirmScan();
          }
        }}
      >
        <DialogTitle>Confirm check-in</DialogTitle>
        <DialogContent>
          {scanPreview ? (
            <Stack spacing={1}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                {scanPreview.displayName}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {scanPreview.email ?? "—"}
              </Typography>
              <Stack
                direction="row"
                useFlexGap
                sx={{ flexWrap: "wrap", columnGap: 1, rowGap: 1, pt: 0.5 }}
              >
                <Chip label={scanPreview.status} size="small" />
                {scanPreview.alreadyCheckedIn ? (
                  <Chip label="Already checked in" size="small" color="info" />
                ) : null}
              </Stack>
              {!scanPreview.gate.ok ? (
                <Alert severity={scanPreview.gate.blocked ? "error" : "warning"}>
                  {scanPreview.gate.reason}
                </Alert>
              ) : null}
              <Typography variant="caption" color="text.secondary">
                Press Enter to confirm.
              </Typography>
              <CheckInDetailsList details={scanPreview.checkInDetails} />
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setScanOpen(false);
              setScanPreview(null);
            }}
            color="inherit"
          >
            Cancel
          </Button>
          <Button
            ref={(el) => {
              confirmRef.current = el;
            }}
            variant="contained"
            onClick={confirmScan}
            disabled={!scanPreview?.gate.ok || pending}
            autoFocus
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>

      {lastResult ? (
        <Alert
          severity={lastResult.kind === "already" ? "info" : "success"}
          onClose={() => setLastResult(null)}
        >
          <Typography variant="subtitle2">
            {lastResult.kind === "already"
              ? "Already checked in"
              : "Checked in"}
          </Typography>
          <Typography variant="body2">
            {lastResult.displayName}
            {lastResult.email ? ` · ${lastResult.email}` : ""}
          </Typography>
          <CheckInDetailsList details={lastResult.checkInDetails} />
          {lastResult.checkedInAt ? (
            <Typography variant="caption" color="text.secondary">
              {new Date(lastResult.checkedInAt).toLocaleString()}
            </Typography>
          ) : null}
          <Button size="small" startIcon={<PrintOutlinedIcon />} onClick={() => showIdCard(lastResult)} sx={{ mt: 0.75 }}>
            Print ID card
          </Button>
        </Alert>
      ) : null}

      <IdCardPrintDialog
        open={idCardOpen}
        onClose={() => setIdCardOpen(false)}
        eventId={eventId}
        eventTitle={eventTitle}
        organisationName={organisationName}
        organisationLogoUrl={organisationLogoUrl}
        attendee={idCardAttendee ? {
          displayName: idCardAttendee.displayName,
          email: idCardAttendee.email,
          checkInDetails: idCardAttendee.checkInDetails,
          registrationDetails: idCardAttendee.registrationDetails,
        } : null}
        registrationFields={registrationFields}
      />

      <Divider />

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
          Search attendees
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} useFlexGap>
          <TextField
            label="Name or email"
            value={lookupQuery}
            onChange={(e) => setLookupQuery(e.target.value)}
            size="small"
            fullWidth
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runLookup();
              }
            }}
          />
          <Button variant="outlined" onClick={runLookup} disabled={pending}>
            Search
          </Button>
        </Stack>
        {lookupRows.length > 0 ? (
          <Table size="small" sx={{ mt: 2 }}>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {lookupRows.map((row) => (
                <TableRow key={row.rsvpId}>
                  <TableCell>{row.displayName}</TableCell>
                  <TableCell>{row.email ?? "—"}</TableCell>
                  <TableCell>
                    <Chip label={row.status} size="small" />
                  </TableCell>
                  <TableCell align="right">
                    <Stack
                      direction="row"
                      spacing={0.5}
                      useFlexGap
                      sx={{ justifyContent: "flex-end", flexWrap: "wrap" }}
                    >
                      {row.checkedInAt ? (
                        <Button
                          size="small"
                          color="warning"
                          onClick={() => onUndo(row.rsvpId)}
                          disabled={pending || !isOnline}
                        >
                          Undo
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => checkInRow(row, override)}
                          disabled={pending}
                        >
                          Check in
                        </Button>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Recent check-ins
          </Typography>
          <Button
            startIcon={<DownloadOutlinedIcon />}
            variant="outlined"
            size="small"
            onClick={downloadCsv}
            disabled={recent.length === 0}
          >
            Export CSV (shown below)
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          Export includes the list on this page (up to 200). Refresh after new
          check-ins to update.
        </Typography>
        {recent.length === 0 ? (
          <Typography color="text.secondary" sx={{ mt: 2 }}>
            No check-ins yet.
          </Typography>
        ) : (
          <Table size="small" sx={{ mt: 2 }}>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Checked in</TableCell>
                <TableCell align="right">Undo</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {recent.map((r) => (
                <TableRow key={r.rsvpId}>
                  <TableCell>{r.displayName}</TableCell>
                  <TableCell>{r.email ?? "—"}</TableCell>
                  <TableCell>
                    {new Date(r.checkedInAt).toLocaleString()}
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      color="warning"
                      onClick={() => onUndo(r.rsvpId)}
                      disabled={pending || !isOnline}
                    >
                      Undo
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>

      <Typography variant="body2" color="text.secondary">
        Each attendee has a unique ticket URL under{" "}
        <Box component="span" sx={{ fontFamily: "monospace", fontSize: "0.85em" }}>
          /ticket/&lt;code&gt;
        </Box>
        . Use <strong>Copy ticket</strong> in the attendee list to share it, or
        open the check-in page from the event dashboard on a tablet at the door.
      </Typography>
    </Stack>
  );
}
