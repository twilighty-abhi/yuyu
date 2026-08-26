"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonGroup from "@mui/material/ButtonGroup";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import {
  A6_LANDSCAPE,
  A6_PORTRAIT,
  defaultIdCardPrintSettings,
  normalizeIdCardPrintSettings,
  type IdCardPrintSettings,
} from "@/lib/idCardPrint";

type Attendee = {
  displayName: string;
  email: string | null;
};

const storageKey = (eventId: string) => `yuyu:checkin:id-card:${eventId}`;
const settingsChangedEvent = "yuyu:id-card-print-settings-changed";
const sessionSettings = new Map<string, IdCardPrintSettings>();

function readSettings(eventId: string, eventTitle: string) {
  const cached = sessionSettings.get(eventId);
  if (cached) return cached;
  const fallback = defaultIdCardPrintSettings(eventTitle);
  try {
    const saved = window.localStorage.getItem(storageKey(eventId));
    if (saved) {
      const settings = normalizeIdCardPrintSettings(JSON.parse(saved), eventTitle);
      sessionSettings.set(eventId, settings);
      return settings;
    }
  } catch {
    // A private or locked-down station can use the in-memory settings below.
  }
  sessionSettings.set(eventId, fallback);
  return fallback;
}

function escapePrintHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function printCard(settings: IdCardPrintSettings, attendee: Attendee) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return false;

  const heading = escapePrintHtml(settings.heading);
  const badgeLabel = escapePrintHtml(settings.badgeLabel);
  const name = escapePrintHtml(attendee.displayName);
  const email = attendee.email ? escapePrintHtml(attendee.email) : "";
  const emailLine = settings.showEmail && email ? `<p class="email">${email}</p>` : "";

  printWindow.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><title>${name} ID card</title><style>
  @page { size: ${settings.widthMm}mm ${settings.heightMm}mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { width: ${settings.widthMm}mm; height: ${settings.heightMm}mm; margin: 0; }
  body { color: #111827; font-family: Arial, Helvetica, sans-serif; }
  .card { width: 100%; height: 100%; padding: 10mm 9mm; display: flex; flex-direction: column; border: 0.7mm solid #111827; background: #fff; }
  .label { margin: 0 0 4mm; color: #475569; font-size: 9pt; font-weight: 700; letter-spacing: 0.13em; }
  .heading { margin: 0; font-size: 15pt; font-weight: 700; line-height: 1.2; }
  .rule { width: 100%; height: 0.5mm; margin: 7mm 0; background: #111827; }
  .name { margin: 0; font-size: 28pt; font-weight: 800; line-height: 1.05; overflow-wrap: anywhere; }
  .email { margin: 4mm 0 0; color: #475569; font-size: 11pt; overflow-wrap: anywhere; }
  .footer { margin-top: auto; color: #64748b; font-size: 8pt; }
</style></head><body><main class="card"><p class="label">${badgeLabel}</p><h1 class="heading">${heading}</h1><div class="rule"></div><p class="name">${name}</p>${emailLine}<p class="footer">Checked in</p></main></body></html>`);
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => printWindow.print(), 100);
  return true;
}

export function IdCardPrintDialog(props: {
  open: boolean;
  onClose: () => void;
  eventId: string;
  eventTitle: string;
  attendee: Attendee | null;
}) {
  const { open, onClose, eventId, eventTitle, attendee } = props;
  const defaultSettings = useMemo(() => defaultIdCardPrintSettings(eventTitle), [eventTitle]);
  const subscribe = useCallback((onStoreChange: () => void) => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey(eventId)) {
        sessionSettings.delete(eventId);
        onStoreChange();
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(settingsChangedEvent, onStoreChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(settingsChangedEvent, onStoreChange);
    };
  }, [eventId]);
  const getSnapshot = useCallback(() => readSettings(eventId, eventTitle), [eventId, eventTitle]);
  const getServerSnapshot = useCallback(() => defaultSettings, [defaultSettings]);
  const settings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const sampleAttendee = attendee ?? { displayName: "Attendee name", email: "attendee@example.com" };
  const ratio = `${settings.widthMm} / ${settings.heightMm}`;
  const paperDescription = `${settings.widthMm} × ${settings.heightMm} mm`;
  const isA6Portrait = settings.widthMm === A6_PORTRAIT.widthMm && settings.heightMm === A6_PORTRAIT.heightMm;
  const isA6Landscape = settings.widthMm === A6_LANDSCAPE.widthMm && settings.heightMm === A6_LANDSCAPE.heightMm;
  const previewNameSize = useMemo(
    () => Math.max(18, Math.min(34, settings.widthMm / 3.4)),
    [settings.widthMm],
  );

  const update = (patch: Partial<IdCardPrintSettings>) => {
    const next = normalizeIdCardPrintSettings({ ...settings, ...patch }, eventTitle);
    sessionSettings.set(eventId, next);
    try {
      window.localStorage.setItem(storageKey(eventId), JSON.stringify(next));
    } catch {
      // Keep the settings only for this browser session when storage is unavailable.
    }
    window.dispatchEvent(new Event(settingsChangedEvent));
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{attendee ? "Print attendee ID card" : "Set up attendee ID cards"}</DialogTitle>
      <DialogContent>
        <Stack direction={{ xs: "column", md: "row" }} spacing={3} sx={{ pt: 0.5 }}>
          <Stack spacing={2} sx={{ flex: 1, minWidth: 0 }}>
            <Alert severity="info">
              A6 portrait is the default. These options are saved only in this browser for this event.
            </Alert>
            <Box>
              <Typography variant="subtitle2" gutterBottom>Paper size</Typography>
              <ButtonGroup size="small" aria-label="ID card paper size">
                <Button variant={isA6Portrait ? "contained" : "outlined"} onClick={() => update(A6_PORTRAIT)}>A6 portrait</Button>
                <Button variant={isA6Landscape ? "contained" : "outlined"} onClick={() => update(A6_LANDSCAPE)}>A6 landscape</Button>
              </ButtonGroup>
            </Box>
            <Stack direction="row" spacing={1.5}>
              <TextField label="Width (mm)" type="number" value={settings.widthMm} onChange={(event) => update({ widthMm: Number(event.target.value) })} slotProps={{ htmlInput: { min: 40, max: 300, step: 0.1 } }} fullWidth />
              <TextField label="Height (mm)" type="number" value={settings.heightMm} onChange={(event) => update({ heightMm: Number(event.target.value) })} slotProps={{ htmlInput: { min: 40, max: 300, step: 0.1 } }} fullWidth />
            </Stack>
            <TextField label="Card heading" value={settings.heading} onChange={(event) => update({ heading: event.target.value })} slotProps={{ htmlInput: { maxLength: 120 } }} fullWidth />
            <TextField label="Badge label" value={settings.badgeLabel} onChange={(event) => update({ badgeLabel: event.target.value })} slotProps={{ htmlInput: { maxLength: 40 } }} fullWidth />
            <FormControlLabel control={<Switch checked={settings.showEmail} onChange={(_, checked) => update({ showEmail: checked })} />} label="Include attendee email" />
          </Stack>
          <Stack spacing={1} sx={{ flex: 1, minWidth: 0, alignItems: "center" }}>
            <Typography variant="subtitle2" color="text.secondary">Preview · {paperDescription}</Typography>
            <Box sx={{ width: "min(100%, 340px)", aspectRatio: ratio, border: "2px solid", borderColor: "text.primary", bgcolor: "background.paper", p: 2.5, display: "flex", flexDirection: "column", boxShadow: 2 }}>
              <Typography sx={{ fontSize: "0.62rem", letterSpacing: "0.14em", fontWeight: 700, color: "text.secondary" }}>{settings.badgeLabel}</Typography>
              <Typography sx={{ mt: 1, fontSize: "1rem", fontWeight: 700, lineHeight: 1.2 }}>{settings.heading}</Typography>
              <Box sx={{ height: 2, bgcolor: "text.primary", my: 2 }} />
              <Typography sx={{ fontSize: `${previewNameSize}px`, fontWeight: 800, lineHeight: 1.05, overflowWrap: "anywhere" }}>{sampleAttendee.displayName}</Typography>
              {settings.showEmail && sampleAttendee.email ? <Typography variant="body2" color="text.secondary" sx={{ mt: 1, overflowWrap: "anywhere" }}>{sampleAttendee.email}</Typography> : null}
              <Typography variant="caption" color="text.secondary" sx={{ mt: "auto" }}>Checked in</Typography>
            </Box>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">Close</Button>
        <Button variant="contained" startIcon={<PrintOutlinedIcon />} disabled={!attendee} onClick={() => {
          if (!attendee || printCard(settings, attendee)) return;
          window.alert("The print window was blocked. Allow pop-ups for this check-in station and try again.");
        }}>
          Print ID card
        </Button>
      </DialogActions>
    </Dialog>
  );
}
