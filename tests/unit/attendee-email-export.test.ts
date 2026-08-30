import { describe, expect, it } from "vitest";
import {
  attendeeEmailExportFilename,
  buildAttendeeEmailCsv,
} from "@/lib/attendeeEmailExport";

describe("attendee email export", () => {
  it("exports names and only unique attendee emails", () => {
    expect(buildAttendeeEmailCsv([
      { guestEmail: "Guest@example.test", guestName: "Guest attendee", user: null },
      { guestEmail: "guest@EXAMPLE.test", guestName: "Duplicate guest", user: null },
      { guestEmail: null, user: { name: "Member attendee", email: "member@example.test" } },
      { guestEmail: null, user: null },
    ])).toBe("Name,Email\nGuest attendee,Guest@example.test\nMember attendee,member@example.test");
  });

  it("escapes values that spreadsheets could interpret as formulas", () => {
    expect(buildAttendeeEmailCsv([
      { guestEmail: "=unsafe@example.test", guestName: "=unsafe name", user: null },
      { guestEmail: "  +hidden@example.test", guestName: "\t@hidden formula", user: null },
      { guestEmail: 'quoted"@example.test', guestName: 'quoted" name', user: null },
    ])).toBe("Name,Email\n'=unsafe name,'=unsafe@example.test\n'@hidden formula,'+hidden@example.test\n\"quoted\"\" name\",\"quoted\"\"@example.test\"");
  });

  it("creates a safe, date-stamped filename", () => {
    expect(attendeeEmailExportFilename("Yuyu / launch!", new Date("2030-04-05T12:00:00.000Z")))
      .toBe("attendee_emails_Yuyu_launch_2030-04-05.csv");
  });
});
