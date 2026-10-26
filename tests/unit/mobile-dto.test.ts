import { describe, expect, it } from "vitest";
import { absoluteUrl, toGuest, toRegistrationField, toUserDto } from "@/lib/mobile/dto";
import { eventPermissionsFor, canSeeGuests } from "@/lib/mobile/permissions";
import { guestSchema, rosterDtoSchema, sessionDtoSchema, userDtoSchema, registrationDtoSchema } from "@/lib/mobile/schemas";
import { toCheckInResult } from "@/lib/mobile/checkIn";

const base = "https://yuyu.example";

describe("mobile DTOs", () => {
  it("maps a user without credential or MFA material", () => {
    const record = {
      id: "u1", name: "Ada", email: "ada@example.test", image: null, profileImageUrl: "/api/uploads/users/u1/profile-images/a.webp",
      emailVerified: new Date(), mfaEnabledAt: null,
      passwordHash: "$2b$12$secret", mfaSecretEncrypted: "v1.secret", recoveryCodeHashes: ["x"], sessionVersion: 4,
    };
    const dto = toUserDto(record, base);
    expect(dto).toEqual({ id: "u1", name: "Ada", email: "ada@example.test", imageUrl: `${base}/api/uploads/users/u1/profile-images/a.webp`, emailVerified: true, mfaEnabled: false });
    const serialized = JSON.stringify(dto);
    for (const forbidden of ["passwordHash", "$2b$", "mfaSecret", "recoveryCode", "sessionVersion"]) expect(serialized).not.toContain(forbidden);
  });

  it("rejects unexpected fields in strict response schemas", () => {
    const user = { id: "u1", name: null, email: null, imageUrl: null, emailVerified: false, mfaEnabled: false };
    expect(userDtoSchema.safeParse({ ...user, passwordHash: "x" }).success).toBe(false);
    expect(userDtoSchema.safeParse({ ...user, mfaSecretEncrypted: "x" }).success).toBe(false);
    expect(sessionDtoSchema.safeParse({ accessToken: "a", accessTokenExpiresAt: new Date().toISOString(), refreshToken: "r", refreshTokenExpiresAt: new Date().toISOString(), user, sessionVersion: 1 }).success).toBe(false);
    const guest = { rsvpId: "r1", displayName: "G", email: null, status: "CONFIRMED", checkedInAt: null, registeredAt: new Date().toISOString(), isGuest: true };
    // A guest-list row never carries a ticket token; only the CHECK_IN roster does.
    expect(guestSchema.safeParse({ ...guest, ticketToken: "secret" }).success).toBe(false);
    expect(guestSchema.safeParse({ ...guest, checkInToken: "secret" }).success).toBe(false);
    expect(rosterDtoSchema.safeParse({ generatedAt: new Date().toISOString(), rows: [{ ...guest, ticketToken: "t", checkInDetails: [], registrationDetails: [] }] }).success).toBe(true);
    expect(registrationDtoSchema.shape.ticketToken.safeParse(null).success).toBe(true);
  });

  it("never returns the web print QR token from check-in results", () => {
    const result = toCheckInResult({
      rsvpId: "r1", displayName: "G", email: null, status: "CONFIRMED", alreadyCheckedIn: false, checkedInAt: null,
      checkInQrToken: "bearer-ticket-token", checkInDetails: [], registrationDetails: [{ key: "diet", label: "Diet", value: "Vegan" }],
    });
    expect(JSON.stringify(result)).not.toContain("bearer-ticket-token");
    expect(result.registrationDetails).toEqual([{ label: "Diet", value: "Vegan" }]);
  });

  it("resolves only http(s) and site-relative image URLs", () => {
    expect(absoluteUrl("/api/uploads/x.webp", base)).toBe(`${base}/api/uploads/x.webp`);
    expect(absoluteUrl("https://cdn.example/x.webp", base)).toBe("https://cdn.example/x.webp");
    expect(absoluteUrl("javascript:alert(1)", base)).toBeNull();
    expect(absoluteUrl("//evil.example/x", base)).toBeNull();
    expect(absoluteUrl("", base)).toBeNull();
  });

  it("maps guests and registration fields explicitly", () => {
    const guest = toGuest({ id: "r1", status: "WAITLISTED", checkedInAt: null, createdAt: new Date("2030-01-01T00:00:00Z"), userId: null, guestName: " Bo ", guestEmail: "bo@example.test", user: null });
    expect(guest).toEqual({ rsvpId: "r1", displayName: "Bo", email: "bo@example.test", status: "WAITLISTED", checkedInAt: null, registeredAt: "2030-01-01T00:00:00.000Z", isGuest: true });
    const field = toRegistrationField({ id: "f1", key: "diet", label: "Diet", type: "SELECT", required: false, options: ["A", 3, "B"], helpText: "", placeholder: null, settings: { allowOther: true, maxLength: 9, showIf: { fieldKey: "attending", values: ["Yes"] } } });
    expect(field).toEqual({ id: "f1", key: "diet", label: "Diet", type: "SELECT", required: false, helpText: null, placeholder: null, options: ["A", "B"], settings: { allowOther: true }, showIf: { fieldKey: "attending", values: ["Yes"] } });
  });

  it("derives permissions like the event dashboard", () => {
    const checkInOnly = eventPermissionsFor(false, ["CHECK_IN"]);
    expect(checkInOnly).toEqual({ checkIn: true, manageRegistrations: false, sendEmails: false, schedule: false, manageFeedback: false, manageRegistrationWindow: false, judge: false });
    expect(canSeeGuests(checkInOnly)).toBe(true);
    expect(canSeeGuests(eventPermissionsFor(false, ["EDIT_DETAILS"]))).toBe(false);
    expect(eventPermissionsFor(true, [])).toEqual({ checkIn: true, manageRegistrations: true, sendEmails: true, schedule: true, manageFeedback: true, manageRegistrationWindow: true, judge: false });
    // Judging: OWNER/ADMIN or the JUDGE grant, only once the event takes submissions.
    expect(eventPermissionsFor(true, [], { submissionsEnabled: true }).judge).toBe(true);
    expect(eventPermissionsFor(false, ["JUDGE"], { submissionsEnabled: true }).judge).toBe(true);
    expect(eventPermissionsFor(false, ["JUDGE"]).judge).toBe(false);
    expect(eventPermissionsFor(false, ["CHECK_IN", "MANAGE_REGISTRATIONS"], { submissionsEnabled: true }).judge).toBe(false);
    // JUDGE never satisfies any other flag.
    expect(eventPermissionsFor(false, ["JUDGE"], { submissionsEnabled: true })).toEqual({ checkIn: false, manageRegistrations: false, sendEmails: false, schedule: false, manageFeedback: false, manageRegistrationWindow: false, judge: true });
  });
});
