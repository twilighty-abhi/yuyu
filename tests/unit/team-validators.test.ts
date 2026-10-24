import { describe, expect, it } from "vitest";
import { RegistrationMode, SoloPolicy } from "@prisma/client";
import {
  addTeamMemberSchema,
  createEventSchema,
  createSeriesSchema,
  normalizedTeamSettings,
  organiserTeamActionSchema,
  seekerProfileFieldsSchema,
  teamNameKey,
  teamNameSchema,
  teamRegistrationIntentSchema,
  updateEventSchema,
  updateSeriesMetaSchema,
  upsertSeekerProfileSchema,
} from "@/lib/validators";

const at = (hours: number) => new Date(Date.now() + (hours + 24) * 3_600_000).toISOString();

const baseEvent = {
  organisationSlug: "demo",
  title: "Game jam",
  aboutHtml: "<p>Make a game.</p>",
  startDateTime: at(0),
  endDateTime: at(48),
  timezone: "UTC",
  isOnline: false,
  location: "Main hall",
};

const baseUpdate = {
  ...baseEvent,
  eventId: "event_1",
  status: "DRAFT",
  privacyType: "PUBLIC",
};

describe("event team settings", () => {
  it("defaults to individual registration and leaves team settings unset", () => {
    const parsed = createEventSchema.parse(baseEvent);
    expect(parsed.registrationMode).toBeUndefined();
    expect(normalizedTeamSettings(parsed)).toBeNull();
  });

  it("accepts a TEAM event with valid sizes from form strings", () => {
    const parsed = createEventSchema.parse({
      ...baseEvent,
      registrationMode: "TEAM",
      teamMinSize: "2",
      teamMaxSize: "5",
      soloPolicy: "SOLO_WITH_MATCHING",
    });
    expect(normalizedTeamSettings(parsed)).toEqual({
      registrationMode: RegistrationMode.TEAM,
      teamMinSize: 2,
      teamMaxSize: 5,
      soloPolicy: SoloPolicy.SOLO_WITH_MATCHING,
    });
  });

  it("requires a maximum size of at least 2 in TEAM mode and keeps min <= max", () => {
    expect(createEventSchema.safeParse({ ...baseEvent, registrationMode: "TEAM" }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...baseEvent, registrationMode: "TEAM", teamMaxSize: 1 }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...baseEvent, registrationMode: "TEAM", teamMinSize: 0, teamMaxSize: 4 }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...baseEvent, registrationMode: "TEAM", teamMinSize: 5, teamMaxSize: 4 }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...baseEvent, registrationMode: "TEAM", teamMaxSize: 2.5 }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...baseEvent, registrationMode: "TEAM", teamMaxSize: 1000 }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...baseEvent, registrationMode: "TEAM", teamMaxSize: 2 }).success).toBe(true);
  });

  it("stores no sizes for INDIVIDUAL events", () => {
    const parsed = updateEventSchema.parse({ ...baseUpdate, registrationMode: "INDIVIDUAL", teamMaxSize: "4" });
    expect(normalizedTeamSettings(parsed)).toEqual({
      registrationMode: RegistrationMode.INDIVIDUAL,
      teamMinSize: null,
      teamMaxSize: null,
      soloPolicy: SoloPolicy.SOLO_ALLOWED,
    });
  });

  it("leaves team settings untouched when an update omits the mode", () => {
    const parsed = updateEventSchema.parse(baseUpdate);
    expect(normalizedTeamSettings(parsed)).toBeNull();
    expect(updateEventSchema.safeParse({ ...baseUpdate, registrationMode: "TEAM" }).success).toBe(false);
  });

  it("refuses team settings on recurring series instead of ignoring them", () => {
    const series = {
      organisationSlug: "demo",
      title: "Weekly",
      anchorStartDateTime: at(0),
      anchorEndDateTime: at(1),
      rruleLine: "FREQ=WEEKLY",
      timezone: "UTC",
    };
    expect(createSeriesSchema.safeParse(series).success).toBe(true);
    expect(createSeriesSchema.safeParse({ ...series, registrationMode: "" }).success).toBe(true);
    expect(createSeriesSchema.safeParse({ ...series, registrationMode: "INDIVIDUAL" }).success).toBe(true);
    expect(createSeriesSchema.safeParse({ ...series, registrationMode: "TEAM", teamMaxSize: 4 }).success).toBe(false);
    expect(createSeriesSchema.safeParse({ ...series, teamMaxSize: 4 }).success).toBe(false);
    expect(createSeriesSchema.safeParse({ ...series, soloPolicy: "TEAMS_ONLY" }).success).toBe(false);
    const meta = { organisationSlug: "demo", eventSeriesId: "s1", title: "Weekly", timezone: "UTC", status: "DRAFT", privacyType: "PUBLIC" };
    expect(updateSeriesMetaSchema.safeParse(meta).success).toBe(true);
    expect(updateSeriesMetaSchema.safeParse({ ...meta, registrationMode: "TEAM" }).success).toBe(false);
    expect(updateSeriesMetaSchema.safeParse({ ...meta, teamMinSize: 2 }).success).toBe(false);
  });
});

describe("team names", () => {
  it("trims, collapses spaces, and limits length", () => {
    expect(teamNameSchema.parse("  Byte   Me  ")).toBe("Byte Me");
    expect(teamNameSchema.safeParse("").success).toBe(false);
    expect(teamNameSchema.safeParse("   ").success).toBe(false);
    expect(teamNameSchema.safeParse("x".repeat(61)).success).toBe(false);
    expect(teamNameSchema.safeParse("<script>").success).toBe(false);
    expect(teamNameSchema.safeParse("---").success).toBe(false);
    expect(teamNameSchema.parse("42")).toBe("42");
  });

  it("keys names case- and spacing-insensitively", () => {
    expect(teamNameKey("Byte  Me")).toBe(teamNameKey(" byte me "));
    expect(teamNameKey("ＢＹＴＥ")).toBe("byte");
  });
});

describe("team registration intent", () => {
  it("accepts create, join and solo intents", () => {
    expect(teamRegistrationIntentSchema.parse({ mode: "create", name: " Team A " })).toEqual({ mode: "create", name: "Team A" });
    expect(teamRegistrationIntentSchema.safeParse({ mode: "join", joinToken: "a".repeat(43) }).success).toBe(true);
    expect(teamRegistrationIntentSchema.safeParse({ mode: "solo" }).success).toBe(true);
  });

  it("rejects malformed join tokens and unknown fields", () => {
    expect(teamRegistrationIntentSchema.safeParse({ mode: "join", joinToken: "short" }).success).toBe(false);
    expect(teamRegistrationIntentSchema.safeParse({ mode: "join", joinToken: "a".repeat(40) + "/.." }).success).toBe(false);
    expect(teamRegistrationIntentSchema.safeParse({ mode: "create", name: "A", teamId: "t1" }).success).toBe(false);
    expect(teamRegistrationIntentSchema.safeParse({ mode: "leader" }).success).toBe(false);
  });
});

describe("seeker profiles", () => {
  it("limits headline and skills and removes duplicate skills", () => {
    const parsed = seekerProfileFieldsSchema.parse({ headline: " Designer ", skills: ["Figma", "figma", " Rust "] });
    expect(parsed).toEqual({ headline: "Designer", skills: ["Figma", "Rust"] });
    expect(seekerProfileFieldsSchema.safeParse({ headline: "x".repeat(121) }).success).toBe(false);
    expect(seekerProfileFieldsSchema.safeParse({ headline: "ok", skills: Array.from({ length: 9 }, (_, i) => `s${i}`) }).success).toBe(false);
    expect(seekerProfileFieldsSchema.safeParse({ headline: "ok", skills: ["x".repeat(31)] }).success).toBe(false);
    expect(seekerProfileFieldsSchema.safeParse({ headline: "ok", email: "a@b.test" }).success).toBe(false);
  });

  it("defaults the profile to visible", () => {
    expect(upsertSeekerProfileSchema.parse({ headline: "Backend" })).toEqual({ headline: "Backend", skills: [], visible: true });
    expect(upsertSeekerProfileSchema.parse({ headline: "Backend", visible: false }).visible).toBe(false);
  });
});

describe("member and organiser inputs", () => {
  it("validates added members", () => {
    expect(addTeamMemberSchema.safeParse({ name: "Ada Lovelace", email: "ada@example.test" }).success).toBe(true);
    expect(addTeamMemberSchema.safeParse({ name: "Ada", email: "nope" }).success).toBe(false);
    expect(addTeamMemberSchema.safeParse({ name: "Ada", email: "ada@example.test", teamId: "other" }).success).toBe(false);
  });

  it("requires the event scope for organiser team actions", () => {
    expect(organiserTeamActionSchema.safeParse({ organisationSlug: "demo", eventId: "e1", teamId: "t1" }).success).toBe(true);
    expect(organiserTeamActionSchema.safeParse({ organisationSlug: "demo", teamId: "t1" }).success).toBe(false);
  });
});
