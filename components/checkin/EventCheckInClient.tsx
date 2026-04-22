"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
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
import {
  checkInByRsvpId,
  lookupAttendeesForCheckIn,
  previewCheckInByToken,
  undoCheckIn,
  type CheckInPreviewData,
  type CheckInResultData,
  type LookupRow,
} from "@/app/actions/checkin";
import { useToast } from "@/components/feedback/ToastProvider";
import { CheckInQrScanner } from "@/components/checkin/CheckInQrScanner";

export type CheckInRecentRow = {
  rsvpId: string;
  displayName: string;
  email: string | null;
  checkedInAt: string;
};

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
  eventId: string;
  eventTitle: string;
  stats: { confirmed: number; checkedIn: number };
  recent: CheckInRecentRow[];
}) {
  const { organisationSlug, eventId, eventTitle, stats, recent } = props;
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
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  const openPreviewForScan = useCallback(
    (text: string) => {
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
        setScanOpen(true);
      });
    },
    [eventId, organisationSlug, override, showToast],
  );

  const onScan = useCallback(
    (text: string) => {
      openPreviewForScan(text);
    },
    [openPreviewForScan],
  );

  const confirmScan = useCallback(() => {
    if (!scanPreview) return;
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
      setScanOpen(false);
      setScanPreview(null);
      setManual("");
      router.refresh();
    });
  }, [eventId, organisationSlug, override, router, scanPreview, showToast]);

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
    startTransition(async () => {
      const res = await checkInByRsvpId({
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
      const d = res.data!;
      if (d.alreadyCheckedIn) {
        showToast(`${d.displayName} was already checked in.`, "info");
      } else {
        showToast(`Checked in: ${d.displayName}`, "success");
        playSuccessFeedback();
      }
      router.refresh();
      void runLookup();
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
          {lastResult.checkedInAt ? (
            <Typography variant="caption" color="text.secondary">
              {new Date(lastResult.checkedInAt).toLocaleString()}
            </Typography>
          ) : null}
        </Alert>
      ) : null}

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
                          disabled={pending}
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
                      disabled={pending}
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
