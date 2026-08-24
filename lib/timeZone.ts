export function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

/** Protect render paths from legacy rows written before timezone validation. */
export function safeTimeZone(value: string) {
  return isValidTimeZone(value) ? value : "UTC";
}
