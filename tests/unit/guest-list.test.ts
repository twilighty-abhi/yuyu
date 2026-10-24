import { describe, expect, it } from "vitest";
import { formatDate } from "@/lib/format/datetime";
import {
  countGuestFilters,
  describeCheckIn,
  describeGuestWhen,
  filterGuests,
  guestDisplayName,
  pageRange,
  type GuestLike,
} from "@/components/event-dashboard/guests/guestList";

const NOW = "2026-10-14T12:00:00.000Z";

const guest = (overrides: Partial<GuestLike>): GuestLike => ({
  status: "CONFIRMED",
  createdAt: "2026-10-14T10:00:00.000Z",
  checkedInAt: null,
  guestEmail: "guest@example.org",
  guestName: "Asha Shetty",
  user: null,
  ...overrides,
});

const guests: GuestLike[] = [
  guest({ guestName: "Asha Shetty", guestEmail: "asha@example.org" }),
  guest({ guestName: "Ravi Kumar", guestEmail: "ravi@example.org", checkedInAt: "2026-10-14T11:00:00.000Z" }),
  guest({ status: "WAITLISTED", guestName: "Divya V.", guestEmail: "divya@example.org" }),
  guest({ status: "PENDING_APPROVAL", guestName: null, guestEmail: null, user: { name: "Kiran Reddy", email: "kiran@example.org" } }),
  guest({ status: "REJECTED", guestName: "Jo Thomas", guestEmail: "jo@example.org" }),
];

describe("guest list helpers", () => {
  it("counts every status filter", () => {
    expect(countGuestFilters(guests)).toEqual({ all: 5, going: 2, waitlist: 1, approve: 1, declined: 1, checkedIn: 1, notCheckedIn: 1 });
    expect(filterGuests(guests, { status: "notCheckedIn" }).map((row) => row.guestName)).toEqual(["Asha Shetty"]);
    expect(countGuestFilters([])).toEqual({ all: 0, going: 0, waitlist: 0, approve: 0, declined: 0, checkedIn: 0, notCheckedIn: 0 });
  });

  it("filters by status, account kind and name or email search", () => {
    expect(filterGuests(guests, { status: "going" })).toHaveLength(2);
    expect(filterGuests(guests, { status: "checkedIn" }).map(guestDisplayName)).toEqual(["Ravi Kumar"]);
    expect(filterGuests(guests, { kind: "users" }).map(guestDisplayName)).toEqual(["Kiran Reddy"]);
    expect(filterGuests(guests, { kind: "guests" })).toHaveLength(4);
    expect(filterGuests(guests, { query: "  KIRAN@ " }).map(guestDisplayName)).toEqual(["Kiran Reddy"]);
    expect(filterGuests(guests, { query: "divya", status: "going" })).toHaveLength(0);
  });

  it("falls back from name to email local part to a placeholder", () => {
    expect(guestDisplayName(guest({ guestName: "  ", guestEmail: "sam@example.org" }))).toBe("sam");
    expect(guestDisplayName(guest({ guestName: null, guestEmail: null }))).toBe("Guest");
    expect(guestDisplayName(guest({ user: { name: null, email: "lee@example.org" } }))).toBe("lee");
  });

  it("describes when someone registered, by status", () => {
    expect(describeGuestWhen({ status: "PENDING_APPROVAL", createdAt: "2026-10-14T10:00:00.000Z" }, "UTC", NOW)).toBe("asked 2 hours ago");
    expect(describeGuestWhen({ status: "CONFIRMED", createdAt: "2026-10-13T10:00:00.000Z" }, "UTC", NOW)).toBe("registered yesterday");
    expect(describeGuestWhen({ status: "WAITLISTED", createdAt: "2026-10-12T10:00:00.000Z" }, "UTC", NOW)).toBe("joined waitlist 2 days ago");
    expect(describeGuestWhen({ status: "CONFIRMED", createdAt: "2026-09-01T10:00:00.000Z" }, "UTC", NOW)).toBe(`registered on ${formatDate("2026-09-01T10:00:00.000Z", "UTC")}`);
  });

  it("labels check-in in the event timezone", () => {
    expect(describeCheckIn({ status: "CONFIRMED", checkedInAt: "2026-10-14T04:00:00.000Z" }, "Asia/Kolkata", NOW)).toBe("Checked in 9:30 AM");
    expect(describeCheckIn({ status: "CONFIRMED", checkedInAt: null }, "UTC", NOW)).toBe("Not yet");
    expect(describeCheckIn({ status: "WAITLISTED", checkedInAt: null }, "UTC", NOW)).toBeNull();
    expect(describeCheckIn({ status: "CONFIRMED", checkedInAt: "2026-10-13T09:00:00.000Z" }, "UTC", NOW)).toBe("Checked in Tue 13 Oct");
  });

  it("computes a clamped page range", () => {
    expect(pageRange(44, 0, 25)).toEqual({ first: 1, last: 25, page: 0, lastPage: 1 });
    expect(pageRange(44, 1, 25)).toEqual({ first: 26, last: 44, page: 1, lastPage: 1 });
    expect(pageRange(44, 9, 25)).toEqual({ first: 26, last: 44, page: 1, lastPage: 1 });
    expect(pageRange(0, 0, 25)).toEqual({ first: 0, last: 0, page: 0, lastPage: 0 });
  });
});
