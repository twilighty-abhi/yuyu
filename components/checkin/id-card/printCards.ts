"use client";

import {
  badgeLabelPt,
  fitTextSizePt,
  ID_CARD_LINE_HEIGHT,
  idCardTemplateDecor,
  type IdCardLayoutElement,
  type IdCardPrintSettings,
} from "@/lib/idCardPrint";
import { printableFields, safeLogoUrl, withMergeFields, type IdCardAttendee, type PrintableField } from "./shared";

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/**
 * The name's point size after auto-fit. The bold template prints names in
 * capitals, which run about 15% wider than mixed case, so it fits them in a
 * slightly narrower measure.
 */
export function nameSizePt(settings: IdCardPrintSettings, name: string) {
  const size = settings.elementTextSizes.name;
  if (!settings.nameAutoFit) return size;
  const uppercase = idCardTemplateDecor(settings.template, settings.widthMm, settings.heightMm).nameUppercase;
  const widthMm = uppercase ? settings.elementSizes.name / 1.15 : settings.elementSizes.name;
  return fitTextSizePt(name, widthMm, size, settings.elementBold.name || uppercase);
}

function position(settings: IdCardPrintSettings, element: IdCardLayoutElement) {
  const at = settings.elementPositions[element];
  return `left:${at.xMm}mm;top:${at.yMm}mm;`;
}

function textStyle(settings: IdCardPrintSettings, element: Exclude<IdCardLayoutElement, "qr" | "logo">, sizePt?: number) {
  const fontSize = element === "header" ? "" : `font-size:${sizePt ?? settings.elementTextSizes[element]}pt;`;
  const bold = settings.elementBold[element] || (element === "footer" && settings.template === "bold");
  return `${position(settings, element)}width:${settings.elementSizes[element]}mm;font-weight:${bold ? 700 : 400};${fontSize}`;
}

function detailsHtml(fields: PrintableField[], settings: IdCardPrintSettings) {
  if (fields.length === 0) return "";
  const rows = fields.map((detail) => {
    const label = settings.printFieldLabels[detail.key] ?? detail.label;
    return `<div${label ? "" : ' class="label-free"'}>${label ? `<dt>${escapeHtml(label)}</dt>` : ""}<dd>${escapeHtml(detail.value)}</dd></div>`;
  }).join("");
  return `<dl class="details ${settings.elementBold.details ? "is-bold" : "is-regular"}" style="${textStyle(settings, "details")}">${rows}</dl>`;
}

/**
 * Open a print window with one card sized exactly to the paper. Returns false
 * when the window is blocked. The QR is generated locally; nothing leaves the
 * browser. Black and white only, for laser and thermal printers.
 */
export async function printCard(params: { settings: IdCardPrintSettings; attendee: IdCardAttendee; organisationLogoUrl: string | null }) {
  const { attendee, organisationLogoUrl } = params;
  const settings = withMergeFields(params.settings, attendee);
  const printWindow = window.open("", "_blank");
  if (!printWindow) return false;
  printWindow.opener = null;

  let qrDataUrl: string;
  try {
    const QRCode = await import("qrcode");
    qrDataUrl = await QRCode.toDataURL(attendee.checkInQrToken, { width: 360, margin: 0, color: { dark: "#000000", light: "#FFFFFF" } });
  } catch {
    printWindow.close();
    return false;
  }

  const name = escapeHtml(attendee.displayName);
  const email = settings.showEmail && attendee.email
    ? `<p class="email" style="${textStyle(settings, "email")}">${escapeHtml(attendee.email)}</p>`
    : "";
  const logoUrl = settings.showLogo ? safeLogoUrl(organisationLogoUrl) : null;
  const logo = logoUrl
    ? `<img id="badge-logo" class="logo" style="${position(settings, "logo")}width:${settings.elementSizes.logo}mm;height:${settings.elementSizes.logo}mm;" src="${escapeHtml(logoUrl)}" alt="">`
    : "";
  const decor = idCardTemplateDecor(settings.template, settings.widthMm, settings.heightMm);
  const label = settings.showBadgeLabel && settings.badgeLabel.trim()
    ? `<p class="label" style="font-size:${badgeLabelPt(settings.elementTextSizes.header)}pt;font-weight:${settings.elementBold.header ? 800 : 400}">${escapeHtml(settings.badgeLabel)}</p>`
    : "";
  const heading = settings.heading.trim()
    ? `<h1 class="heading" style="font-size:${settings.elementTextSizes.header}pt;font-weight:${settings.elementBold.header ? 700 : 400}">${escapeHtml(settings.heading)}</h1>`
    : "";
  const footer = settings.showFooter && settings.footerText.trim()
    ? `<p class="footer" style="${textStyle(settings, "footer")}">${escapeHtml(settings.footerText)}</p>`
    : "";
  const header = label || heading
    ? `<div class="top" style="${textStyle(settings, "header")}">${label}${heading}</div>`
    : "";
  const frame = decor.frame ? '<span class="frame" aria-hidden="true"></span>' : "";
  // Same rules, frame and band as the on-screen card (BadgeCanvas).
  const templateCss = [
    decor.frame ? `.frame { position: absolute; inset: ${decor.frame.insetMm}mm; border: ${decor.frame.ruleMm}mm solid #000; border-radius: ${decor.frame.radiusMm}mm; }` : "",
    decor.headerRule ? `.top { padding-bottom: ${decor.headerRule.gapMm}mm; border-bottom: ${decor.headerRule.ruleMm}mm solid #000; }` : "",
    // The band is a solid black background, which browsers drop in economy mode: print it exactly.
    decor.band ? `.top { padding: ${decor.band.padYMm}mm ${decor.band.padXMm}mm; background: #000; color: #fff; border-radius: ${decor.band.radiusMm}mm; } .top, .top * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }` : "",
    decor.nameUppercase ? ".name { text-transform: uppercase; }" : "",
  ].filter(Boolean).join("\n  ");

  printWindow.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><title>${name} badge</title><style>
  @page { size: ${settings.widthMm}mm ${settings.heightMm}mm; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: economy; print-color-adjust: economy; }
  html, body { width: ${settings.widthMm}mm; height: ${settings.heightMm}mm; margin: 0; }
  body { color: #000; font-family: Inter, Arial, Helvetica, sans-serif; line-height: ${ID_CARD_LINE_HEIGHT.body}; }
  .card { width: 100%; height: 100%; position: relative; background: #fff; overflow: hidden; }
  .top, .name, .email, .details, .footer { position: absolute; z-index: 1; margin: 0; }
  .logo { position: absolute; z-index: 2; border-radius: 3mm; object-fit: contain; background: #fff; padding: 1mm; filter: grayscale(1) contrast(1.8); }
  .label { margin: 0 0 ${decor.labelGapMm}mm; line-height: ${ID_CARD_LINE_HEIGHT.label}; letter-spacing: 0.16em; }
  .heading { margin: 0; line-height: ${ID_CARD_LINE_HEIGHT.heading}; letter-spacing: -0.01em; overflow-wrap: anywhere; }
  .name { line-height: ${ID_CARD_LINE_HEIGHT.name}; letter-spacing: ${decor.nameTrackingEm}em; overflow-wrap: anywhere; }
  .email, .footer { line-height: ${ID_CARD_LINE_HEIGHT.body}; overflow-wrap: anywhere; }
  .details { line-height: ${ID_CARD_LINE_HEIGHT.body}; }
  .details div { display: flex; justify-content: space-between; gap: 4mm; margin-top: 1.5mm; }
  .details .label-free { justify-content: flex-start; }
  .details dt, .details dd { margin: 0; font-weight: inherit; }
  .details dd { text-align: right; overflow-wrap: anywhere; }
  .qr-block { position: absolute; z-index: 2; background: #fff; padding: 1mm; }
  .qr { width: ${settings.elementSizes.qr}mm; height: ${settings.elementSizes.qr}mm; display: block; image-rendering: pixelated; }
  ${templateCss}
</style></head><body><main class="card ${settings.template}">${frame}${header}${logo}<p class="name" style="${textStyle(settings, "name", nameSizePt(settings, attendee.displayName))}">${name}</p>${email}${detailsHtml(printableFields(settings, attendee), settings)}<div class="qr-block" style="${position(settings, "qr")}"><img id="badge-qr" class="qr" src="${escapeHtml(qrDataUrl)}" alt="Check-in QR code"></div>${footer}</main></body></html>`);
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
  const remaining = images.filter((image) => !image.complete);
  if (remaining.length === 0) window.setTimeout(triggerPrint, 100);
  else {
    let left = remaining.length;
    const finish = () => {
      left -= 1;
      if (left === 0) triggerPrint();
    };
    remaining.forEach((image) => {
      image.addEventListener("load", finish, { once: true });
      image.addEventListener("error", finish, { once: true });
    });
    window.setTimeout(triggerPrint, 1500);
  }
  return true;
}
