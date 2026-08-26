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
import {
  A6_LANDSCAPE,
  A6_PORTRAIT,
  defaultIdCardPrintSettings,
  normalizeIdCardPrintSettings,
  THERMAL_4X6,
  type IdCardPrintSettings,
} from "@/lib/idCardPrint";

type Attendee = {
  displayName: string;
  email: string | null;
  checkInDetails: Array<{ label: string; value: string }>;
  registrationDetails: Array<{ key: string; label: string; value: string }>;
};

type RegistrationField = { key: string; label: string };
type PrintableField = { key: string; label: string; value: string };

const storageKey = (eventId: string) => `yuyu:checkin:id-card:${eventId}`;
const settingsChangedEvent = "yuyu:id-card-print-settings-changed";
const sessionSettings = new Map<string, IdCardPrintSettings>();
const registrationFieldKey = (key: string) => `registration:${key}`;

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
  return `<dl class="details">${fields.map((detail) => (
    `<div><dt>${escapePrintHtml(settings.printFieldLabels[detail.key] ?? detail.label)}</dt><dd>${escapePrintHtml(detail.value)}</dd></div>`
  )).join("")}</dl>`;
}

function printCard(params: { settings: IdCardPrintSettings; attendee: Attendee; organisationLogoUrl: string | null }) {
  const { settings, attendee, organisationLogoUrl } = params;
  const printWindow = window.open("", "_blank");
  if (!printWindow) return false;

  const heading = escapePrintHtml(settings.heading);
  const badgeLabel = escapePrintHtml(settings.badgeLabel);
  const name = escapePrintHtml(attendee.displayName);
  const email = attendee.email ? escapePrintHtml(attendee.email) : "";
  const emailLine = settings.showEmail && email ? `<p class="email">${email}</p>` : "";
  const logoUrl = settings.showLogo && settings.printerProfile !== "thermal" ? safeLogoUrl(organisationLogoUrl) : null;
  const logo = logoUrl ? `<img id="badge-logo" class="logo" src="${escapePrintHtml(logoUrl)}" alt="">` : "";
  const details = printableDetails(printableFields(settings, attendee), settings);

  printWindow.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><title>${name} ID card</title><style>
  @page { size: ${settings.widthMm}mm ${settings.heightMm}mm; margin: 0; }
  :root { --accent: #000; }
  * { box-sizing: border-box; -webkit-print-color-adjust: economy; print-color-adjust: economy; }
  html, body { width: ${settings.widthMm}mm; height: ${settings.heightMm}mm; margin: 0; }
  body { color: #0F172A; font-family: Inter, Arial, Helvetica, sans-serif; }
  .card { width: 100%; height: 100%; padding: 9mm; display: flex; flex-direction: column; background: #fff; border: 0.6mm solid #0F172A; overflow: hidden; }
  .top { display: flex; align-items: flex-start; justify-content: space-between; gap: 5mm; }
  .logo { width: 13mm; height: 13mm; border-radius: 3mm; object-fit: contain; background: #fff; padding: 1mm; }
  .label { margin: 0; color: var(--accent); font-size: 8pt; font-weight: 800; letter-spacing: 0.16em; }
  .heading { margin: 2.5mm 0 0; font-size: 14pt; font-weight: 700; line-height: 1.2; }
  .rule { width: 100%; height: 1.2mm; margin: 6mm 0; background: var(--accent); }
  .name { margin: 0; font-size: 28pt; font-weight: 800; line-height: 1.03; letter-spacing: -0.03em; overflow-wrap: anywhere; }
  .email { margin: 4mm 0 0; color: #475569; font-size: 10pt; overflow-wrap: anywhere; }
  .details { margin: 5mm 0 0; padding: 3mm 0 0; border-top: 0.3mm solid #CBD5E1; }
  .details div { display: flex; justify-content: space-between; gap: 4mm; margin-top: 1.5mm; font-size: 8.5pt; }
  .details dt { color: #64748B; } .details dd { margin: 0; font-weight: 700; text-align: right; }
  .footer { margin: auto 0 0; padding-top: 5mm; color: #64748B; font-size: 8pt; }
  .card.bold { border: 0; } .bold .top { margin: -9mm -9mm 0; padding: 8mm 9mm 7mm; background: var(--accent); color: #fff; }
  .bold .label, .bold .heading { color: #fff; } .bold .rule { height: 0.5mm; margin-top: 7mm; }
  .bold .footer { color: #475569; } .bold .logo { box-shadow: 0 0 0 0.4mm rgba(255,255,255,.55); }
  .card.minimal { border: 0.35mm solid #CBD5E1; } .minimal .rule { height: 0.35mm; } .minimal .label { color: #0F172A; }
  /* Monochrome laser: avoid colour fills and preserve crisp, high-contrast text. */
  .card.laser { color: #000; border-color: #000; }
  .laser .label, .laser .heading, .laser .footer, .laser .email, .laser .details dt { color: #000; }
  .laser .rule { background: #000; } .laser .details { border-color: #000; }
  .card.laser.bold { border: 0.6mm solid #000; } .laser.bold .top { margin: 0; padding: 0; background: #fff; color: #000; }
  .laser.bold .label, .laser.bold .heading { color: #000; } .laser .logo { filter: grayscale(1) contrast(1.8); }
  /* Thermal: no fills or logo rasterisation, bolder type, and a compact layout that conserves heat. */
  .card.thermal { padding: 6mm; color: #000; border: 0.4mm solid #000; font-family: Arial, Helvetica, sans-serif; }
  .thermal .logo { display: none; } .thermal .label, .thermal .heading, .thermal .footer, .thermal .email, .thermal .details dt { color: #000; }
  .thermal .top, .thermal.bold .top { margin: 0; padding: 0; background: #fff; color: #000; }
  .thermal .rule { height: 0.7mm; margin: 4mm 0; background: #000; } .thermal .name { font-size: 24pt; }
  .thermal .email { margin-top: 2.5mm; font-size: 9pt; } .thermal .details { margin-top: 3mm; padding-top: 2mm; border-color: #000; }
  .thermal .details div { margin-top: 1mm; font-size: 8pt; } .thermal .footer { padding-top: 3mm; font-size: 7.5pt; }
</style></head><body><main class="card ${settings.template} ${settings.printerProfile}"><div class="top"><div><p class="label">${badgeLabel}</p><h1 class="heading">${heading}</h1></div>${logo}</div><div class="rule"></div><p class="name">${name}</p>${emailLine}${details}<p class="footer">${escapePrintHtml(settings.footerText)}</p></main></body></html>`);
  printWindow.document.close();
  printWindow.focus();

  let printed = false;
  const triggerPrint = () => {
    if (printed) return;
    printed = true;
    printWindow.print();
  };
  const logoElement = printWindow.document.getElementById("badge-logo") as HTMLImageElement | null;
  if (logoElement) {
    logoElement.addEventListener("load", triggerPrint, { once: true });
    logoElement.addEventListener("error", triggerPrint, { once: true });
    window.setTimeout(triggerPrint, 1500);
  } else {
    window.setTimeout(triggerPrint, 100);
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
  const isA6Portrait = settings.widthMm === A6_PORTRAIT.widthMm && settings.heightMm === A6_PORTRAIT.heightMm;
  const isA6Landscape = settings.widthMm === A6_LANDSCAPE.widthMm && settings.heightMm === A6_LANDSCAPE.heightMm;
  const isThermal4x6 = settings.widthMm === THERMAL_4X6.widthMm && settings.heightMm === THERMAL_4X6.heightMm;
  const previewNameSize = useMemo(() => Math.max(18, Math.min(34, settings.widthMm / 3.4)), [settings.widthMm]);
  const logoUrl = settings.showLogo && settings.printerProfile !== "thermal" ? safeLogoUrl(organisationLogoUrl) : null;

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
    if (label.trim()) printFieldLabels[key] = label;
    else delete printFieldLabels[key];
    update({ printFieldLabels });
  };

  const isThermal = settings.printerProfile === "thermal";
  const printerDescription = isThermal
    ? "Thermal uses compact spacing, bold type, and no logo or filled backgrounds to keep heat use low and text sharp."
    : "Laser uses a white background, solid black rules, and grayscale logos for reliable black-and-white output.";

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{attendee ? "Print attendee ID card" : "Set up attendee ID cards"}</DialogTitle>
      <DialogContent dividers>
        <Stack direction={{ xs: "column", md: "row" }} spacing={3}>
          <Stack spacing={2} sx={{ flex: 1, minWidth: 0 }}>
            <Alert severity="info">Card settings are saved only in this browser for this event.</Alert>
            <Box>
              <Typography variant="subtitle2" gutterBottom>Printer type</Typography>
              <ButtonGroup size="small" aria-label="ID card printer type">
                <Button variant={settings.printerProfile === "laser" ? "contained" : "outlined"} onClick={() => update({ printerProfile: "laser" })}>Laser B&amp;W</Button>
                <Button variant={isThermal ? "contained" : "outlined"} onClick={() => update({ printerProfile: "thermal" })}>Thermal</Button>
              </ButtonGroup>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>{printerDescription}</Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" gutterBottom>Template</Typography>
              <ButtonGroup size="small" aria-label="ID card template">
                {(["classic", "bold", "minimal"] as const).map((template) => (
                  <Button key={template} variant={settings.template === template ? "contained" : "outlined"} onClick={() => update({ template })}>{template}</Button>
                ))}
              </ButtonGroup>
            </Box>
            <Box>
              <Typography variant="subtitle2" gutterBottom>Paper size</Typography>
              <ButtonGroup size="small" aria-label="ID card paper size">
                <Button variant={isA6Portrait ? "contained" : "outlined"} onClick={() => update(A6_PORTRAIT)}>A6 portrait</Button>
                <Button variant={isA6Landscape ? "contained" : "outlined"} onClick={() => update(A6_LANDSCAPE)}>A6 landscape</Button>
                {isThermal ? <Button variant={isThermal4x6 ? "contained" : "outlined"} onClick={() => update(THERMAL_4X6)}>Thermal 4 × 6</Button> : null}
              </ButtonGroup>
            </Box>
            <Stack direction="row" spacing={1.5}>
              <TextField label="Width (mm)" type="number" value={settings.widthMm} onChange={(event) => update({ widthMm: Number(event.target.value) })} slotProps={{ htmlInput: { min: 40, max: 300, step: 0.1 } }} fullWidth />
              <TextField label="Height (mm)" type="number" value={settings.heightMm} onChange={(event) => update({ heightMm: Number(event.target.value) })} slotProps={{ htmlInput: { min: 40, max: 300, step: 0.1 } }} fullWidth />
            </Stack>
            <Typography variant="body2" color="text.secondary">Print output is deliberately black and white for predictable laser toner and thermal-label results.</Typography>
            <TextField label="Card heading" value={settings.heading} onChange={(event) => update({ heading: event.target.value })} slotProps={{ htmlInput: { maxLength: 120 } }} fullWidth />
            <TextField label="Badge label" value={settings.badgeLabel} onChange={(event) => update({ badgeLabel: event.target.value })} slotProps={{ htmlInput: { maxLength: 40 } }} fullWidth />
            <TextField label="Footer text" value={settings.footerText} onChange={(event) => update({ footerText: event.target.value })} slotProps={{ htmlInput: { maxLength: 80 } }} fullWidth />
            <Divider />
            <FormControlLabel control={<Switch checked={settings.showLogo} onChange={(_, checked) => update({ showLogo: checked })} disabled={isThermal} />} label={isThermal ? "Organisation logo (not used for thermal)" : "Include organisation logo"} />
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
                      />
                    </Stack>
                  ))}
                </Stack>
              )}
            </Box>
          </Stack>
          <Stack spacing={1} sx={{ flex: 1, minWidth: 0, alignItems: "center" }}>
            <Typography variant="subtitle2" color="text.secondary">Live preview · {paperDescription}</Typography>
            <Box sx={{ width: "min(100%, 340px)", aspectRatio: ratio, border: "2px solid", borderColor: "#000", bgcolor: "#fff", color: "#000", p: isThermal ? 1.75 : 2.5, display: "flex", flexDirection: "column", boxShadow: 3, overflow: "hidden", fontFamily: isThermal ? "Arial, Helvetica, sans-serif" : undefined }}>
              <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <Box>
                  <Typography sx={{ fontSize: "0.62rem", letterSpacing: "0.14em", fontWeight: 800 }}>{settings.badgeLabel}</Typography>
                  <Typography sx={{ mt: 0.75, fontSize: "1rem", fontWeight: 700, lineHeight: 1.2 }}>{settings.heading}</Typography>
                </Box>
                {logoUrl ? <Box component="img" src={logoUrl} alt="" sx={{ width: 34, height: 34, objectFit: "contain", borderRadius: 1, bgcolor: "#fff", p: 0.25 }} /> : null}
              </Stack>
              <Box sx={{ height: isThermal ? 2 : settings.template === "minimal" ? 1 : 3, bgcolor: "#000", my: isThermal ? 1.25 : 2 }} />
              <Typography sx={{ fontSize: `${previewNameSize}px`, fontWeight: 800, lineHeight: 1.05, letterSpacing: "-0.03em", overflowWrap: "anywhere" }}>{sampleAttendee.displayName}</Typography>
              {settings.showEmail && sampleAttendee.email ? <Typography variant="body2" sx={{ mt: 1, opacity: 0.75, overflowWrap: "anywhere" }}>{sampleAttendee.email}</Typography> : null}
              {previewFields.length > 0 ? (
                <Stack spacing={0.4} sx={{ borderTop: "1px solid", borderColor: "#000", mt: isThermal ? 1 : 1.5, pt: 1 }}>
                  {previewFields.map((detail) => <Stack direction="row" key={detail.key} sx={{ justifyContent: "space-between", gap: 1 }}><Typography variant="caption" sx={{ opacity: 0.72 }}>{settings.printFieldLabels[detail.key] ?? detail.label}</Typography><Typography variant="caption" sx={{ fontWeight: 700, textAlign: "right" }}>{detail.value}</Typography></Stack>)}
                </Stack>
              ) : null}
              <Typography variant="caption" sx={{ mt: "auto", opacity: 0.68 }}>{settings.footerText}</Typography>
            </Box>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">Close</Button>
        <Button variant="contained" startIcon={<PrintOutlinedIcon />} disabled={!attendee} onClick={() => {
          if (!attendee || printCard({ settings, attendee, organisationLogoUrl })) return;
          window.alert("The print window was blocked. Allow pop-ups for this check-in station and try again.");
        }}>Print ID card</Button>
      </DialogActions>
    </Dialog>
  );
}
