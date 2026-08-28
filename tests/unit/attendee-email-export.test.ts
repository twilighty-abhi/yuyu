import { describe, expect, it } from "vitest";
import {
  attendeeEmailExportFilename,
  buildAttendeeEmailCsv,
} from "@/lib/attendeeEmailExport";

describe("attendee email export", () => {
  it("exports only unique attendee emails", () => {
    expect(buildAttendeeEmailCsv([
      { guestEmail: "Guest@example.test", user: null },
      { guestEmail: "guest@EXAMPLE.test", user: null },
      { guestEmail: null, user: { email: "member@example.test" } },
      { guestEmail: null, user: null },
    ])).toBe("Email\nGuest@example.test\nmember@example.test");
  });

  it("escapes values that spreadsheets could interpret as formulas", () => {
    expect(buildAttendeeEmailCsv([
      { guestEmail: "=unsafe@example.test", user: null },
      { guestEmail: 'quoted"@example.test', user: null },
    ])).toBe("Email\n\t=unsafe@example.test\n\"quoted\"\"@example.test\"");
  });

  it("creates a safe, date-stamped filename", () => {
    expect(attendeeEmailExportFilename("Yuyu / launch!", new Date("2030-04-05T12:00:00.000Z")))
      .toBe("attendee_emails_Yuyu_launch_2030-04-05.csv");
  });
});
