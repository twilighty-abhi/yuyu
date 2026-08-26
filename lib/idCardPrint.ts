export type IdCardPrintSettings = {
  widthMm: number;
  heightMm: number;
  heading: string;
  badgeLabel: string;
  showEmail: boolean;
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

export function defaultIdCardPrintSettings(eventTitle: string): IdCardPrintSettings {
  return {
    ...A6_PORTRAIT,
    heading: eventTitle.trim().slice(0, 120) || "Event attendee",
    badgeLabel: "ATTENDEE",
    showEmail: true,
  };
}

/** Keep locally saved station settings safe and usable before printing. */
export function normalizeIdCardPrintSettings(
  value: unknown,
  eventTitle: string,
): IdCardPrintSettings {
  const fallback = defaultIdCardPrintSettings(eventTitle);
  if (!value || typeof value !== "object") return fallback;
  const input = value as Partial<IdCardPrintSettings>;
  return {
    widthMm: boundedDimension(input.widthMm, fallback.widthMm),
    heightMm: boundedDimension(input.heightMm, fallback.heightMm),
    heading: boundedText(input.heading, fallback.heading, 120),
    badgeLabel: boundedText(input.badgeLabel, fallback.badgeLabel, 40),
    showEmail: typeof input.showEmail === "boolean" ? input.showEmail : fallback.showEmail,
  };
}
