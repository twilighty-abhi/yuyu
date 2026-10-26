export const ID_CARD_LAYOUT_ELEMENTS = ["header", "name", "email", "details", "qr", "footer", "logo"] as const;

export type IdCardLayoutElement = (typeof ID_CARD_LAYOUT_ELEMENTS)[number];
export type IdCardElementPosition = { xMm: number; yMm: number };
export type IdCardElementPositions = Record<IdCardLayoutElement, IdCardElementPosition>;
export type IdCardElementSizes = Record<IdCardLayoutElement, number>;
export type IdCardElementBold = Record<IdCardLayoutElement, boolean>;
export type IdCardElementTextSizes = Record<IdCardLayoutElement, number>;
export const ID_CARD_GRID_SIZES_MM = [1, 2, 5, 10] as const;
export type IdCardGridSizeMm = (typeof ID_CARD_GRID_SIZES_MM)[number];

export type IdCardPrintSettings = {
  widthMm: number;
  heightMm: number;
  heading: string;
  badgeLabel: string;
  showEmail: boolean;
  template: "classic" | "bold" | "minimal";
  footerText: string;
  showLogo: boolean;
  /** Fields chosen by the organiser for the lower portion of each card. */
  printFieldKeys: string[];
  /** Optional per-card labels; keys correspond to `printFieldKeys`. */
  printFieldLabels: Record<string, string>;
  /** Upper-left positions used by the interactive, millimetre-based card layout. */
  elementPositions: IdCardElementPositions;
  /** Width in millimetres for text elements and square size for QR/logo elements. */
  elementSizes: IdCardElementSizes;
  /** Whether each text element should use a heavier weight. */
  elementBold: IdCardElementBold;
  /** Point size for each text element; QR and logo entries are unused. */
  elementTextSizes: IdCardElementTextSizes;
  /** Design-surface preferences saved with this event's local card settings. */
  gridSizeMm: IdCardGridSizeMm;
  showGrid: boolean;
  /** Shrink long attendee names (down to 60%) so they stay on one line. */
  nameAutoFit: boolean;
  showBadgeLabel: boolean;
  showFooter: boolean;
};

export const A6_PORTRAIT = { widthMm: 105, heightMm: 148 };
export const A6_LANDSCAPE = { widthMm: 148, heightMm: 105 };

/** Common badge stocks. Portrait sizes; the designer offers the landscape turn. */
export const ID_CARD_PAPER_PRESETS = [
  { id: "a6", label: "A6", detail: "105 × 148 mm · sheet paper", widthMm: 105, heightMm: 148 },
  { id: "4x6", label: "4 × 6 in", detail: "Label printer badge", widthMm: 101.6, heightMm: 152.4 },
  { id: "3x4", label: "3 × 4 in", detail: "Lanyard pouch badge", widthMm: 76.2, heightMm: 101.6 },
  { id: "4x3", label: "4 × 3 in", detail: "Landscape pouch badge", widthMm: 101.6, heightMm: 76.2 },
  { id: "cr80", label: "ID card (CR80)", detail: "85.6 × 54 mm · PVC card", widthMm: 85.6, heightMm: 53.98 },
] as const;

export function matchPaperPreset(widthMm: number, heightMm: number) {
  const close = (a: number, b: number) => Math.abs(a - b) < 0.6;
  for (const preset of ID_CARD_PAPER_PRESETS) {
    if (close(preset.widthMm, widthMm) && close(preset.heightMm, heightMm)) return { preset, rotated: false };
    if (close(preset.widthMm, heightMm) && close(preset.heightMm, widthMm)) return { preset, rotated: true };
  }
  return null;
}

/** The small label above the heading scales with it: about half the heading size, 5.5–9pt. */
export function badgeLabelPt(headerPt: number) {
  return Math.min(9, Math.max(5.5, Math.round(headerPt * 0.5 * 2) / 2));
}

/** Layout scale relative to A6 (1 on A6), so small stock gets proportionally smaller text and margins. */
export function paperScale(widthMm: number, heightMm: number) {
  return Math.min(1.6, Math.max(0.45, Math.min(widthMm, heightMm) / 105));
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Point size that keeps `text` on one line within `widthMm`, never above
 * `sizePt` and never below `minRatio` of it (then it wraps instead). Uses an
 * average glyph width, which is close enough for names in sans-serif type.
 */
export function fitTextSizePt(text: string, widthMm: number, sizePt: number, bold: boolean, minRatio = 0.6) {
  const chars = Math.max(1, text.trim().length);
  const emPerChar = bold ? 0.6 : 0.54;
  const fitting = widthMm / (chars * emPerChar * 0.3528);
  return round1(Math.max(sizePt * minRatio, Math.min(sizePt, fitting)));
}

const MIN_DIMENSION_MM = 40;
const MAX_DIMENSION_MM = 300;

function boundedDimension(value: unknown, fallback: number) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(MAX_DIMENSION_MM, Math.max(MIN_DIMENSION_MM, Math.round(numberValue * 10) / 10));
}

function boundedText(value: unknown, fallback: string, maxLength: number) {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, maxLength) || fallback;
}

function printableFieldKeys(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const keys = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= 160 && !item.startsWith("system:"))
    .filter((item, index, all) => all.indexOf(item) === index)
    .slice(0, 16);
  return keys;
}

function printableFieldLabels(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, label]) => key.length <= 160 && typeof label === "string")
      .map(([key, label]) => [key, label.trim().slice(0, 60)])
      .slice(0, 16),
  );
}

/** Millimetres per typographic point. */
export const PT_TO_MM = 0.3528;

/** Line heights shared by the preview and the print sheet. */
export const ID_CARD_LINE_HEIGHT = { label: 1.2, heading: 1.1, name: 1.1, body: 1.25 } as const;

/**
 * The fixed, non-draggable look of each template, shared by the on-screen
 * card and the print sheet so both draw the same rules, frame and band.
 * Black and white only: thin black rules and solid black, never grey fills.
 */
export type IdCardTemplateDecor = {
  /** Classic: a thin frame inset from the paper edge (inside printers' unprintable margin). */
  frame: { insetMm: number; ruleMm: number; radiusMm: number } | null;
  /** Classic: a hairline under the heading block. */
  headerRule: { gapMm: number; ruleMm: number } | null;
  /** Bold: the heading block becomes a solid black band with white text. */
  band: { padXMm: number; padYMm: number; radiusMm: number } | null;
  /** Space between the small badge label and the heading. */
  labelGapMm: number;
  /** Letter spacing for the attendee name, in em. */
  nameTrackingEm: number;
  /** Bold prints names in capitals. */
  nameUppercase: boolean;
};

const marginMm = (k: number) => Math.max(3, round1(10 * k));
const bandInsetMm = (k: number) => Math.max(4, round1(5 * k));

export function idCardTemplateDecor(template: IdCardPrintSettings["template"], widthMm: number, heightMm: number): IdCardTemplateDecor {
  const k = paperScale(widthMm, heightMm);
  const labelGapMm = Math.max(1, round1(2 * k));
  if (template === "bold") {
    return {
      frame: null,
      headerRule: null,
      band: { padXMm: Math.max(2, round1(marginMm(k) - bandInsetMm(k))), padYMm: Math.max(2, round1(4.5 * k)), radiusMm: Math.max(1, round1(2 * k)) },
      labelGapMm,
      nameTrackingEm: 0,
      nameUppercase: true,
    };
  }
  if (template === "minimal") {
    return { frame: null, headerRule: null, band: null, labelGapMm, nameTrackingEm: -0.02, nameUppercase: false };
  }
  return {
    frame: { insetMm: Math.max(2.5, round1(5 * k)), ruleMm: 0.3, radiusMm: Math.max(1, round1(2.5 * k)) },
    headerRule: { gapMm: Math.max(1.5, round1(3 * k)), ruleMm: 0.25 },
    band: null,
    labelGapMm,
    nameTrackingEm: -0.02,
    nameUppercase: false,
  };
}

/**
 * Estimated height of the heading block (label, one line of heading, and the
 * template's rule or band padding). Used to keep the name clear of it.
 */
export function estimateHeaderHeightMm(
  template: IdCardPrintSettings["template"],
  headerPt: number,
  widthMm: number,
  heightMm: number,
  options: { label?: boolean; headingLines?: number } = {},
) {
  const decor = idCardTemplateDecor(template, widthMm, heightMm);
  const label = options.label === false ? 0 : badgeLabelPt(headerPt) * PT_TO_MM * ID_CARD_LINE_HEIGHT.label + decor.labelGapMm;
  let height = label + headerPt * PT_TO_MM * ID_CARD_LINE_HEIGHT.heading * (options.headingLines ?? 1);
  if (decor.headerRule) height += decor.headerRule.gapMm + decor.headerRule.ruleMm;
  if (decor.band) height += decor.band.padYMm * 2;
  return round1(height);
}

/** Room kept for the name: one line at full size, or two lines once auto-fit has shrunk it to 60%. */
export function nameBlockHeightMm(namePt: number) {
  return round1(namePt * PT_TO_MM * ID_CARD_LINE_HEIGHT.name * 1.2);
}

/**
 * Default boxes for a template on the given paper. Tuned on A6 portrait;
 * other stock scales margins and type with the paper. Content stacks from the
 * top (heading, name, email, answers); the QR sits in the bottom-right corner
 * and the footer along the bottom-left, so nothing overlaps on any preset.
 */
function defaultGeometry(template: IdCardPrintSettings["template"], widthMm: number, heightMm: number) {
  const k = paperScale(widthMm, heightMm);
  const m = marginMm(k);
  const decor = idCardTemplateDecor(template, widthMm, heightMm);
  const text = defaultIdCardElementTextSizes(template, widthMm, heightMm);
  const line = (pt: number) => pt * PT_TO_MM * ID_CARD_LINE_HEIGHT.body;
  const width = (mm: number) => Math.max(20, round1(mm));

  const qrSize = Math.min(40, Math.max(16, round1((template === "minimal" ? 21 : 24) * k)));
  const logoSize = Math.min(20, Math.max(10, round1((template === "minimal" ? 10 : 12) * k)));
  // The QR block has 1 mm of white padding; align the code itself with the margin.
  const qr = { xMm: round1(widthMm - m - qrSize - 1), yMm: round1(heightMm - m - qrSize - 1) };
  const qrLeft = qr.xMm + 1;

  const inset = bandInsetMm(k);
  const header = decor.band ? { xMm: inset, yMm: inset } : { xMm: m, yMm: m };
  const textX = decor.band ? round1(inset + decor.band.padXMm) : m;
  const leftOfQr = qrLeft - textX - 4 * k;

  // Bold keeps the band clean: its logo sits beside the QR at the bottom, or
  // above the QR when the card is too narrow to share the bottom row.
  let logo = { xMm: round1(widthMm - m - logoSize), yMm: m };
  let footerWidth = leftOfQr;
  if (template === "bold") {
    const besideX = qrLeft - 4 * k - logoSize;
    if (besideX - textX - 3 * k >= 30) {
      logo = { xMm: round1(besideX), yMm: round1(heightMm - m - logoSize) };
      footerWidth = besideX - textX - 3 * k;
    } else {
      logo = { xMm: round1(widthMm - m - logoSize), yMm: round1(qr.yMm + 1 - 3 * k - logoSize) };
    }
  }

  const headerBottom = header.yMm + estimateHeaderHeightMm(template, text.header, widthMm, heightMm);
  const nameRatio = template === "bold" ? 0.26 : template === "minimal" ? 0.36 : 0.3;
  const nameY = round1(Math.max(headerBottom + (template === "minimal" ? 8 : 6) * k, heightMm * nameRatio));
  const emailY = round1(nameY + nameBlockHeightMm(text.name) + 1.5 * k);
  const detailsY = round1(emailY + line(text.email) + 4 * k);

  // On landscape stock the QR sits beside the text, so text stops short of it.
  const landscape = widthMm > heightMm * 1.15;
  const full = widthMm - textX - m;
  const nameWidth = width(landscape ? Math.min(full, leftOfQr) : full);

  const positions: IdCardElementPositions = {
    header,
    name: { xMm: textX, yMm: nameY },
    email: { xMm: textX, yMm: emailY },
    details: { xMm: textX, yMm: detailsY },
    qr,
    footer: { xMm: textX, yMm: round1(heightMm - m - line(text.footer)) },
    logo,
  };
  const sizes: IdCardElementSizes = {
    header: decor.band ? width(widthMm - 2 * inset) : width(logo.xMm - textX - 4 * k),
    name: nameWidth,
    email: nameWidth,
    details: width(leftOfQr),
    qr: qrSize,
    footer: width(footerWidth),
    logo: logoSize,
  };
  return { positions, sizes };
}

export function defaultIdCardElementPositions(
  template: IdCardPrintSettings["template"],
  widthMm: number,
  heightMm: number,
): IdCardElementPositions {
  return defaultGeometry(template, widthMm, heightMm).positions;
}

export function defaultIdCardElementSizes(
  template: IdCardPrintSettings["template"],
  widthMm: number,
  heightMm: number = A6_PORTRAIT.heightMm,
): IdCardElementSizes {
  return defaultGeometry(template, widthMm, heightMm).sizes;
}

export function defaultIdCardElementBold(): IdCardElementBold {
  return { header: true, name: true, email: false, details: false, qr: false, footer: false, logo: false };
}

export function defaultIdCardElementTextSizes(
  template: IdCardPrintSettings["template"] = "classic",
  widthMm: number = A6_PORTRAIT.widthMm,
  heightMm: number = A6_PORTRAIT.heightMm,
): IdCardElementTextSizes {
  // The name is always the largest thing on the card; the heading stays small.
  const base = template === "bold"
    ? { header: 14, name: 28, email: 10, details: 8.5, footer: 7.5 }
    : template === "minimal"
      ? { header: 10, name: 30, email: 9.5, details: 8.5, footer: 7.5 }
      : { header: 13, name: 30, email: 10, details: 8.5, footer: 7.5 };
  const k = paperScale(widthMm, heightMm);
  const scaled = (pt: number, min: number) => Math.max(min, Math.round(pt * k * 2) / 2);
  return {
    header: scaled(base.header, 6), name: scaled(base.name, 9), email: scaled(base.email, 6),
    details: scaled(base.details, 6), qr: 0, footer: scaled(base.footer, 6), logo: 0,
  };
}

function boundedPosition(value: unknown, fallback: IdCardElementPosition, widthMm: number, heightMm: number) {
  if (!value || typeof value !== "object") return fallback;
  const input = value as Partial<IdCardElementPosition>;
  const x = typeof input.xMm === "number" ? input.xMm : Number(input.xMm);
  const y = typeof input.yMm === "number" ? input.yMm : Number(input.yMm);
  return {
    xMm: Number.isFinite(x) ? Math.min(widthMm - 4, Math.max(0, Math.round(x * 10) / 10)) : fallback.xMm,
    yMm: Number.isFinite(y) ? Math.min(heightMm - 4, Math.max(0, Math.round(y * 10) / 10)) : fallback.yMm,
  };
}

function elementPositions(
  value: unknown,
  template: IdCardPrintSettings["template"],
  widthMm: number,
  heightMm: number,
) {
  const fallback = defaultIdCardElementPositions(template, widthMm, heightMm);
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<Record<IdCardLayoutElement, unknown>>
    : {};
  return Object.fromEntries(ID_CARD_LAYOUT_ELEMENTS.map((element) => [
    element,
    boundedPosition(input[element], fallback[element], widthMm, heightMm),
  ])) as IdCardElementPositions;
}

function elementSizes(value: unknown, template: IdCardPrintSettings["template"], widthMm: number, heightMm: number) {
  const fallback = defaultIdCardElementSizes(template, widthMm, heightMm);
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<Record<IdCardLayoutElement, unknown>>
    : {};
  return Object.fromEntries(ID_CARD_LAYOUT_ELEMENTS.map((element) => {
    const size = typeof input[element] === "number" ? input[element] : Number(input[element]);
    const minimum = element === "qr" || element === "logo" ? 10 : 20;
    const maximum = Math.max(minimum, widthMm - 4);
    return [element, Number.isFinite(size) ? Math.min(maximum, Math.max(minimum, Math.round(size * 10) / 10)) : fallback[element]];
  })) as IdCardElementSizes;
}

function fitElementPositions(
  positions: IdCardElementPositions,
  sizes: IdCardElementSizes,
  widthMm: number,
  heightMm: number,
) {
  return Object.fromEntries(ID_CARD_LAYOUT_ELEMENTS.map((element) => {
    const squareElement = element === "qr" || element === "logo";
    return [element, {
      xMm: Math.min(Math.max(0, widthMm - sizes[element] - 4), positions[element].xMm),
      yMm: squareElement ? Math.min(Math.max(0, heightMm - sizes[element] - 4), positions[element].yMm) : positions[element].yMm,
    }];
  })) as IdCardElementPositions;
}

function elementBold(value: unknown) {
  const fallback = defaultIdCardElementBold();
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const input = value as Partial<Record<IdCardLayoutElement, unknown>>;
  return Object.fromEntries(ID_CARD_LAYOUT_ELEMENTS.map((element) => [
    element,
    typeof input[element] === "boolean" ? input[element] : fallback[element],
  ])) as IdCardElementBold;
}

function elementTextSizes(value: unknown, template: IdCardPrintSettings["template"], widthMm: number, heightMm: number) {
  const fallback = defaultIdCardElementTextSizes(template, widthMm, heightMm);
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<Record<IdCardLayoutElement, unknown>>
    : {};
  return Object.fromEntries(ID_CARD_LAYOUT_ELEMENTS.map((element) => {
    if (element === "qr" || element === "logo") return [element, 0];
    const size = typeof input[element] === "number" ? input[element] : Number(input[element]);
    return [element, Number.isFinite(size) ? Math.min(48, Math.max(6, Math.round(size * 10) / 10)) : fallback[element]];
  })) as IdCardElementTextSizes;
}

function gridSizeMm(value: unknown): IdCardGridSizeMm {
  const numberValue = typeof value === "number" ? value : Number(value);
  return ID_CARD_GRID_SIZES_MM.find((size) => size === numberValue) ?? 5;
}

export function defaultIdCardPrintSettings(eventTitle: string, organisationName = ""): IdCardPrintSettings {
  return {
    ...A6_PORTRAIT,
    heading: eventTitle.trim().slice(0, 120) || "Event attendee",
    badgeLabel: "ATTENDEE",
    showEmail: true,
    template: "classic",
    footerText: organisationName.trim().slice(0, 80) || "Event check-in",
    showLogo: true,
    printFieldKeys: [],
    printFieldLabels: {},
    elementPositions: defaultIdCardElementPositions("classic", A6_PORTRAIT.widthMm, A6_PORTRAIT.heightMm),
    elementSizes: defaultIdCardElementSizes("classic", A6_PORTRAIT.widthMm, A6_PORTRAIT.heightMm),
    elementBold: defaultIdCardElementBold(),
    elementTextSizes: defaultIdCardElementTextSizes("classic"),
    gridSizeMm: 5,
    showGrid: true,
    nameAutoFit: true,
    showBadgeLabel: true,
    showFooter: true,
  };
}

/** Keep locally saved station settings safe and usable before printing. */
export function normalizeIdCardPrintSettings(
  value: unknown,
  eventTitle: string,
  organisationName = "",
): IdCardPrintSettings {
  const fallback = defaultIdCardPrintSettings(eventTitle, organisationName);
  if (!value || typeof value !== "object") return fallback;
  const input = value as Partial<IdCardPrintSettings>;
  const widthMm = boundedDimension(input.widthMm, fallback.widthMm);
  const heightMm = boundedDimension(input.heightMm, fallback.heightMm);
  const template = input.template === "bold" || input.template === "minimal" || input.template === "classic"
    ? input.template
    : fallback.template;
  const sizes = elementSizes(input.elementSizes, template, widthMm, heightMm);
  const positions = elementPositions(input.elementPositions, template, widthMm, heightMm);
  return {
    widthMm,
    heightMm,
    heading: boundedText(input.heading, fallback.heading, 120),
    badgeLabel: boundedText(input.badgeLabel, fallback.badgeLabel, 40),
    showEmail: typeof input.showEmail === "boolean" ? input.showEmail : fallback.showEmail,
    template,
    footerText: boundedText(input.footerText, fallback.footerText, 80),
    showLogo: typeof input.showLogo === "boolean" ? input.showLogo : fallback.showLogo,
    printFieldKeys: printableFieldKeys(input.printFieldKeys, fallback.printFieldKeys),
    printFieldLabels: printableFieldLabels(input.printFieldLabels),
    elementPositions: fitElementPositions(positions, sizes, widthMm, heightMm),
    elementSizes: sizes,
    elementBold: elementBold(input.elementBold),
    elementTextSizes: elementTextSizes(input.elementTextSizes, template, widthMm, heightMm),
    gridSizeMm: gridSizeMm(input.gridSizeMm),
    showGrid: typeof input.showGrid === "boolean" ? input.showGrid : fallback.showGrid,
    nameAutoFit: typeof input.nameAutoFit === "boolean" ? input.nameAutoFit : fallback.nameAutoFit,
    showBadgeLabel: typeof input.showBadgeLabel === "boolean" ? input.showBadgeLabel : fallback.showBadgeLabel,
    showFooter: typeof input.showFooter === "boolean" ? input.showFooter : fallback.showFooter,
  };
}

/** A fresh layout for `template` on the given paper: positions, sizes and text sizes together. */
export function layoutForPaper(template: IdCardPrintSettings["template"], widthMm: number, heightMm: number) {
  return {
    elementPositions: defaultIdCardElementPositions(template, widthMm, heightMm),
    elementSizes: defaultIdCardElementSizes(template, widthMm, heightMm),
    elementTextSizes: defaultIdCardElementTextSizes(template, widthMm, heightMm),
    elementBold: defaultIdCardElementBold(),
  };
}

const DESIGN_FILE_KIND = "yuyu-id-card-design";

/** A portable design file, for copying a badge design to another check-in desk. */
export function exportIdCardDesign(settings: IdCardPrintSettings): string {
  return JSON.stringify({ kind: DESIGN_FILE_KIND, version: 1, settings }, null, 2);
}

/** Read a design file; anything unexpected is normalised or rejected, never trusted. */
export function importIdCardDesign(text: string, eventTitle: string, organisationName = ""): IdCardPrintSettings | null {
  try {
    const parsed = JSON.parse(text) as { kind?: unknown; settings?: unknown };
    if (!parsed || parsed.kind !== DESIGN_FILE_KIND || !parsed.settings || typeof parsed.settings !== "object") return null;
    return normalizeIdCardPrintSettings(parsed.settings, eventTitle, organisationName);
  } catch {
    return null;
  }
}

/* ---------- Merge fields (docs/TEAMS.md) ---------- */

/** Typed into the heading, badge label or footer; replaced by the attendee's team name (empty when solo). */
export const ID_CARD_TEAM_MERGE_FIELD = "{{team}}";

/** The printable "Team" line in the answers list. Not a registration question, so it has its own prefix. */
export const ID_CARD_TEAM_FIELD_KEY = "attendee:team";

const TEAM_MERGE_PATTERN = /\{\{\s*team\s*\}\}/gi;

/**
 * Fill `{{team}}` in a badge text. Text without a merge field is returned
 * untouched; with one, the result is trimmed and doubled spaces collapsed so
 * a solo attendee's badge does not print a gap.
 */
export function applyIdCardMergeFields(text: string, values: { team?: string | null }): string {
  if (!text.match(TEAM_MERGE_PATTERN)) return text;
  return text.replace(TEAM_MERGE_PATTERN, (values.team ?? "").trim()).replace(/ {2,}/g, " ").trim();
}
