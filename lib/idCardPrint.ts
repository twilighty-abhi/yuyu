export type IdCardPrintSettings = {
  widthMm: number;
  heightMm: number;
  heading: string;
  badgeLabel: string;
  showEmail: boolean;
  template: "classic" | "bold" | "minimal";
  accentColor: string;
  footerText: string;
  showLogo: boolean;
  /** Fields chosen by the organiser for the lower portion of each card. */
  printFieldKeys: string[];
  /** Optional per-card labels; keys correspond to `printFieldKeys`. */
  printFieldLabels: Record<string, string>;
};

export const ORGANISATION_NAME_CARD_FIELD = "system:organisation-name";

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

function accentColor(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toUpperCase()
    : fallback;
}

function printableFieldKeys(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const keys = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= 160)
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
      .filter(([, label]) => label.length > 0)
      .slice(0, 16),
  );
}

export function defaultIdCardPrintSettings(eventTitle: string, organisationName = ""): IdCardPrintSettings {
  return {
    ...A6_PORTRAIT,
    heading: eventTitle.trim().slice(0, 120) || "Event attendee",
    badgeLabel: "ATTENDEE",
    showEmail: true,
    template: "classic",
    accentColor: "#2563EB",
    footerText: organisationName.trim().slice(0, 80) || "Event check-in",
    showLogo: true,
    printFieldKeys: [ORGANISATION_NAME_CARD_FIELD],
    printFieldLabels: {},
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
  return {
    widthMm: boundedDimension(input.widthMm, fallback.widthMm),
    heightMm: boundedDimension(input.heightMm, fallback.heightMm),
    heading: boundedText(input.heading, fallback.heading, 120),
    badgeLabel: boundedText(input.badgeLabel, fallback.badgeLabel, 40),
    showEmail: typeof input.showEmail === "boolean" ? input.showEmail : fallback.showEmail,
    template: input.template === "bold" || input.template === "minimal" || input.template === "classic"
      ? input.template
      : fallback.template,
    accentColor: accentColor(input.accentColor, fallback.accentColor),
    footerText: boundedText(input.footerText, fallback.footerText, 80),
    showLogo: typeof input.showLogo === "boolean" ? input.showLogo : fallback.showLogo,
    printFieldKeys: printableFieldKeys(input.printFieldKeys, fallback.printFieldKeys),
    printFieldLabels: printableFieldLabels(input.printFieldLabels),
  };
}
