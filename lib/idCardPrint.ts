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
};

export const A6_PORTRAIT = { widthMm: 105, heightMm: 148 };
export const A6_LANDSCAPE = { widthMm: 148, heightMm: 105 };

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

export function defaultIdCardElementPositions(
  template: IdCardPrintSettings["template"],
  widthMm: number,
  heightMm: number,
): IdCardElementPositions {
  const qrX = Math.max(4, widthMm - 32);
  const qrY = Math.max(4, heightMm - 32);
  if (template === "bold") {
    return {
      header: { xMm: 16, yMm: 9 },
      name: { xMm: 16, yMm: 45 },
      email: { xMm: 16, yMm: 57 },
      details: { xMm: 16, yMm: 68 },
      qr: { xMm: qrX, yMm: 8 },
      footer: { xMm: 16, yMm: Math.max(8, heightMm - 9) },
      logo: { xMm: Math.max(4, widthMm - 24), yMm: Math.max(4, heightMm - 28) },
    };
  }
  if (template === "minimal") {
    return {
      header: { xMm: 10, yMm: 10 },
      name: { xMm: 10, yMm: 48 },
      email: { xMm: 10, yMm: 60 },
      details: { xMm: 10, yMm: 72 },
      qr: { xMm: qrX, yMm: qrY },
      footer: { xMm: 10, yMm: Math.max(8, heightMm - 12) },
      logo: { xMm: Math.max(4, widthMm - 23), yMm: 10 },
    };
  }
  return {
    header: { xMm: 9, yMm: 9 },
    name: { xMm: 9, yMm: 47 },
    email: { xMm: 9, yMm: 59 },
    details: { xMm: 9, yMm: 73 },
    qr: { xMm: qrX, yMm: qrY },
    footer: { xMm: 9, yMm: Math.max(8, heightMm - 12) },
    logo: { xMm: Math.max(4, widthMm - 24), yMm: 9 },
  };
}

export function defaultIdCardElementSizes(
  template: IdCardPrintSettings["template"],
  widthMm: number,
): IdCardElementSizes {
  const textWidth = (reservedMm: number) => Math.max(20, widthMm - reservedMm);
  if (template === "bold") {
    return {
      header: textWidth(40), name: textWidth(56), email: textWidth(56), details: textWidth(56),
      qr: 22, footer: textWidth(25), logo: 13,
    };
  }
  if (template === "minimal") {
    return {
      header: textWidth(43), name: textWidth(19), email: textWidth(19), details: textWidth(19),
      qr: 22, footer: textWidth(49), logo: 13,
    };
  }
  return {
    header: textWidth(33), name: textWidth(18), email: textWidth(18), details: textWidth(49),
    qr: 22, footer: textWidth(49), logo: 13,
  };
}

export function defaultIdCardElementBold(): IdCardElementBold {
  return { header: true, name: true, email: false, details: false, qr: false, footer: false, logo: false };
}

export function defaultIdCardElementTextSizes(template: IdCardPrintSettings["template"] = "classic"): IdCardElementTextSizes {
  if (template === "bold") return { header: 28, name: 17, email: 10, details: 8.5, qr: 0, footer: 8, logo: 0 };
  if (template === "minimal") return { header: 24, name: 15, email: 10, details: 8.5, qr: 0, footer: 8, logo: 0 };
  return { header: 26, name: 16, email: 10, details: 8.5, qr: 0, footer: 8, logo: 0 };
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

function elementSizes(value: unknown, template: IdCardPrintSettings["template"], widthMm: number) {
  const fallback = defaultIdCardElementSizes(template, widthMm);
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

function elementTextSizes(value: unknown, template: IdCardPrintSettings["template"]) {
  const fallback = defaultIdCardElementTextSizes(template);
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
    elementSizes: defaultIdCardElementSizes("classic", A6_PORTRAIT.widthMm),
    elementBold: defaultIdCardElementBold(),
    elementTextSizes: defaultIdCardElementTextSizes("classic"),
    gridSizeMm: 5,
    showGrid: true,
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
  const sizes = elementSizes(input.elementSizes, template, widthMm);
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
    elementTextSizes: elementTextSizes(input.elementTextSizes, template),
    gridSizeMm: gridSizeMm(input.gridSizeMm),
    showGrid: typeof input.showGrid === "boolean" ? input.showGrid : fallback.showGrid,
  };
}
