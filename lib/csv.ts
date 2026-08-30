/** Encode an untrusted value as a CSV cell safe to open in a spreadsheet. */
export function escapeCsvCell(value: string): string {
  // Formula sigils remain active after leading whitespace/control characters
  // in common spreadsheet importers. An apostrophe forces a literal value.
  const formulaLike = /^[\p{White_Space}\p{Cc}\p{Cf}]*[=+\-@]/u.test(value);
  const safeValue = formulaLike ? `'${value}` : value;
  return /[",\n\r]/.test(safeValue)
    ? `"${safeValue.replace(/"/g, '""')}"`
    : safeValue;
}

export function buildCsv(rows: ReadonlyArray<ReadonlyArray<string>>) {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}
