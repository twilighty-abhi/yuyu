"use client";

import { useCallback, useMemo, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
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
  defaultIdCardElementBold,
  defaultIdCardElementPositions,
  defaultIdCardElementSizes,
  defaultIdCardElementTextSizes,
  defaultIdCardPrintSettings,
  normalizeIdCardPrintSettings,
  type IdCardLayoutElement,
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
type LayoutDrag = {
  element: IdCardLayoutElement;
  pointerX: number;
  pointerY: number;
  position: { xMm: number; yMm: number };
  previewRect: DOMRect;
};

const storageKey = (eventId: string) => `yuyu:checkin:id-card:${eventId}`;
const settingsChangedEvent = "yuyu:id-card-print-settings-changed";
const sessionSettings = new Map<string, IdCardPrintSettings>();
const registrationFieldKey = (key: string) => `registration:${key}`;
// Keep the longest paper edge at a fixed preview length so orientation changes
// do not inadvertently change the apparent scale of the card.
const PREVIEW_LONG_EDGE_PX = 340;
const SNAP_GRID_MM = 5;
const TEMPLATE_OPTIONS = [
  { key: "classic", label: "Classic", description: "Framed and balanced" },
  { key: "bold", label: "Bold", description: "Strong side-band identity" },
  { key: "minimal", label: "Minimal", description: "Clean editorial layout" },
] as const;
const LAYOUT_ELEMENT_LABELS: Record<IdCardLayoutElement, string> = {
  header: "Event heading",
  name: "Attendee name",
  email: "Email",
  details: "Registration fields",
  qr: "Check-in QR",
  footer: "Footer",
  logo: "Organisation logo",
};

function snapToGrid(value: number) {
  return Math.round(value / SNAP_GRID_MM) * SNAP_GRID_MM;
}

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

function printableDetails(fields: PrintableField[], settings: IdCardPrintSettings, style = "", bold = false) {
  if (fields.length === 0) return "";
  return `<dl class="details ${bold ? "is-bold" : "is-regular"}"${style ? ` style="${style}"` : ""}>${fields.map((detail) => {
    const label = settings.printFieldLabels[detail.key] ?? detail.label;
    return `<div${label ? "" : ' class="label-free"'}>${label ? `<dt>${escapePrintHtml(label)}</dt>` : ""}<dd>${escapePrintHtml(detail.value)}</dd></div>`;
  }).join("")}</dl>`;
}

function printPosition(settings: IdCardPrintSettings, element: IdCardLayoutElement) {
  const position = settings.elementPositions[element];
  return `left:${position.xMm}mm;top:${position.yMm}mm;`;
}

function printTextStyle(settings: IdCardPrintSettings, element: Exclude<IdCardLayoutElement, "qr" | "logo">) {
  const fontSize = element === "header" ? "" : `font-size:${settings.elementTextSizes[element]}pt;`;
  return `${printPosition(settings, element)}width:${settings.elementSizes[element]}mm;font-weight:${settings.elementBold[element] ? 700 : 400};${fontSize}`;
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
  const emailLine = settings.showEmail && email ? `<p class="email" style="${printTextStyle(settings, "email")}">${email}</p>` : "";
  const logoUrl = settings.showLogo ? safeLogoUrl(organisationLogoUrl) : null;
  const logo = logoUrl ? `<img id="badge-logo" class="logo" style="${printPosition(settings, "logo")}width:${settings.elementSizes.logo}mm;height:${settings.elementSizes.logo}mm;" src="${escapePrintHtml(logoUrl)}" alt="">` : "";
  const details = printableDetails(printableFields(settings, attendee), settings, printTextStyle(settings, "details"), settings.elementBold.details);

  printWindow.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><title>${name} ID card</title><style>
  @page { size: ${settings.widthMm}mm ${settings.heightMm}mm; margin: 0; }
  :root { --accent: #000; }
  * { box-sizing: border-box; -webkit-print-color-adjust: economy; print-color-adjust: economy; }
  html, body { width: ${settings.widthMm}mm; height: ${settings.heightMm}mm; margin: 0; }
  body { color: #0F172A; font-family: Inter, Arial, Helvetica, sans-serif; }
  .card { width: 100%; height: 100%; position: relative; background: #fff; border: 0.6mm solid #0F172A; overflow: hidden; }
  .top { position: absolute; width: 58%; margin: 0; }
  .logo { position: absolute; width: 13mm; height: 13mm; border-radius: 3mm; object-fit: contain; background: #fff; padding: 1mm; }
  .label { margin: 0; color: var(--accent); font-size: 8pt; font-weight: 800; letter-spacing: 0.16em; }
  .heading { margin: 2.5mm 0 0; font-size: 26pt; font-weight: 700; line-height: 1.08; letter-spacing: -0.025em; overflow-wrap: anywhere; }
  .name { position: absolute; margin: 0; font-size: 16pt; font-weight: 800; line-height: 1.12; letter-spacing: -0.015em; overflow-wrap: anywhere; }
  .email { position: absolute; margin: 0; color: #475569; font-size: 10pt; overflow-wrap: anywhere; }
  .details { position: absolute; margin: 0; padding: 3mm 0 0; border-top: 0.3mm solid #CBD5E1; }
  .details div { display: flex; justify-content: space-between; gap: 4mm; margin-top: 1.5mm; }
  .details .label-free { justify-content: flex-start; } .details.is-regular dd { font-weight: 400; }
  .details dt { color: #64748B; } .details dd { margin: 0; font-weight: 700; text-align: right; }
  .qr-block { position: absolute; z-index: 2; background: #fff; padding: 1mm; }
  .qr { width: ${settings.elementSizes.qr}mm; height: ${settings.elementSizes.qr}mm; display: block; image-rendering: pixelated; }
  .footer { position: absolute; margin: 0; color: #64748B; font-size: 8pt; }
  /* Classic is a traditional framed event badge. */
  .classic .top { padding-bottom: 2mm; border-bottom: 0.3mm solid #000; }
  /* Bold uses a distinct side-band and uppercase name treatment. */
  .card.bold { border: 1.2mm solid #000; }
  .bold::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 6mm; background: #000; }
  .bold .top { padding-top: 4mm; border-top: 0.6mm solid #000; }
  .bold .heading { font-size: 28pt; } .bold .name { font-size: 17pt; text-transform: uppercase; letter-spacing: -0.02em; }
  .bold .details { border-top-width: 0.6mm; } .bold .footer { font-weight: 700; }
  /* Minimal removes the enclosing frame and uses whitespace and a hairline divider. */
  .card.minimal { border: 0; }
  .minimal .top { display: block; padding: 4mm 0 0; border-top: 0.3mm solid #000; }
  .minimal .heading { margin-top: 1mm; font-size: 24pt; line-height: 1.1; }
  .minimal .name { font-size: 15pt; font-weight: 700; letter-spacing: -0.015em; }
  .minimal .details { border-top: 0; padding-top: 0; }
  /* One high-contrast output works well on both monochrome laser and thermal printers. */
  .card { color: #000; border-color: #000; } .label, .heading, .footer, .email, .details dt { color: #000; }
  .rule { background: #000; } .details { border-color: #000; } .logo { filter: grayscale(1) contrast(1.8); }
</style></head><body><main class="card ${settings.template}"><div class="top" style="${printTextStyle(settings, "header")}"><p class="label" style="font-weight:${settings.elementBold.header ? 800 : 400}">${badgeLabel}</p><h1 class="heading" style="font-size:${settings.elementTextSizes.header}pt;font-weight:${settings.elementBold.header ? 700 : 400}">${heading}</h1></div>${logo}<p class="name" style="${printTextStyle(settings, "name")}">${name}</p>${emailLine}${details}<div class="qr-block" style="${printPosition(settings, "qr")}"><img id="badge-qr" class="qr" src="${escapePrintHtml(qrDataUrl)}" alt="Check-in QR code"></div><p class="footer" style="${printTextStyle(settings, "footer")}">${escapePrintHtml(settings.footerText)}</p></main></body></html>`);
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
  const [layoutDrag, setLayoutDrag] = useState<LayoutDrag | null>(null);
  const [selectedLayoutElement, setSelectedLayoutElement] = useState<IdCardLayoutElement>("name");
  const draggingElement = layoutDrag?.element ?? null;
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
      value: `{{${field.label}}}`,
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
  const previewPixelsPerMillimetre = previewWidthPx / settings.widthMm;
  const isA6Portrait = settings.widthMm === A6_PORTRAIT.widthMm && settings.heightMm === A6_PORTRAIT.heightMm;
  const isA6Landscape = settings.widthMm === A6_LANDSCAPE.widthMm && settings.heightMm === A6_LANDSCAPE.heightMm;
  const logoUrl = settings.showLogo ? safeLogoUrl(organisationLogoUrl) : null;
  const selectedElementIsText = selectedLayoutElement !== "qr" && selectedLayoutElement !== "logo";
  const previewTextSize = (element: IdCardLayoutElement) => `${settings.elementTextSizes[element] * 0.3528 * previewPixelsPerMillimetre}px`;
  const previewPositionSx = (element: IdCardLayoutElement) => {
    const position = settings.elementPositions[element];
    return {
      position: "absolute" as const,
      left: `${position.xMm * previewPixelsPerMillimetre}px`,
      top: `${position.yMm * previewPixelsPerMillimetre}px`,
      cursor: "grab",
      touchAction: "none",
      userSelect: "none",
      zIndex: draggingElement === element ? 3 : selectedLayoutElement === element ? 2 : 1,
      outline: draggingElement === element || selectedLayoutElement === element ? "2px solid #1976d2" : "1px dashed transparent",
      outlineOffset: 2,
      "&:hover": { outlineColor: "#1976d2" },
      "&:focus-visible": { outline: "2px solid #1976d2", outlineOffset: 2 },
    };
  };
  const previewItemWidth = (element: IdCardLayoutElement) => `${settings.elementSizes[element] * previewPixelsPerMillimetre}px`;

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

  const updateElementPosition = (element: IdCardLayoutElement, xMm: number, yMm: number) => {
    const current = settings.elementPositions[element];
    const squareElement = element === "qr" || element === "logo";
    const next = {
      xMm: Math.min(Math.max(0, settings.widthMm - settings.elementSizes[element] - 4), Math.max(0, snapToGrid(xMm))),
      yMm: Math.min(Math.max(0, settings.heightMm - (squareElement ? settings.elementSizes[element] : 0) - 4), Math.max(0, snapToGrid(yMm))),
    };
    if (current.xMm === next.xMm && current.yMm === next.yMm) return;
    update({ elementPositions: { ...settings.elementPositions, [element]: next } });
  };

  const updateElementSize = (element: IdCardLayoutElement, sizeMm: number) => {
    update({ elementSizes: { ...settings.elementSizes, [element]: sizeMm } });
  };

  const updateElementTextSize = (element: IdCardLayoutElement, sizePt: number) => {
    update({ elementTextSizes: { ...settings.elementTextSizes, [element]: sizePt } });
  };

  const startLayoutDrag = (element: IdCardLayoutElement, event: ReactPointerEvent<HTMLElement>) => {
    const preview = event.currentTarget.closest<HTMLElement>("[data-id-card-preview]");
    if (event.button !== 0 || !preview) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setLayoutDrag({
      element,
      pointerX: event.clientX,
      pointerY: event.clientY,
      position: settings.elementPositions[element],
      previewRect: preview.getBoundingClientRect(),
    });
    setSelectedLayoutElement(element);
  };

  const moveLayoutDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = layoutDrag;
    if (!drag) return;
    updateElementPosition(
      drag.element,
      drag.position.xMm + ((event.clientX - drag.pointerX) * settings.widthMm / drag.previewRect.width),
      drag.position.yMm + ((event.clientY - drag.pointerY) * settings.heightMm / drag.previewRect.height),
    );
  };

  const endLayoutDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setLayoutDrag(null);
  };

  const layoutItemProps = (element: IdCardLayoutElement) => ({
    role: "button" as const,
    tabIndex: 0,
    "aria-label": `${LAYOUT_ELEMENT_LABELS[element]}. Drag to move; arrow keys move by ${SNAP_GRID_MM} millimetres.`,
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => startLayoutDrag(element, event),
    onPointerMove: moveLayoutDrag,
    onPointerUp: endLayoutDrag,
    onPointerCancel: endLayoutDrag,
    onFocus: () => setSelectedLayoutElement(element),
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      const position = settings.elementPositions[element];
      if (event.key === "ArrowLeft") updateElementPosition(element, position.xMm - SNAP_GRID_MM, position.yMm);
      else if (event.key === "ArrowRight") updateElementPosition(element, position.xMm + SNAP_GRID_MM, position.yMm);
      else if (event.key === "ArrowUp") updateElementPosition(element, position.xMm, position.yMm - SNAP_GRID_MM);
      else if (event.key === "ArrowDown") updateElementPosition(element, position.xMm, position.yMm + SNAP_GRID_MM);
      else return;
      event.preventDefault();
    },
  });

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
        "&::before": {
          content: '""', position: "absolute", inset: 0, right: "auto", width: 15, bgcolor: "#000",
        },
      }
    : settings.template === "minimal"
      ? { border: 0, boxShadow: 1 }
      : {};
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
                    onClick={() => update({
                      template: template.key,
                      elementPositions: defaultIdCardElementPositions(template.key, settings.widthMm, settings.heightMm),
                      elementSizes: defaultIdCardElementSizes(template.key, settings.widthMm),
                      elementBold: defaultIdCardElementBold(),
                      elementTextSizes: defaultIdCardElementTextSizes(template.key),
                    })}
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
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between" }}>
              <Box>
                <Typography variant="subtitle2">Layout</Typography>
                <Typography variant="body2" color="text.secondary">Drag preview elements to a {SNAP_GRID_MM} mm grid. Their printed positions will match.</Typography>
              </Box>
              <Button size="small" color="inherit" onClick={() => update({ elementPositions: defaultIdCardElementPositions(settings.template, settings.widthMm, settings.heightMm) })}>Reset layout</Button>
            </Stack>
            <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1.5 }}>
              <Typography variant="subtitle2" gutterBottom>Selected component</Typography>
              <Stack spacing={1}>
                <TextField select label="Component" value={selectedLayoutElement} onChange={(event) => setSelectedLayoutElement(event.target.value as IdCardLayoutElement)} fullWidth>
                  {Object.entries(LAYOUT_ELEMENT_LABELS).map(([element, label]) => <MenuItem key={element} value={element}>{label}</MenuItem>)}
                </TextField>
                {selectedElementIsText ? (
                  <TextField label="Text size (pt)" type="number" value={settings.elementTextSizes[selectedLayoutElement]} onChange={(event) => updateElementTextSize(selectedLayoutElement, Number(event.target.value))} slotProps={{ htmlInput: { min: 6, max: 48, step: 0.5 } }} fullWidth />
                ) : (
                  <TextField label="Square size (mm)" type="number" value={settings.elementSizes[selectedLayoutElement]} onChange={(event) => updateElementSize(selectedLayoutElement, Number(event.target.value))} slotProps={{ htmlInput: { min: 10, max: settings.widthMm - 4, step: 1 } }} fullWidth />
                )}
                {selectedElementIsText ? <FormControlLabel control={<Switch checked={settings.elementBold[selectedLayoutElement]} onChange={(_, checked) => update({ elementBold: { ...settings.elementBold, [selectedLayoutElement]: checked } })} />} label="Bold text" /> : null}
              </Stack>
            </Box>
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
            <Box
              data-id-card-preview
              sx={{
                width: `${previewWidthPx}px`, maxWidth: "100%", aspectRatio: ratio, position: "relative", border: "2px solid", borderColor: "#000", bgcolor: "#fff", color: "#000", boxShadow: 3, overflow: "hidden",
                backgroundImage: "linear-gradient(to right, rgb(0 0 0 / 8%) 1px, transparent 1px), linear-gradient(to bottom, rgb(0 0 0 / 8%) 1px, transparent 1px)",
                backgroundSize: `${SNAP_GRID_MM * previewPixelsPerMillimetre}px ${SNAP_GRID_MM * previewPixelsPerMillimetre}px`,
                ...previewTemplateSx,
              }}
            >
              <Box {...layoutItemProps("header")} sx={{ ...previewPositionSx("header"), width: previewItemWidth("header"), pb: 0.75, borderBottom: settings.template === "classic" ? "1px solid #000" : 0, borderTop: settings.template === "classic" ? 0 : "1px solid #000", pt: settings.template === "classic" ? 0 : 0.75 }}>
                <Typography sx={{ fontSize: "0.62rem", letterSpacing: "0.14em", fontWeight: settings.elementBold.header ? 800 : 400 }}>{settings.badgeLabel}</Typography>
                <Typography sx={{ mt: settings.template === "minimal" ? 0.25 : 0.75, fontSize: previewTextSize("header"), fontWeight: settings.elementBold.header ? 700 : 400, lineHeight: 1.08, letterSpacing: "-0.025em", overflowWrap: "anywhere" }}>{settings.heading}</Typography>
              </Box>
              {logoUrl ? <Box component="img" {...layoutItemProps("logo")} src={logoUrl} alt="" sx={{ ...previewPositionSx("logo"), width: `${settings.elementSizes.logo * previewPixelsPerMillimetre}px`, height: `${settings.elementSizes.logo * previewPixelsPerMillimetre}px`, objectFit: "contain", borderRadius: 1, bgcolor: "#fff", p: 0.25 }} /> : null}
              <Typography {...layoutItemProps("name")} sx={{ ...previewPositionSx("name"), width: previewItemWidth("name"), fontSize: previewTextSize("name"), fontWeight: settings.elementBold.name ? 800 : 400, lineHeight: 1.12, letterSpacing: "-0.015em", textTransform: settings.template === "bold" ? "uppercase" : "none", overflowWrap: "anywhere" }}>{sampleAttendee.displayName}</Typography>
              {settings.showEmail && sampleAttendee.email ? <Typography {...layoutItemProps("email")} variant="body2" sx={{ ...previewPositionSx("email"), width: previewItemWidth("email"), fontSize: previewTextSize("email"), fontWeight: settings.elementBold.email ? 700 : 400, opacity: 0.75, overflowWrap: "anywhere" }}>{sampleAttendee.email}</Typography> : null}
              <Box {...layoutItemProps("qr")} sx={{ ...previewPositionSx("qr"), bgcolor: "#fff", p: 0.5 }}>
                <QRCode value={sampleAttendee.checkInQrToken} size={Math.round(settings.elementSizes.qr * previewPixelsPerMillimetre)} bgColor="#FFFFFF" fgColor="#000000" level="M" />
              </Box>
              {previewFields.length > 0 ? (
                <Stack {...layoutItemProps("details")} spacing={0.4} sx={{ ...previewPositionSx("details"), width: previewItemWidth("details"), borderTop: settings.template === "minimal" ? 0 : "1px solid", borderColor: "#000", pt: settings.template === "minimal" ? 0 : 1 }}>
                  {previewFields.map((detail) => {
                    const label = settings.printFieldLabels[detail.key] ?? detail.label;
                    return <Stack direction="row" key={detail.key} sx={{ justifyContent: label ? "space-between" : "flex-start", gap: 1 }}>{label ? <Typography variant="caption" sx={{ fontSize: previewTextSize("details"), fontWeight: settings.elementBold.details ? 700 : 400, opacity: 0.72 }}>{label}</Typography> : null}<Typography variant="caption" sx={{ fontSize: previewTextSize("details"), fontWeight: settings.elementBold.details ? 700 : 400, textAlign: "right" }}>{detail.value}</Typography></Stack>;
                  })}
                </Stack>
              ) : null}
              <Typography {...layoutItemProps("footer")} variant="caption" sx={{ ...previewPositionSx("footer"), width: previewItemWidth("footer"), fontSize: previewTextSize("footer"), fontWeight: settings.elementBold.footer ? 700 : 400, opacity: 0.68, overflowWrap: "anywhere" }}>{settings.footerText}</Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center" }}>Drag an outlined item, or focus it and use the arrow keys. Positions snap to {SNAP_GRID_MM} mm and print exactly from this layout.</Typography>
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
