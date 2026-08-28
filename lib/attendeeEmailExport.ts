export type AttendeeEmailExportRow = {
  guestEmail: string | null;
  guestName?: string | null;
  user: { name: string | null; email: string | null } | null;
};

function escapeCsvCell(value: string): string {
  // Spreadsheet applications treat these prefixes as formulas even in a CSV.
  // Prefix with a tab so attendee-controlled values remain literal text.
  const safeValue = /^[=+\-@]/.test(value) ? `\t${value}` : value;
  return /[",\n\r]/.test(safeValue)
    ? `"${safeValue.replace(/"/g, '""')}"`
    : safeValue;
}

/** Builds a CSV of unique attendee email addresses and their displayed names. */
export function buildAttendeeEmailCsv(attendees: AttendeeEmailExportRow[]): string {
  const seen = new Set<string>();
  const rows: Array<[string, string]> = [];

  for (const attendee of attendees) {
    const email = (attendee.user?.email ?? attendee.guestEmail ?? "").trim();
    const normalized = email.toLowerCase();
    if (!email || seen.has(normalized)) continue;
    seen.add(normalized);
    const name = (attendee.user?.name ?? attendee.guestName ?? "").trim();
    rows.push([name, email]);
  }

  return ["Name,Email", ...rows.map((row) => row.map(escapeCsvCell).join(","))].join("\n");
}

export function attendeeEmailExportFilename(eventTitle: string, date = new Date()): string {
  const safeTitle = eventTitle
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 50);
  return `attendee_emails_${safeTitle}_${date.toISOString().slice(0, 10)}.csv`;
}
