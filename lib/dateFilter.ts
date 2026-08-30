const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseUtcDateOnly(value: string): Date | null {
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

export function parseDiscoveryDateRange(from: string | undefined, to: string | undefined) {
  const fromValue = from?.trim() ?? "";
  const toValue = to?.trim() ?? "";
  const fromDate = fromValue ? parseUtcDateOnly(fromValue) : null;
  const toDate = toValue ? parseUtcDateOnly(toValue) : null;

  if ((fromValue && !fromDate) || (toValue && !toDate)) {
    return { fromDate: null, toExclusive: null, error: "Choose valid calendar dates." } as const;
  }
  if (fromDate && toDate && fromDate > toDate) {
    return { fromDate: null, toExclusive: null, error: "The from date must be on or before the to date." } as const;
  }

  const toExclusive = toDate
    ? new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate() + 1))
    : null;
  return { fromDate, toExclusive, error: null } as const;
}
