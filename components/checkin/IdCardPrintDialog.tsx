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
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import QRCode from "react-qr-code";
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
  /** Active ticket bearer token used only for rendering this attendee's QR. */
  checkInQrToken: string;
  checkInDetails: Array<{ label: string; value: string }>;
  registrationDetails: Array<{ key: string; label: string; value: string }>;
};

type RegistrationField = { key: string; label: string };
type PrintableField = { key: string; label: string; value: string };

const storageKey = (eventId: string) => `yuyu:checkin:id-card:${eventId}`;
const settingsChangedEvent = "yuyu:id-card-print-settings-changed";
const sessionSettings = new Map<string, IdCardPrintSettings>();
const registrationFieldKey = (key: string) => `registration:${key}`;
// Keep the longest paper edge at a fixed preview length so orientation changes
// do not inadvertently change the apparent scale of the card.
const PREVIEW_LONG_EDGE_PX = 340;
const TEMPLATE_OPTIONS = [
  { key: "classic", label: "Classic", description: "Framed and balanced" },
  { key: "bold", label: "Bold", description: "Strong side-band identity" },
  { key: "minimal", label: "Minimal", description: "Clean editorial layout" },
] as const;

function readSettings(eventId: string, eventTitle: string, organisationName: string) {
  const cached = sessionSettings.get(eventId);
  if (cached) return cached;
  const fallback = defaultIdCardPrintSettings(eventTitle, organisationName);
  try {
    const saved = window.localStorage.getItem(storageKey(eventId));
    if (saved) {
      const settings = normalizeIdCardPrintSettings(JSON.parse(saved), eventTitle, organisationName);
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

function safeLogoUrl(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith("/")) return trimmed;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function printableFields(
  settings: IdCardPrintSettings,
  attendee: Attendee,
): PrintableField[] {
  const registrationDetails = new Map(attendee.registrationDetails.map((detail) => [detail.key, detail]));
  return settings.printFieldKeys.flatMap((key) => {
    const detail = registrationDetails.get(key.startsWith("registration:") ? key.slice("registration:".length) : key);
    return detail ? [{ key, label: detail.label, value: detail.value }] : [];
  });
}

function printableDetails(fields: PrintableField[], settings: IdCardPrintSettings) {
  if (fields.length === 0) return "";
  return `<dl class="details">${fields.map((detail) => {
    const label = settings.printFieldLabels[detail.key] ?? detail.label;
    return `<div${label ? "" : ' class="label-free"'}>${label ? `<dt>${escapePrintHtml(label)}</dt>` : ""}<dd>${escapePrintHtml(detail.value)}</dd></div>`;
  }).join("")}</dl>`;
}

async function printCard(params: { settings: IdCardPrintSettings; attendee: Attendee; organisationLogoUrl: string | null }) {
  const { settings, attendee, organisationLogoUrl } = params;
  const printWindow = window.open("", "_blank");
  if (!printWindow) return false;

  let qrDataUrl: string;
  try {
    const QRCode = await import("qrcode");
    qrDataUrl = await QRCode.toDataURL(attendee.checkInQrToken, {
      width: 360,
      margin: 0,
      color: { dark: "#000000", light: "#FFFFFF" },
    });
  } catch {
    printWindow.close();
    return false;
  }

  const heading = escapePrintHtml(settings.heading);
  const badgeLabel = escapePrintHtml(settings.badgeLabel);
  const name = escapePrintHtml(attendee.displayName);
  const email = attendee.email ? escapePrintHtml(attendee.email) : "";
  const emailLine = settings.showEmail && email ? `<p class="email">${email}</p>` : "";
  const logoUrl = settings.showLogo ? safeLogoUrl(organisationLogoUrl) : null;
  const logo = logoUrl ? `<img id="badge-logo" class="logo" src="${escapePrintHtml(logoUrl)}" alt="">` : "";
  const details = printableDetails(printableFields(settings, attendee), settings);

  printWindow.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><title>${name} ID card</title><style>
  @page { size: ${settings.widthMm}mm ${settings.heightMm}mm; margin: 0; }
  :root { --accent: #000; }
  * { box-sizing: border-box; -webkit-print-color-adjust: economy; print-color-adjust: economy; }
  html, body { width: ${settings.widthMm}mm; height: ${settings.heightMm}mm; margin: 0; }
  body { color: #0F172A; font-family: Inter, Arial, Helvetica, sans-serif; }
  .card { width: 100%; height: 100%; padding: 9mm; display: flex; flex-direction: column; position: relative; background: #fff; border: 0.6mm solid #0F172A; overflow: hidden; }
  .top { display: flex; align-items: flex-start; justify-content: space-between; gap: 5mm; }
  .logo { width: 13mm; height: 13mm; border-radius: 3mm; object-fit: contain; background: #fff; padding: 1mm; }
  .label { margin: 0; color: var(--accent); font-size: 8pt; font-weight: 800; letter-spacing: 0.16em; }
  .heading { margin: 2.5mm 0 0; font-size: 14pt; font-weight: 700; line-height: 1.2; }
  .rule { width: 100%; height: 1.2mm; margin: 6mm 0; background: var(--accent); }
  .name { margin: 0; font-size: 28pt; font-weight: 800; line-height: 1.03; letter-spacing: -0.03em; overflow-wrap: anywhere; }
  .email { margin: 4mm 0 0; color: #475569; font-size: 10pt; overflow-wrap: anywhere; }
  .details { margin: 5mm 0 0; padding: 3mm 0 0; border-top: 0.3mm solid #CBD5E1; }
  .details div { display: flex; justify-content: space-between; gap: 4mm; margin-top: 1.5mm; font-size: 8.5pt; }
  .details .label-free { justify-content: flex-start; }
  .details dt { color: #64748B; } .details dd { margin: 0; font-weight: 700; text-align: right; }
  .qr-block { position: absolute; z-index: 2; background: #fff; padding: 1mm; }
  .qr { width: 22mm; height: 22mm; display: block; image-rendering: pixelated; }
  .footer { margin: auto 0 0; padding-top: 5mm; color: #64748B; font-size: 8pt; }
  /* Classic is a traditional framed event badge. */
  .classic .top { padding-bottom: 2mm; border-bottom: 0.3mm solid #000; }
  .classic .rule { width: 20mm; margin: 4mm 0 6mm; }
  .classic .qr-block { right: 8mm; bottom: 8mm; }
  .classic .details { max-width: calc(100% - 30mm); }
  .classic .footer { padding-right: 30mm; }
  /* Bold uses a distinct side-band and uppercase name treatment. */
  .card.bold { border: 1.2mm solid #000; padding-left: 16mm; }
  .bold::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 6mm; background: #000; }
  .bold .top { order: 4; margin-top: auto; padding-top: 4mm; border-top: 0.6mm solid #000; }
  .bold .rule { display: none; } .bold .name { order: 1; }
  .bold .email { order: 2; } .bold .details { order: 3; }
  .bold .qr-block { top: 8mm; right: 8mm; }
  .bold .name { padding-right: 30mm; font-size: 30pt; text-transform: uppercase; letter-spacing: -0.04em; }
  .bold .details { border-top-width: 0.6mm; } .bold .footer { order: 5; margin-top: 2mm; font-weight: 700; }
  /* Minimal removes the enclosing frame and uses whitespace and a hairline divider. */
  .card.minimal { border: 0; padding: 12mm 10mm; }
  .minimal .top { order: 4; display: block; margin-top: auto; padding: 4mm 30mm 0 0; border-top: 0.3mm solid #000; }
  .minimal .logo { position: absolute; top: 10mm; right: 10mm; }
  .minimal .heading { margin-top: 1mm; font-weight: 500; font-size: 12pt; max-width: 72%; }
  .minimal .rule { order: 0; width: 12mm; height: 0.8mm; margin: 1mm 0 0; }
  .minimal .name { order: 1; margin-top: 6mm; font-size: 26pt; font-weight: 700; letter-spacing: -0.04em; }
  .minimal .email { order: 2; } .minimal .details { order: 3; margin-top: 6mm; border-top: 0; padding-top: 0; }
  .minimal .qr-block { position: absolute; right: 8mm; bottom: 8mm; }
  .minimal .footer { order: 5; margin-top: 2mm; padding-right: 30mm; }
  /* One high-contrast output works well on both monochrome laser and thermal printers. */
  .card { color: #000; border-color: #000; } .label, .heading, .footer, .email, .details dt { color: #000; }
  .rule { background: #000; } .details { border-color: #000; } .logo { filter: grayscale(1) contrast(1.8); }
</style></head><body><main class="card ${settings.template}"><div class="top"><div><p class="label">${badgeLabel}</p><h1 class="heading">${heading}</h1></div>${logo}</div><div class="rule"></div><p class="name">${name}</p>${emailLine}${details}<div class="qr-block"><img id="badge-qr" class="qr" src="${escapePrintHtml(qrDataUrl)}" alt="Check-in QR code"></div><p class="footer">${escapePrintHtml(settings.footerText)}</p></main></body></html>`);
  printWindow.document.close();
  printWindow.focus();

  let printed = false;
  const triggerPrint = () => {
    if (printed) return;
    printed = true;
    printWindow.print();
  };
  const images = ["badge-logo", "badge-qr"]
    .map((id) => printWindow.document.getElementById(id) as HTMLImageElement | null)
    .filter((image): image is HTMLImageElement => Boolean(image));
  if (images.length === 0) window.setTimeout(triggerPrint, 100);
  else {
    let remaining = images.filter((image) => !image.complete).length;
    if (remaining === 0) window.setTimeout(triggerPrint, 100);
    else images.forEach((image) => {
      const finish = () => {
        remaining -= 1;
        if (remaining === 0) triggerPrint();
      };
      image.addEventListener("load", finish, { once: true });
      image.addEventListener("error", finish, { once: true });
    });
    window.setTimeout(triggerPrint, 1500);
  }
  return true;
}

export function IdCardPrintDialog(props: {
  open: boolean;
  onClose: () => void;
  eventId: string;
  eventTitle: string;
  organisationName: string;
  organisationLogoUrl: string | null;
  attendee: Attendee | null;
  registrationFields: RegistrationField[];
}) {
  const { open, onClose, eventId, eventTitle, organisationName, organisationLogoUrl, attendee, registrationFields } = props;
  const defaultSettings = useMemo(() => defaultIdCardPrintSettings(eventTitle, organisationName), [eventTitle, organisationName]);
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
  const getSnapshot = useCallback(() => readSettings(eventId, eventTitle, organisationName), [eventId, eventTitle, organisationName]);
  const getServerSnapshot = useCallback(() => defaultSettings, [defaultSettings]);
  const settings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const sampleAttendee = attendee ?? {
    displayName: "Attendee name",
    email: "attendee@example.com",
    checkInQrToken: "preview-check-in-token",
    checkInDetails: [{ label: "Food preference", value: "Vegetarian" }],
    registrationDetails: registrationFields.map((field) => ({
      key: field.key,
      label: field.label,
      value: /role/i.test(`${field.key} ${field.label}`) ? "Speaker" : "Example answer",
    })),
  };
  const fieldOptions = useMemo(() => (
    registrationFields.map((field) => ({
      key: registrationFieldKey(field.key),
      label: field.label,
      detail: /organi[sz]ation|company/i.test(`${field.key} ${field.label}`)
        ? "Participant organisation field"
        : /role/i.test(`${field.key} ${field.label}`)
          ? "Role field"
          : "Registration field",
    }))
  ), [registrationFields]);
  const selectedFieldOptions = settings.printFieldKeys.flatMap((key) => {
    const field = fieldOptions.find((option) => option.key === key);
    return field ? [field] : [];
  });
  const availableFieldOptions = fieldOptions.filter((field) => !settings.printFieldKeys.includes(field.key));
  const previewFields = printableFields(settings, sampleAttendee);
  const ratio = `${settings.widthMm} / ${settings.heightMm}`;
  const paperDescription = `${settings.widthMm} × ${settings.heightMm} mm`;
  const previewWidthPx = PREVIEW_LONG_EDGE_PX * settings.widthMm / Math.max(settings.widthMm, settings.heightMm);
  const isA6Portrait = settings.widthMm === A6_PORTRAIT.widthMm && settings.heightMm === A6_PORTRAIT.heightMm;
  const isA6Landscape = settings.widthMm === A6_LANDSCAPE.widthMm && settings.heightMm === A6_LANDSCAPE.heightMm;
  const previewNameSize = useMemo(() => Math.max(18, Math.min(34, settings.widthMm / 3.4)), [settings.widthMm]);
  const logoUrl = settings.showLogo ? safeLogoUrl(organisationLogoUrl) : null;

  const update = (patch: Partial<IdCardPrintSettings>) => {
    const next = normalizeIdCardPrintSettings({ ...settings, ...patch }, eventTitle, organisationName);
    sessionSettings.set(eventId, next);
    try {
      window.localStorage.setItem(storageKey(eventId), JSON.stringify(next));
    } catch {
      // Keep the settings only for this browser session when storage is unavailable.
    }
    window.dispatchEvent(new Event(settingsChangedEvent));
  };

  const togglePrintField = (key: string, checked: boolean) => {
    const printFieldKeys = checked
      ? [...settings.printFieldKeys, key]
      : settings.printFieldKeys.filter((fieldKey) => fieldKey !== key);
    update({ printFieldKeys });
  };

  const updatePrintFieldLabel = (key: string, label: string) => {
    const printFieldLabels = { ...settings.printFieldLabels };
    // An explicit empty value is meaningful: print the answer without a label.
    printFieldLabels[key] = label;
    update({ printFieldLabels });
  };

  const previewTemplateSx = settings.template === "bold"
    ? {
        border: "3px solid #000",
        pl: 4.5,
        "&::before": {
          content: '""', position: "absolute", inset: 0, right: "auto", width: 15, bgcolor: "#000",
        },
      }
    : settings.template === "minimal"
      ? { border: 0, boxShadow: 1, p: 3, pt: 3.5 }
      : {};
  const previewQrSx = settings.template !== "bold"
    ? { position: "absolute" as const, right: 16, bottom: 16 }
    : { position: "absolute" as const, top: 16, right: 16 };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{attendee ? "Print attendee ID card" : "Set up attendee ID cards"}</DialogTitle>
      <DialogContent dividers>
        <Stack direction={{ xs: "column", md: "row" }} spacing={3}>
          <Stack spacing={2} sx={{ flex: 1, minWidth: 0 }}>
            <Alert severity="info">Card settings are saved only in this browser for this event.</Alert>
            <Box>
              <Typography variant="subtitle2" gutterBottom>Template</Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} aria-label="ID card template">
                {TEMPLATE_OPTIONS.map((template) => (
                  <Button
                    key={template.key}
                    variant={settings.template === template.key ? "contained" : "outlined"}
                    onClick={() => update({ template: template.key })}
                    sx={{ flex: 1, minHeight: 64, alignItems: "flex-start", justifyContent: "flex-start", textAlign: "left", textTransform: "none" }}
                  >
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 800 }}>{template.label}</Typography>
                      <Typography variant="caption" sx={{ display: "block", opacity: 0.8 }}>{template.description}</Typography>
                    </Box>
                  </Button>
                ))}
              </Stack>
            </Box>
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
            <Typography variant="body2" color="text.secondary">The card uses one high-contrast layout that prints cleanly on both monochrome laser and thermal printers.</Typography>
            <TextField label="Card heading" value={settings.heading} onChange={(event) => update({ heading: event.target.value })} slotProps={{ htmlInput: { maxLength: 120 } }} fullWidth />
            <TextField label="Badge label" value={settings.badgeLabel} onChange={(event) => update({ badgeLabel: event.target.value })} slotProps={{ htmlInput: { maxLength: 40 } }} fullWidth />
            <TextField label="Footer text" value={settings.footerText} onChange={(event) => update({ footerText: event.target.value })} slotProps={{ htmlInput: { maxLength: 80 } }} fullWidth />
            <Divider />
            <FormControlLabel control={<Switch checked={settings.showLogo} onChange={(_, checked) => update({ showLogo: checked })} />} label="Include organisation logo" />
            <FormControlLabel control={<Switch checked={settings.showEmail} onChange={(_, checked) => update({ showEmail: checked })} />} label="Include attendee email" />
            <Divider />
            <Box>
              <Typography variant="subtitle2">Card fields</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Add the attendee details you want directly from this event&apos;s registration form—for example Organisation, Company, or Role.
              </Typography>
              {fieldOptions.length === 0 ? (
                <Alert severity="warning">This event has no registration-form fields to add to the card yet.</Alert>
              ) : (
                <Stack spacing={1}>
                  <TextField
                    select
                    label="Add registration field"
                    value=""
                    onChange={(event) => togglePrintField(event.target.value, true)}
                    fullWidth
                    disabled={availableFieldOptions.length === 0}
                    helperText={availableFieldOptions.length === 0 ? "All registration fields are already on this card." : "Choose a field to add it to the card."}
                  >
                    <MenuItem value="" disabled>Select a registration field</MenuItem>
                    {availableFieldOptions.map((field) => (
                      <MenuItem key={field.key} value={field.key}>{field.label} · {field.detail}</MenuItem>
                    ))}
                  </TextField>
                  {selectedFieldOptions.map((field) => (
                    <Stack key={field.key} spacing={0.5} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1 }}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between" }}>
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>{field.label}</Typography>
                          <Typography variant="caption" color="text.secondary">{field.detail}</Typography>
                        </Box>
                        <Button size="small" color="inherit" onClick={() => togglePrintField(field.key, false)}>Remove</Button>
                      </Stack>
                      <TextField
                        label="Printed label"
                        value={settings.printFieldLabels[field.key] ?? field.label}
                        onChange={(event) => updatePrintFieldLabel(field.key, event.target.value)}
                        slotProps={{ htmlInput: { maxLength: 60 } }}
                        size="small"
                        fullWidth
                        helperText="Clear this to print the answer without a label."
                      />
                    </Stack>
                  ))}
                </Stack>
              )}
            </Box>
          </Stack>
          <Stack spacing={1} sx={{ flex: 1, minWidth: 0, alignItems: "center" }}>
            <Typography variant="subtitle2" color="text.secondary">Live preview · {paperDescription}</Typography>
            <Box sx={{ width: `${previewWidthPx}px`, maxWidth: "100%", aspectRatio: ratio, position: "relative", border: "2px solid", borderColor: "#000", bgcolor: "#fff", color: "#000", p: 2.5, display: "flex", flexDirection: "column", boxShadow: 3, overflow: "hidden", ...previewTemplateSx }}>
              <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start", position: "relative", zIndex: 1, order: settings.template === "classic" ? 0 : 4, mt: settings.template === "classic" ? 0 : "auto", pt: settings.template === "classic" ? 0 : 1, ...(settings.template === "classic" ? { pb: 0.75, borderBottom: "1px solid #000" } : { borderTop: "1px solid #000" }) }}>
                <Box>
                  <Typography sx={{ fontSize: "0.62rem", letterSpacing: "0.14em", fontWeight: 800 }}>{settings.badgeLabel}</Typography>
                  <Typography sx={{ mt: settings.template === "minimal" ? 0.25 : 0.75, fontSize: settings.template === "minimal" ? "0.9rem" : "1rem", fontWeight: settings.template === "minimal" ? 500 : 700, lineHeight: 1.2 }}>{settings.heading}</Typography>
                </Box>
                {logoUrl ? <Box component="img" src={logoUrl} alt="" sx={{ width: 34, height: 34, objectFit: "contain", borderRadius: 1, bgcolor: "#fff", p: 0.25, ...(settings.template === "minimal" ? { position: "absolute", top: 16, right: 16 } : {}) }} /> : null}
              </Stack>
              <Box sx={{ order: 0, display: settings.template === "bold" ? "none" : "block", width: settings.template === "classic" ? "28%" : "16%", height: settings.template === "minimal" ? 2 : 3, bgcolor: "#000", my: settings.template === "minimal" ? 1 : 2 }} />
              <Typography sx={{ order: 1, mt: settings.template === "minimal" ? 2.5 : 0, pr: settings.template === "bold" ? 11 : 0, fontSize: `${settings.template === "bold" ? previewNameSize + 2 : previewNameSize}px`, fontWeight: settings.template === "minimal" ? 700 : 800, lineHeight: 1.05, letterSpacing: "-0.03em", textTransform: settings.template === "bold" ? "uppercase" : "none", overflowWrap: "anywhere" }}>{sampleAttendee.displayName}</Typography>
              {settings.showEmail && sampleAttendee.email ? <Typography variant="body2" sx={{ order: 2, mt: 1, opacity: 0.75, overflowWrap: "anywhere" }}>{sampleAttendee.email}</Typography> : null}
              <Box sx={{ ...previewQrSx, bgcolor: "#fff", p: 0.5, zIndex: 1 }}>
                <QRCode value={sampleAttendee.checkInQrToken} size={settings.template === "minimal" ? 54 : 62} bgColor="#FFFFFF" fgColor="#000000" level="M" />
              </Box>
              {previewFields.length > 0 ? (
                <Stack spacing={0.4} sx={{ order: 3, maxWidth: settings.template === "classic" ? "62%" : undefined, borderTop: settings.template === "minimal" ? 0 : "1px solid", borderColor: "#000", mt: 1.5, pt: settings.template === "minimal" ? 0 : 1 }}>
                  {previewFields.map((detail) => {
                    const label = settings.printFieldLabels[detail.key] ?? detail.label;
                    return <Stack direction="row" key={detail.key} sx={{ justifyContent: label ? "space-between" : "flex-start", gap: 1 }}>{label ? <Typography variant="caption" sx={{ opacity: 0.72 }}>{label}</Typography> : null}<Typography variant="caption" sx={{ fontWeight: 700, textAlign: "right" }}>{detail.value}</Typography></Stack>;
                  })}
                </Stack>
              ) : null}
              <Typography variant="caption" sx={{ order: 5, mt: settings.template === "classic" ? "auto" : 1, opacity: 0.68 }}>{settings.footerText}</Typography>
            </Box>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">Close</Button>
        <Button variant="contained" startIcon={<PrintOutlinedIcon />} disabled={!attendee} onClick={() => {
          if (!attendee) return;
          void printCard({ settings, attendee, organisationLogoUrl }).then((printed) => {
            if (!printed) window.alert("The print window was blocked or the QR code could not be prepared. Allow pop-ups for this check-in station and try again.");
          });
        }}>Print ID card</Button>
      </DialogActions>
    </Dialog>
  );
}
