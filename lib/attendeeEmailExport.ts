export type AttendeeEmailExportRow = {
  guestEmail: string | null;
  user: { email: string | null } | null;
};

function escapeCsvCell(value: string): string {
  // Spreadsheet applications treat these prefixes as formulas even in a CSV.
  // Prefix with a tab so attendee-controlled values remain literal text.
  const safeValue = /^[=+\-@]/.test(value) ? `\t${value}` : value;
  return /[",\n\r]/.test(safeValue)
    ? `"${safeValue.replace(/"/g, '""')}"`
    : safeValue;
}

/** Builds a single-column CSV of unique attendee email addresses. */
export function buildAttendeeEmailCsv(attendees: AttendeeEmailExportRow[]): string {
  const seen = new Set<string>();
  const emails: string[] = [];

  for (const attendee of attendees) {
    const email = (attendee.user?.email ?? attendee.guestEmail ?? "").trim();
    const normalized = email.toLowerCase();
    if (!email || seen.has(normalized)) continue;
    seen.add(normalized);
    emails.push(email);
  }

  return ["Email", ...emails.map(escapeCsvCell)].join("\n");
}

export function attendeeEmailExportFilename(eventTitle: string, date = new Date()): string {
  const safeTitle = eventTitle
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 50);
  return `attendee_emails_${safeTitle}_${date.toISOString().slice(0, 10)}.csv`;
}
