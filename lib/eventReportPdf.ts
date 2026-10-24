import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb, setCharacterSpacing, type Color, type PDFFont, type PDFPage } from "pdf-lib";
import { MARK, MARK_BRIGHT } from "@/components/brand/patterns";
import { busiestDay, percentOf, signupTimeline } from "@/components/event-dashboard/analytics/metrics";
import type { EventReportMetrics, ReportQuestion } from "@/lib/eventReport";
import { formatDate, formatDateBlock, formatDayLong, formatTime, formatTimeRange, formatTimeZoneName } from "@/lib/format/datetime";
import { getAccentTokens } from "@/lib/theme/accent";
import { safeTimeZone } from "@/lib/timeZone";

/*
 * The post-event report, drawn with pdf-lib in the Yuyu look (docs/DESIGN.md):
 * Bricolage Grotesque for display type, Figtree for text, quiet neutrals,
 * the event's accent colour for its title and charts, and the dot sign in
 * the footer. Attendee data arrives as counts only (see EventReportMetrics).
 */

// ---------- Colour (light tokens from app/styles/tokens.css) ----------

function hex(value: string): Color {
  const n = Number.parseInt(value.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const C = {
  canvas: hex("#FFFFFF"),
  subtle: hex("#FAFAF9"),
  muted: hex("#F4F4F2"),
  track: hex("#F0EFEB"),
  border: hex("#E7E6E2"),
  ink: hex("#18181B"),
  textSecondary: hex("#3F3F46"),
  textMuted: hex("#5F5E5A"),
  marigold: hex("#FFB547"),
  marigoldDeep: hex("#E8930C"),
  dotOff: hex("#E7E6E2"),
  tintPeach: hex("#FFF4E5"),
  successBg: hex("#DCFCE7"),
  successFg: hex("#166534"),
  successSolid: hex("#15803D"),
  warningBg: hex("#FEF3C7"),
  warningFg: hex("#92400E"),
  dangerBg: hex("#FEE2E2"),
  dangerFg: hex("#B91C1C"),
};

// ---------- Fonts ----------

type Fonts = { display: PDFFont; regular: PDFFont; bold: PDFFont; supports: (codePoint: number) => boolean };

const FONT_DIR = path.join(process.cwd(), "public", "brand", "fonts");
let fontBytes: Promise<{ display: Buffer; regular: Buffer; bold: Buffer } | null> | null = null;

function loadFontBytes() {
  fontBytes ??= Promise.all([
    readFile(path.join(FONT_DIR, "BricolageGrotesque-ExtraBold.ttf")),
    readFile(path.join(FONT_DIR, "Figtree-Regular.ttf")),
    readFile(path.join(FONT_DIR, "Figtree-Bold.ttf")),
  ])
    .then(([display, regular, bold]) => ({ display, regular, bold }))
    // Without the brand fonts the report still renders, in Helvetica.
    .catch(() => null);
  return fontBytes;
}

async function embedFonts(pdf: PDFDocument): Promise<Fonts> {
  const bytes = await loadFontBytes();
  if (bytes) {
    pdf.registerFontkit(fontkit);
    const [display, regular, bold] = await Promise.all([pdf.embedFont(bytes.display), pdf.embedFont(bytes.regular), pdf.embedFont(bytes.bold)]);
    // Text uses all three fonts, so keep only characters every one of them can draw.
    const sets = [bytes.display, bytes.regular, bytes.bold].map((data) => new Set(fontkit.create(data).characterSet));
    return { display, regular, bold, supports: (codePoint) => sets.every((set) => set.has(codePoint)) };
  }
  const [regular, bold] = await Promise.all([pdf.embedFont(StandardFonts.Helvetica), pdf.embedFont(StandardFonts.HelveticaBold)]);
  return { display: bold, regular, bold, supports: (codePoint) => codePoint >= 0x20 && codePoint <= 0x7e };
}

const ASCII_FALLBACK: Record<string, string> = { "–": "-", "—": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...", "·": "-", "•": "-", " ": " " };

/** Keeps what the embedded fonts can draw: accents decompose to their base letter, anything else is dropped. */
function cleaner(supports: Fonts["supports"]) {
  return (value: string) => {
    let out = "";
    for (const char of value.replace(/\s+/g, " ")) {
      const codePoint = char.codePointAt(0)!;
      if (supports(codePoint)) out += char;
      else if (ASCII_FALLBACK[char]) out += ASCII_FALLBACK[char];
      else out += [...char.normalize("NFKD")].filter((part) => supports(part.codePointAt(0)!)).join("");
    }
    return out.trim();
  };
}

// ---------- Small helpers ----------

type Style = { font: PDFFont; size: number; color: Color; tracking?: number };

const PAGE: [number, number] = [595.28, 841.89];
const MARGIN = 48;
const CONTENT_WIDTH = PAGE[0] - MARGIN * 2;
const TOP = PAGE[1] - 72;
const BOTTOM = 76;

function plural(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString("en-GB")} ${count === 1 ? one : many}`;
}

function percentLabel(part: number, whole: number) {
  const value = percentOf(part, whole);
  return value == null ? "–" : `${value}%`;
}

function roundedRectPath(width: number, height: number, radius: number) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  return `M ${r} 0 H ${width - r} Q ${width} 0 ${width} ${r} V ${height - r} Q ${width} ${height} ${width - r} ${height} H ${r} Q 0 ${height} 0 ${height - r} V ${r} Q 0 0 ${r} 0 Z`;
}

const PRIVACY: Record<string, string> = { PUBLIC: "Public", HIDDEN_LINK: "Anyone with the link", APPROVAL_REQUIRED: "Approval required", INVITE_ONLY: "Invite only" };

const SPONSOR_TIERS: Record<string, string> = { PLATINUM: "Platinum", GOLD: "Gold", SILVER: "Silver", PARTNER: "Partners", COMMUNITY_PARTNER: "Community partners" };

/** Groups arrival times into 15, 30 or 60 minute windows, up to 16 columns. */
export function arrivalWindows(times: Date[], timeZone: string) {
  if (times.length === 0) return null;
  const sorted = [...times].sort((a, b) => a.getTime() - b.getTime());
  const first = sorted[0]!.getTime();
  const last = sorted[sorted.length - 1]!.getTime();
  const minutes = [15, 30, 60, 120, 240].find((size) => (last - first) / 60_000 / size < 16) ?? 480;
  const size = minutes * 60_000;
  const start = Math.floor(first / size) * size;
  const count = Math.floor((last - start) / size) + 1;
  const columns = Array.from({ length: count }, (_, index) => ({ start: new Date(start + index * size), count: 0 }));
  for (const time of sorted) columns[Math.floor((time.getTime() - start) / size)]!.count += 1;
  const peak = columns.reduce((best, column) => (column.count > best.count ? column : best), columns[0]!);
  return {
    minutes,
    columns: columns.map((column) => ({ label: formatTime(column.start, timeZone), count: column.count })),
    peak: { label: formatTimeRange(peak.start, new Date(peak.start.getTime() + size), timeZone, { withZone: false }), count: peak.count },
    first: sorted[0]!,
  };
}

// ---------- The document ----------

/** Generates the report in memory; it never writes report data to disk. */
export async function createEventReportPdf(metrics: EventReportMetrics, now = new Date()): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${metrics.title} – event report`);
  pdf.setAuthor(metrics.organisationName);
  pdf.setCreator("Yuyu");
  pdf.setProducer("Yuyu");
  pdf.setCreationDate(now);

  const fonts = await embedFonts(pdf);
  const clean = cleaner(fonts.supports);
  const tz = safeTimeZone(metrics.timeZone);
  const accent = getAccentTokens(metrics.accentColor, "light");
  const A = { solid: hex(accent["--yy-accent"]), soft: hex(accent["--yy-accent-soft"]), on: hex(accent["--yy-on-accent"]), text: hex(accent["--yy-accent-text"]) };

  const T = {
    display: (size: number, color = C.ink): Style => ({ font: fonts.display, size, color, tracking: -0.03 }),
    heading: (size: number, color = C.ink): Style => ({ font: fonts.display, size, color, tracking: -0.01 }),
    body: (size = 10.5, color = C.textSecondary): Style => ({ font: fonts.regular, size, color }),
    strong: (size = 10.5, color = C.ink): Style => ({ font: fonts.bold, size, color }),
    overline: (color = C.textMuted): Style => ({ font: fonts.bold, size: 8, color, tracking: 0.08 }),
  };

  const textWidth = (text: string, style: Style) => style.font.widthOfTextAtSize(text, style.size) + (style.tracking ?? 0) * style.size * Math.max(0, [...text].length - 1);

  const drawText = (page: PDFPage, value: string, x: number, y: number, style: Style) => {
    const text = clean(value);
    if (!text) return;
    if (style.tracking) page.pushOperators(setCharacterSpacing(style.tracking * style.size));
    page.drawText(text, { x, y, size: style.size, font: style.font, color: style.color });
    if (style.tracking) page.pushOperators(setCharacterSpacing(0));
  };

  const fit = (value: string, style: Style, maxWidth: number) => {
    let text = clean(value);
    if (textWidth(text, style) <= maxWidth) return text;
    while (text.length > 1 && textWidth(`${text}…`, style) > maxWidth) text = text.slice(0, -1);
    return `${text.trimEnd()}…`;
  };

  const wrap = (value: string, style: Style, maxWidth: number) => {
    const lines: string[] = [];
    let line = "";
    for (const word of clean(value).split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, style) <= maxWidth || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
      if (textWidth(line, style) > maxWidth) {
        lines.push(fit(line, style, maxWidth));
        line = "";
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  const box = (page: PDFPage, x: number, top: number, width: number, height: number, options: { fill?: Color; border?: Color; radius?: number }) =>
    page.drawSvgPath(roundedRectPath(width, height, options.radius ?? 12), {
      x,
      y: top,
      color: options.fill,
      borderColor: options.border,
      borderWidth: options.border ? 0.75 : 0,
    });

  const bar = (page: PDFPage, x: number, y: number, width: number, ratio: number, color: Color, height = 8) => {
    box(page, x, y + height, width, height, { fill: C.track, radius: height / 2 });
    const filled = Math.max(0, Math.min(1, ratio)) * width;
    if (filled > 0) box(page, x, y + height, Math.max(filled, height), height, { fill: color, radius: height / 2 });
  };

  /** The dot sign: lit dots in marigold, the base dot in ink and, at larger sizes, soft dots. */
  const dotMark = (page: PDFPage, x: number, top: number, size: number) => {
    const dot = size / 6;
    const step = dot * 1.25;
    const pattern = size >= 36 ? MARK : MARK_BRIGHT;
    const lit = size < 24 ? C.marigoldDeep : C.marigold;
    pattern.split("|").forEach((row, r) => [...row].forEach((cell, c) => {
      const color = cell === "X" ? lit : cell === "O" ? C.ink : cell === "." ? C.dotOff : null;
      if (color) page.drawCircle({ x: x + dot / 2 + c * step, y: top - dot / 2 - r * step, size: dot / 2, color });
    }));
  };

  // ---------- Pages and flow ----------

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const newPage = () => {
    page = pdf.addPage(PAGE);
    pages.push(page);
    if (pages.length > 1) {
      const left = fit(`${metrics.organisationName}  ·  ${metrics.title}`, T.body(8.5, C.textMuted), CONTENT_WIDTH - 120);
      drawText(page, left, MARGIN, PAGE[1] - 40, T.body(8.5, C.textMuted));
      const right = metrics.targetType === "occurrence" ? "Series date report" : "Event report";
      drawText(page, right, PAGE[0] - MARGIN - textWidth(right, T.strong(8.5, C.textMuted)), PAGE[1] - 40, T.strong(8.5, C.textMuted));
      page.drawLine({ start: { x: MARGIN, y: PAGE[1] - 52 }, end: { x: PAGE[0] - MARGIN, y: PAGE[1] - 52 }, thickness: 0.75, color: C.border });
    }
    y = TOP;
  };

  const ensure = (height: number) => {
    if (y - height < BOTTOM) newPage();
  };

  const paragraph = (value: string, style = T.body(), width = CONTENT_WIDTH, x = MARGIN, gapAfter = 8) => {
    const lineHeight = style.size * 1.5;
    const lines = wrap(value, style, width);
    // Keep short paragraphs in one piece.
    if (lines.length <= 6) ensure(lines.length * lineHeight);
    for (const line of lines) {
      ensure(lineHeight);
      drawText(page, line, x, y - style.size, style);
      y -= lineHeight;
    }
    y -= gapAfter;
  };

  const section = (overline: string, title: string, intro?: string) => {
    // Sections share a page when a good part of it is left.
    if (y - 280 < BOTTOM) newPage();
    else if (y < TOP - 1) y -= 30;
    drawText(page, overline.toUpperCase(), MARGIN, y - 8, T.overline(A.text));
    drawText(page, title, MARGIN, y - 36, T.display(26));
    y -= 52;
    if (intro) paragraph(intro, T.body(11), CONTENT_WIDTH * 0.85, MARGIN, 10);
    y -= 6;
  };

  /** `keepWith` is the height of what follows, so a heading never ends a page alone. */
  const subheading = (title: string, note?: string, keepWith = 0) => {
    ensure((note ? 60 : 44) + keepWith);
    y -= 10;
    drawText(page, title, MARGIN, y - 15, T.heading(15));
    y -= 24;
    if (note) paragraph(note, T.body(9.5, C.textMuted), CONTENT_WIDTH, MARGIN, 4);
    y -= 6;
  };

  /** Label · bar · value rows, for funnels and question answers. */
  const barRows = (rows: Array<{ label: string; value: number; whole: number; color: Color; note?: string }>) => {
    const labelWidth = 178;
    const valueWidth = 82;
    const barWidth = CONTENT_WIDTH - labelWidth - valueWidth - 24;
    for (const row of rows) {
      ensure(24);
      drawText(page, fit(row.label, T.body(10, C.ink), labelWidth - 8), MARGIN, y - 12, T.body(10, C.ink));
      bar(page, MARGIN + labelWidth, y - 13, barWidth, row.whole > 0 ? row.value / row.whole : 0, row.color);
      const value = row.note ?? `${row.value.toLocaleString("en-GB")}  ·  ${percentLabel(row.value, row.whole)}`;
      drawText(page, value, PAGE[0] - MARGIN - textWidth(clean(value), T.strong(9.5)), y - 12, T.strong(9.5));
      y -= 24;
    }
    y -= 4;
  };

  /** Two-column facts list. */
  const facts = (rows: Array<[string, string]>) => {
    for (const [name, value] of rows) {
      const lines = wrap(value, T.body(10.5, C.ink), CONTENT_WIDTH - 170);
      ensure(lines.length * 16 + 10);
      drawText(page, name, MARGIN, y - 11, T.strong(9.5, C.textMuted));
      lines.forEach((line, index) => drawText(page, line, MARGIN + 170, y - 11 - index * 16, T.body(10.5, C.ink)));
      y -= lines.length * 16 + 10;
      page.drawLine({ start: { x: MARGIN, y: y + 4 }, end: { x: PAGE[0] - MARGIN, y: y + 4 }, thickness: 0.5, color: C.border });
    }
    y -= 8;
  };

  /** A column chart in a soft card. */
  const columnChart = (columns: Array<{ label: string; count: number }>, color: Color, caption: string) => {
    const height = 168;
    ensure(height + 34);
    const top = y;
    box(page, MARGIN, top, CONTENT_WIDTH, height, { fill: C.subtle, border: C.border, radius: 16 });
    const plotTop = top - 30;
    const plotBottom = top - height + 34;
    const plotHeight = plotTop - plotBottom;
    const largest = Math.max(1, ...columns.map((column) => column.count));
    const slot = (CONTENT_WIDTH - 40) / columns.length;
    const barWidth = Math.min(28, slot * 0.62);
    // Show every label that fits; otherwise every second or third one.
    const widest = Math.max(...columns.map((column) => textWidth(clean(column.label), T.body(7.5, C.textMuted))));
    const labelEvery = Math.max(1, Math.ceil((widest + 8) / slot));
    columns.forEach((column, index) => {
      const centre = MARGIN + 20 + slot * index + slot / 2;
      const barHeight = column.count > 0 ? Math.max(4, (column.count / largest) * plotHeight) : 0;
      if (barHeight > 0) {
        box(page, centre - barWidth / 2, plotBottom + barHeight, barWidth, barHeight, { fill: color, radius: Math.min(5, barWidth / 2) });
        const value = String(column.count);
        drawText(page, value, centre - textWidth(value, T.strong(8)) / 2, plotBottom + barHeight + 5, T.strong(8));
      } else {
        page.drawLine({ start: { x: centre - barWidth / 2, y: plotBottom }, end: { x: centre + barWidth / 2, y: plotBottom }, thickness: 1, color: C.border });
      }
      if (index % labelEvery === 0) {
        const label = fit(column.label, T.body(7.5, C.textMuted), slot * labelEvery - 4);
        drawText(page, label, centre - textWidth(label, T.body(7.5, C.textMuted)) / 2, plotBottom - 16, T.body(7.5, C.textMuted));
      }
    });
    y = top - height - 10;
    paragraph(caption, T.body(9.5, C.textMuted), CONTENT_WIDTH, MARGIN, 6);
  };

  const chips = (items: Array<{ label: string; bg: Color; fg: Color }>) => {
    ensure(36);
    let x = MARGIN;
    for (const item of items) {
      const width = textWidth(clean(item.label), T.strong(9.5)) + 22;
      box(page, x, y, width, 24, { fill: item.bg, radius: 12 });
      drawText(page, item.label, x + 11, y - 16, T.strong(9.5, item.fg));
      x += width + 8;
    }
    y -= 36;
  };

  const questions = (list: ReportQuestion[], color: Color, writtenNote: string) => {
    for (const question of list) {
      const titleLines = wrap(question.label, T.strong(11), CONTENT_WIDTH);
      ensure(titleLines.length * 16 + 44);
      y -= 6;
      for (const line of titleLines) {
        drawText(page, line, MARGIN, y - 11, T.strong(11));
        y -= 16;
      }
      drawText(page, `${plural(question.answered, "answer")}`, MARGIN, y - 10, T.body(9, C.textMuted));
      y -= 20;
      if (question.choices && question.answered > 0) {
        const whole = question.type === "MULTI_SELECT" ? question.answered : question.choices.reduce((sum, choice) => sum + choice.count, 0);
        barRows(question.choices.map((choice) => ({ label: choice.label, value: choice.count, whole, color })));
      } else if (!question.choices && question.answered > 0) {
        paragraph(writtenNote, T.body(9.5, C.textMuted), CONTENT_WIDTH, MARGIN, 6);
      } else {
        y -= 4;
      }
    }
  };

  // ---------- Page 1: header band, details and key numbers ----------

  newPage();
  const titleStyle = T.display(metrics.title.length > 42 ? 28 : 34, A.text);
  const titleLines = wrap(metrics.title, titleStyle, CONTENT_WIDTH).slice(0, 3);
  const tagline = metrics.tagline?.trim() ? fit(metrics.tagline, T.body(11.5), CONTENT_WIDTH) : "";
  const bandHeight = 112 + titleLines.length * titleStyle.size * 1.04 + (tagline ? 22 : 0);
  page.drawRectangle({ x: 0, y: PAGE[1] - bandHeight, width: PAGE[0], height: bandHeight, color: A.soft });
  dotMark(page, MARGIN, PAGE[1] - 36, 20);
  drawText(page, "yuyu", MARGIN + 26, PAGE[1] - 51, T.display(15));
  const reportLabel = metrics.targetType === "occurrence" ? "SERIES DATE REPORT" : "EVENT REPORT";
  drawText(page, reportLabel, PAGE[0] - MARGIN - textWidth(reportLabel, T.overline()), PAGE[1] - 48, T.overline());
  let bandY = PAGE[1] - 96;
  drawText(page, fit(metrics.organisationName, T.strong(11.5, C.textSecondary), CONTENT_WIDTH), MARGIN, bandY, T.strong(11.5, C.textSecondary));
  bandY -= 6;
  for (const line of titleLines) {
    bandY -= titleStyle.size * 1.04;
    drawText(page, line, MARGIN, bandY, titleStyle);
  }
  if (tagline) drawText(page, tagline, MARGIN, bandY - 22, T.body(11.5));
  y = PAGE[1] - bandHeight - 26;

  // Date block, as on the event page: accent header, big day number.
  const block = formatDateBlock(metrics.startDateTime, tz);
  box(page, MARGIN, y, 58, 64, { fill: C.canvas, border: C.border, radius: 10 });
  page.drawSvgPath("M 10 0 H 48 Q 58 0 58 10 V 18 H 0 V 10 Q 0 0 10 0 Z", { x: MARGIN, y, color: A.solid });
  drawText(page, block.month, MARGIN + 29 - textWidth(block.month, T.overline(A.on)) / 2, y - 13, T.overline(A.on));
  drawText(page, block.day, MARGIN + 29 - textWidth(block.day, T.display(24)) / 2, y - 50, T.display(24));
  const durationMinutes = Math.round((metrics.endDateTime.getTime() - metrics.startDateTime.getTime()) / 60_000);
  const duration = durationMinutes >= 1440
    ? plural(Math.round(durationMinutes / 1440), "day")
    : [Math.floor(durationMinutes / 60) ? plural(Math.floor(durationMinutes / 60), "hour") : "", durationMinutes % 60 ? `${durationMinutes % 60} min` : ""].filter(Boolean).join(" ");
  const place = metrics.isOnline ? "Online event" : [metrics.venueName, metrics.location].filter((part) => part?.trim()).join(", ");
  // A reference date in another year makes formatDayLong include the year, which a record should always show.
  drawText(page, formatDayLong(metrics.startDateTime, tz, new Date(0)), MARGIN + 74, y - 16, T.strong(12));
  drawText(page, `${formatTimeRange(metrics.startDateTime, metrics.endDateTime, tz)}  ·  ${duration}`, MARGIN + 74, y - 34, T.body(10.5));
  if (place) drawText(page, fit(place, T.body(10.5), CONTENT_WIDTH - 74), MARGIN + 74, y - 51, T.body(10.5));
  y -= 84;

  const summary = metrics.total === 0
    ? "Nobody signed up for this event through Yuyu."
    : `${plural(metrics.total, "person", "people")} signed up and ${metrics.confirmed.toLocaleString("en-GB")} had a place on the day. ${metrics.checkedIn ? `${metrics.checkedIn.toLocaleString("en-GB")} of them were checked in at the door (${percentLabel(metrics.checkedIn, metrics.confirmed)})` : "Nobody was checked in with Yuyu"}${metrics.feedbackResponseCount ? `, and ${plural(metrics.feedbackResponseCount, "person", "people")} shared feedback afterwards` : ""}.`;
  paragraph(summary, T.body(11.5, C.textSecondary), CONTENT_WIDTH, MARGIN, 10);

  const detailRows: Array<[string, string]> = [
    ["Visibility", PRIVACY[metrics.privacyType ?? "PUBLIC"] ?? "Public"],
    ["Capacity", metrics.capacity == null ? "No limit" : plural(metrics.capacity, "place")],
  ];
  if (metrics.registrationClosesAt) detailRows.push(["Registration closed", `${formatDate(metrics.registrationClosesAt, tz)}, ${formatTime(metrics.registrationClosesAt, tz)}`]);
  if (metrics.tags?.length) detailRows.push(["Tags", metrics.tags.join(", ")]);
  facts(detailRows);

  const tileRow = (items: Array<{ label: string; value: string; detail?: string }>, height: number, valueSize: number) => {
    const gap = 10;
    const width = (CONTENT_WIDTH - gap * (items.length - 1)) / items.length;
    ensure(height + 12);
    items.forEach((tile, index) => {
      const x = MARGIN + index * (width + gap);
      box(page, x, y, width, height, { fill: C.muted, radius: 14 });
      drawText(page, fit(tile.label, T.strong(9, C.textMuted), width - 24), x + 12, y - 19, T.strong(9, C.textMuted));
      drawText(page, fit(tile.value, T.display(valueSize), width - 24), x + 12, y - 19 - valueSize * 1.15, T.display(valueSize));
      if (tile.detail) drawText(page, fit(tile.detail, T.body(8.5, C.textMuted), width - 24), x + 12, y - height + 14, T.body(8.5, C.textMuted));
    });
    y -= height + 10;
  };
  const count = (value: number | undefined | null) => (value == null ? "–" : value.toLocaleString("en-GB"));

  y -= 4;
  ensure(40);
  drawText(page, "ATTENDANCE", MARGIN, y - 8, T.overline());
  y -= 20;
  tileRow([
    { label: "Signed up", value: count(metrics.total), detail: metrics.capacity ? `for ${plural(metrics.capacity, "place")}` : "no capacity limit" },
    { label: "Going", value: count(metrics.confirmed), detail: `${count(metrics.waitlisted)} on the waitlist` },
    { label: "Checked in", value: count(metrics.checkedIn), detail: `${percentLabel(metrics.checkedIn, metrics.confirmed)} of people going` },
    { label: "Feedback", value: count(metrics.feedbackResponseCount), detail: metrics.feedbackResponseCount == null ? "not collected" : `${percentLabel(metrics.feedbackResponseCount, metrics.checkedIn || metrics.confirmed)} response rate` },
  ], 84, 28);

  const sessionList = metrics.sessions ?? [];
  const totalSessionMinutes = sessionList.filter((session) => session.type.toLowerCase() !== "break").reduce((sum, session) => sum + (session.end.getTime() - session.start.getTime()) / 60_000, 0);
  y -= 6;
  ensure(40);
  drawText(page, "THE EVENT", MARGIN, y - 8, T.overline());
  y -= 20;
  tileRow([
    { label: "Sessions", value: count(sessionList.length), detail: totalSessionMinutes ? `${Math.round((totalSessionMinutes / 60) * 10) / 10} h of content` : undefined },
    { label: "Speakers", value: count(metrics.speakers?.length ?? 0) },
    { label: "Tracks", value: count(new Set(sessionList.map((session) => session.track)).size) },
    { label: "Sponsors", value: count(metrics.sponsors?.length ?? 0) },
    { label: "Resources", value: count(metrics.resourceCount ?? 0) },
  ], 74, 22);
  tileRow([
    { label: "Emails sent", value: metrics.targetType === "occurrence" ? "–" : count(metrics.broadcasts?.length ?? 0) },
    { label: "Invitations", value: count(metrics.invitationCount) },
    { label: "Sign-up form", value: count(metrics.registrationQuestions?.length ?? 0), detail: "questions" },
    { label: "Feedback form", value: count(metrics.feedbackQuestions?.length ?? 0), detail: "questions" },
    { label: "Co-organisers", value: count(metrics.coOrganiserCount ?? 0) },
  ], 74, 22);


  // ---------- Registrations ----------

  const timeline = metrics.signupDates?.length ? signupTimeline(metrics.signupDates, metrics.endDateTime, tz) : null;
  section("Who signed up", "Registrations", "How people signed up, how many got a place and how many came.");
  barRows([
    { label: "Signed up", value: metrics.total, whole: metrics.total, color: C.ink, note: metrics.total.toLocaleString("en-GB") },
    { label: "Going", value: metrics.confirmed, whole: metrics.total, color: A.solid },
    { label: "Checked in", value: metrics.checkedIn, whole: metrics.total, color: C.successSolid },
    ...(metrics.feedbackResponseCount != null ? [{ label: "Shared feedback", value: metrics.feedbackResponseCount, whole: metrics.total, color: C.marigoldDeep }] : []),
  ]);
  chips([
    { label: `Going ${metrics.confirmed}`, bg: C.successBg, fg: C.successFg },
    { label: `Waitlist ${metrics.waitlisted}`, bg: C.warningBg, fg: C.warningFg },
    { label: `To approve ${metrics.pendingApproval}`, bg: C.muted, fg: C.textSecondary },
    { label: `Declined ${metrics.rejected}`, bg: C.dangerBg, fg: C.dangerFg },
  ]);

  // TEAM events count capacity in units: confirmed teams plus confirmed solo registrants.
  const capacityFact = () => {
    if (metrics.capacity == null) return "No limit";
    if (!metrics.teams) return `${metrics.confirmed.toLocaleString("en-GB")} of ${plural(metrics.capacity, "place")} filled (${percentLabel(metrics.confirmed, metrics.capacity)})`;
    const units = metrics.teams.confirmedTeams + metrics.teams.confirmedSoloRegistrants;
    return `${units.toLocaleString("en-GB")} of ${plural(metrics.capacity, "place")} filled by teams and solo registrants (${percentLabel(units, metrics.capacity)})`;
  };
  const registrationFacts: Array<[string, string]> = [
    ["Capacity", capacityFact()],
  ];
  if (metrics.registrationClosesAt) registrationFacts.push(["Registration closed", `${formatDate(metrics.registrationClosesAt, tz)}, ${formatTime(metrics.registrationClosesAt, tz)}`]);
  if (metrics.signupDates?.length) {
    const sorted = [...metrics.signupDates].sort((a, b) => a.getTime() - b.getTime());
    registrationFacts.push(["First sign-up", formatDate(sorted[0]!, tz)]);
    const busiest = busiestDay(metrics.signupDates, tz);
    if (busiest) registrationFacts.push(["Busiest day", `${busiest.day}, ${plural(busiest.count, "sign-up")}`]);
  }
  if (metrics.teams) {
    // Counts only: team names, members and "looking for a team" profiles never appear in the report.
    const { teams, confirmedTeams, soloRegistrants, averageTeamSize } = metrics.teams;
    registrationFacts.push(["Teams", teams ? `${plural(teams, "team")}, ${confirmedTeams.toLocaleString("en-GB")} with a place` : "No teams"]);
    if (teams) registrationFacts.push(["Average team size", `${averageTeamSize.toLocaleString("en-GB")} people`]);
    registrationFacts.push(["Solo registrants", soloRegistrants ? plural(soloRegistrants, "person", "people") : "None"]);
  }
  registrationFacts.push(["Invitations", metrics.invitationCount ? plural(metrics.invitationCount, "person", "people") + " invited by email" : "None sent"]);
  facts(registrationFacts);

  if (timeline && timeline.columns.length > 1) {
    subheading("Sign-ups over time", timeline.intervalDays === 1 ? "Sign-ups per day." : `Sign-ups per ${timeline.intervalDays} days.`, 210);
    // Grouped columns are labelled by their first day; the note above says how many days each holds.
    columnChart(timeline.columns.map((column) => ({ ...column, label: column.label.split(" – ")[0]! })), A.solid, `${plural(timeline.total, "sign-up")} over ${plural(timeline.spanDays, "day")}, up to the end of the event.`);
  }

  // ---------- At the door ----------

  section("Check-in", "At the door", "Who arrived, and when.");
  if (metrics.checkedIn === 0) {
    paragraph("Nobody was checked in with Yuyu for this event. If you checked people in another way, this section stays empty.", T.body(), CONTENT_WIDTH);
  } else {
    barRows([
      { label: "Checked in", value: metrics.checkedIn, whole: metrics.confirmed, color: C.successSolid },
      { label: "Did not come", value: metrics.noShows, whole: metrics.confirmed, color: C.textMuted },
    ]);
    const arrivals = arrivalWindows(metrics.checkInTimes ?? [], tz);
    const doorFacts: Array<[string, string]> = [];
    if (arrivals) {
      doorFacts.push(["First check-in", `${formatTime(arrivals.first, tz)}, ${formatDate(arrivals.first, tz)}`]);
      doorFacts.push(["Busiest time", `${arrivals.peak.label}, ${plural(arrivals.peak.count, "arrival")}`]);
    }
    const sources = metrics.checkInSources;
    if (sources) {
      const parts = [
        sources.organiser ? `${sources.organiser} on organiser devices` : "",
        sources.offline ? `${sources.offline} offline, then synced` : "",
        sources.station ? `${sources.station} at the door station` : "",
      ].filter(Boolean);
      if (parts.length) doorFacts.push(["Checked in by", parts.join(", ")]);
    }
    facts(doorFacts);
    if (arrivals && arrivals.columns.length > 1) {
      subheading("Arrivals", `Check-ins per ${arrivals.minutes < 60 ? `${arrivals.minutes} minutes` : arrivals.minutes === 60 ? "hour" : `${arrivals.minutes / 60} hours`}, in ${formatTimeZoneName(metrics.startDateTime, tz)}.`, 210);
      columnChart(arrivals.columns, C.successSolid, `Times show when each guest was checked in, from the first arrival to the last.`);
    }
  }

  // ---------- Programme ----------

  const sessions = metrics.sessions ?? [];
  const speakers = metrics.speakers ?? [];
  const sponsors = metrics.sponsors ?? [];
  if (sessions.length || speakers.length || sponsors.length) {
    section("What happened", "Programme", "The published sessions, speakers and sponsors, as they appeared on the event page.");

    if (sessions.length) {
      subheading("Sessions", `${plural(sessions.length, "session")}${new Set(sessions.map((s) => s.track)).size > 1 ? ` across ${new Set(sessions.map((s) => s.track)).size} tracks` : ""}.`);
      let day = "";
      for (const session of sessions) {
        const sessionDay = formatDayLong(session.start, tz, now);
        const multiDay = formatDate(sessions[0]!.start, tz) !== formatDate(sessions[sessions.length - 1]!.start, tz);
        if (multiDay && sessionDay !== day) {
          ensure(40);
          day = sessionDay;
          y -= 6;
          drawText(page, day.toUpperCase(), MARGIN, y - 8, T.overline(A.text));
          y -= 20;
        }
        const meta = [session.type, session.track, session.speakers.join(", ")].filter(Boolean).join("  ·  ");
        const titleLines = wrap(session.title, T.strong(10.5), CONTENT_WIDTH - 130);
        const metaLines = meta ? wrap(meta, T.body(9, C.textMuted), CONTENT_WIDTH - 130) : [];
        const height = titleLines.length * 15 + metaLines.length * 13 + (session.delayMinutes > 0 ? 24 : 0) + 14;
        ensure(height);
        drawText(page, formatTimeRange(session.start, session.end, tz, { withZone: false }), MARGIN, y - 11, T.strong(9.5, C.textSecondary));
        let rowY = y;
        for (const line of titleLines) {
          drawText(page, line, MARGIN + 130, rowY - 11, T.strong(10.5));
          rowY -= 15;
        }
        for (const line of metaLines) {
          drawText(page, line, MARGIN + 130, rowY - 9, T.body(9, C.textMuted));
          rowY -= 13;
        }
        if (session.delayMinutes > 0) {
          const label = `Ran ${session.delayMinutes} min late`;
          box(page, MARGIN + 130, rowY - 4, textWidth(label, T.strong(8.5)) + 16, 18, { fill: C.warningBg, radius: 9 });
          drawText(page, label, MARGIN + 138, rowY - 16, T.strong(8.5, C.warningFg));
          rowY -= 24;
        }
        y = rowY - 8;
        page.drawLine({ start: { x: MARGIN, y: y + 3 }, end: { x: PAGE[0] - MARGIN, y: y + 3 }, thickness: 0.5, color: C.border });
        y -= 6;
      }
      y -= 6;
    }

    if (speakers.length) {
      subheading("Speakers", `${plural(speakers.length, "speaker")}.`);
      const colWidth = (CONTENT_WIDTH - 20) / 2;
      for (let index = 0; index < speakers.length; index += 2) {
        ensure(40);
        speakers.slice(index, index + 2).forEach((speaker, column) => {
          const x = MARGIN + column * (colWidth + 20);
          const initial = clean(speaker.name).charAt(0).toUpperCase() || "?";
          page.drawCircle({ x: x + 14, y: y - 14, size: 14, color: A.soft });
          drawText(page, initial, x + 14 - textWidth(initial, T.heading(12, A.text)) / 2, y - 18, T.heading(12, A.text));
          drawText(page, fit(speaker.name, T.strong(10.5), colWidth - 40), x + 38, y - 11, T.strong(10.5));
          if (speaker.detail) drawText(page, fit(speaker.detail, T.body(9, C.textMuted), colWidth - 40), x + 38, y - 25, T.body(9, C.textMuted));
        });
        y -= 40;
      }
      y -= 4;
    }

    if (sponsors.length) {
      subheading("Sponsors and partners");
      const tiers = new Map<string, string[]>();
      for (const sponsor of sponsors) tiers.set(sponsor.tier, [...(tiers.get(sponsor.tier) ?? []), sponsor.name]);
      facts([...tiers].map(([tier, names]) => [SPONSOR_TIERS[tier] ?? tier, names.join(", ")]));
    }

    if (metrics.resourceCount) paragraph(`${plural(metrics.resourceCount, "resource")}, such as slides or links, ${metrics.resourceCount === 1 ? "was" : "were"} shared on the event page.`, T.body(10, C.textMuted));
  }

  // ---------- Feedback ----------

  const feedbackQuestions = metrics.feedbackQuestions ?? [];
  if (metrics.feedbackResponseCount != null && (metrics.feedbackResponseCount > 0 || feedbackQuestions.length > 0)) {
    const base = metrics.checkedIn || metrics.confirmed;
    section(
      "What people thought",
      "Feedback",
      `${plural(metrics.feedbackResponseCount, "response")} to “${metrics.feedbackTitle || "Event feedback"}”, from ${plural(base, "person", "people")} who ${metrics.checkedIn ? "checked in" : "had a place"} (${percentLabel(metrics.feedbackResponseCount, base)}).${metrics.certificatesEnabled ? " Certificates were offered with this form." : ""}`,
    );
    if (metrics.feedbackResponseCount === 0) paragraph("Nobody answered the feedback form.", T.body(), CONTENT_WIDTH);
    else questions(feedbackQuestions, A.solid, "Written answers are counted here, not shown. Read them in the feedback export.");
  }

  // ---------- Registration answers ----------

  const registrationQuestions = metrics.registrationQuestions ?? [];
  if (registrationQuestions.length) {
    section("What guests told you", "Registration answers", `Answers from the ${plural(metrics.confirmed, "person", "people")} going. Written answers, emails and phone numbers are counted, never shown.`);
    questions(registrationQuestions, A.solid, "Typed answers are counted here, not shown. Read them in the guest list export.");
  }

  // ---------- Emails and team ----------

  const broadcasts = metrics.broadcasts ?? [];
  section("Behind the scenes", metrics.targetType === "occurrence" ? "Team" : "Emails and team");
  if (metrics.targetType === "occurrence") {
    // Emails belong to one-off events; a series date has no email history of its own.
  } else if (broadcasts.length) {
    subheading("Emails to guests", `${plural(broadcasts.length, "email")} sent from Yuyu, ${plural(broadcasts.reduce((sum, item) => sum + item.recipientCount, 0), "delivery", "deliveries")} in total. Confirmation and ticket emails are not included.`);
    for (const broadcast of broadcasts) {
      ensure(30);
      drawText(page, formatDate(broadcast.sentAt, tz), MARGIN, y - 11, T.strong(9.5, C.textSecondary));
      drawText(page, fit(broadcast.subject, T.body(10.5, C.ink), CONTENT_WIDTH - 230), MARGIN + 110, y - 11, T.body(10.5, C.ink));
      const count = plural(broadcast.recipientCount, "recipient");
      drawText(page, count, PAGE[0] - MARGIN - textWidth(count, T.strong(9.5)), y - 11, T.strong(9.5));
      y -= 24;
      page.drawLine({ start: { x: MARGIN, y: y + 6 }, end: { x: PAGE[0] - MARGIN, y: y + 6 }, thickness: 0.5, color: C.border });
    }
    y -= 8;
  } else {
    paragraph("No emails were sent to guests from Yuyu, apart from confirmations and tickets.", T.body(), CONTENT_WIDTH);
  }
  if (metrics.targetType !== "occurrence") subheading("Team");
  facts([
    ["Co-organisers", metrics.coOrganiserCount ? `${plural(metrics.coOrganiserCount, "person", "people")} helped run this event` : "None added"],
  ]);

  // ---------- About this report ----------

  ensure(172);
  y -= 12;
  box(page, MARGIN, y, CONTENT_WIDTH, 140, { fill: C.tintPeach, radius: 16 });
  dotMark(page, MARGIN + 18, y - 18, 22);
  drawText(page, "About this report", MARGIN + 50, y - 32, T.heading(13));
  const generated = `Report generated on ${formatDayLong(now, tz, new Date(0))} at ${formatTime(now, tz)} ${formatTimeZoneName(now, tz)}`;
  drawText(page, generated, MARGIN + 50, y - 52, T.strong(10));
  const about = `Numbers reflect Yuyu's records at that moment. Times are in ${formatTimeZoneName(metrics.startDateTime, tz)} (${tz}). This report holds counts only: no guest is named, and no email address, phone number, ticket or written answer is included. Keep it with your event records, or share it with your team, partners and sponsors.`;
  const aboutLines = wrap(about, T.body(9.5), CONTENT_WIDTH - 68);
  aboutLines.slice(0, 5).forEach((line, index) => drawText(page, line, MARGIN + 50, y - 74 - index * 14, T.body(9.5)));
  y -= 152;

  // ---------- Footers ----------

  pages.forEach((current, index) => {
    current.drawLine({ start: { x: MARGIN, y: 52 }, end: { x: PAGE[0] - MARGIN, y: 52 }, thickness: 0.75, color: C.border });
    dotMark(current, MARGIN, 38, 14);
    drawText(current, "Made with Yuyu  ·  Counts only, no guest is named", MARGIN + 20, 28, T.body(8, C.textMuted));
    const label = `Page ${index + 1} of ${pages.length}`;
    drawText(current, label, PAGE[0] - MARGIN - textWidth(label, T.strong(8, C.textMuted)), 28, T.strong(8, C.textMuted));
  });

  return pdf.save();
}
