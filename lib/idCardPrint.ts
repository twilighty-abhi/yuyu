export const ID_CARD_LAYOUT_ELEMENTS = ["header", "name", "email", "details", "qr", "footer", "logo"] as const;

export type IdCardLayoutElement = (typeof ID_CARD_LAYOUT_ELEMENTS)[number];
export type IdCardElementPosition = { xMm: number; yMm: number };
export type IdCardElementPositions = Record<IdCardLayoutElement, IdCardElementPosition>;

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
      header: { xMm: 16, yMm: Math.max(8, heightMm - 28) },
      name: { xMm: 16, yMm: 9 },
      email: { xMm: 16, yMm: 47 },
      details: { xMm: 16, yMm: 59 },
      qr: { xMm: qrX, yMm: 8 },
      footer: { xMm: 16, yMm: Math.max(8, heightMm - 9) },
      logo: { xMm: Math.max(4, widthMm - 24), yMm: Math.max(4, heightMm - 28) },
    };
  }
  if (template === "minimal") {
    return {
      header: { xMm: 10, yMm: Math.max(8, heightMm - 27) },
      name: { xMm: 10, yMm: 30 },
      email: { xMm: 10, yMm: 52 },
      details: { xMm: 10, yMm: 66 },
      qr: { xMm: qrX, yMm: qrY },
      footer: { xMm: 10, yMm: Math.max(8, heightMm - 12) },
      logo: { xMm: Math.max(4, widthMm - 23), yMm: 10 },
    };
  }
  return {
    header: { xMm: 9, yMm: 9 },
    name: { xMm: 9, yMm: 36 },
    email: { xMm: 9, yMm: 59 },
    details: { xMm: 9, yMm: 73 },
    qr: { xMm: qrX, yMm: qrY },
    footer: { xMm: 9, yMm: Math.max(8, heightMm - 12) },
    logo: { xMm: Math.max(4, widthMm - 24), yMm: 9 },
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
    elementPositions: elementPositions(input.elementPositions, template, widthMm, heightMm),
  };
}
