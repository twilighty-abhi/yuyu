import { describe, expect, it } from "vitest";
import {
  SECTION_TYPES,
  countPageChanges,
  fieldTypeLabel,
  htmlExcerpt,
  normalizeSections,
  parseAccentInput,
  programmeCounts,
  programmeSummary,
  registerLabelFor,
  sectionNote,
  unsavedLabel,
  type SectionNoteData,
} from "@/components/event-dashboard/event-page/summary";

const published = { visibility: "PUBLISHED" };
const draft = { visibility: "DRAFT" };
const emptyData: SectionNoteData = { highlights: [], speakers: [], sponsors: [], resources: [], faqs: [], sessionCount: 0, location: "", isOnline: false };

describe("programme summary", () => {
  it("counts sessions, distinct tracks and speakers", () => {
    const counts = programmeCounts([{ trackId: "a" }, { trackId: "a" }, { trackId: "b" }, { trackId: "a" }], 2);
    expect(counts).toEqual({ sessionCount: 4, trackCount: 2, speakerCount: 2 });
    expect(programmeSummary(counts)).toBe("4 sessions on 2 tracks · 2 speakers");
    expect(programmeSummary({ sessionCount: 1, trackCount: 1, speakerCount: 1 })).toBe("1 session on 1 track · 1 speaker");
    expect(programmeSummary({ sessionCount: 0, trackCount: 0, speakerCount: 0 })).toBe("No sessions yet · 0 speakers");
  });
});

describe("section notes", () => {
  it("describes content from real data", () => {
    expect(sectionNote("SPEAKERS", { ...emptyData, speakers: [published, published] })).toBe("2 people");
    expect(sectionNote("SPEAKERS", { ...emptyData, speakers: [published] })).toBe("1 person");
    expect(sectionNote("FAQ", { ...emptyData, faqs: [published, published, draft] })).toBe("3 questions · 1 not published");
    expect(sectionNote("HIGHLIGHTS", emptyData)).toBe("Empty");
    expect(sectionNote("SCHEDULE", { ...emptyData, sessionCount: 4 })).toBe("4 sessions");
    expect(sectionNote("SCHEDULE", emptyData)).toBe("Empty");
    expect(sectionNote("VENUE", { ...emptyData, location: "Makerspace Hall" })).toBe("Makerspace Hall");
    expect(sectionNote("VENUE", { ...emptyData, location: "https://meet.example", isOnline: true })).toBe("Online event · not shown");
    expect(sectionNote("HERO", emptyData)).toBe("Cover, title and register button");
  });
});

describe("normalizeSections", () => {
  it("keeps saved order, drops unknown/duplicate types and appends missing ones", () => {
    const result = normalizeSections([
      { type: "FAQ", isVisible: false, sortOrder: 0 },
      { type: "HERO", isVisible: true, sortOrder: 1 },
      { type: "FAQ", isVisible: true, sortOrder: 2 },
      { type: "BOGUS", isVisible: true, sortOrder: 3 },
    ]);
    expect(result).toHaveLength(SECTION_TYPES.length);
    expect(result.slice(0, 2)).toEqual([
      { type: "FAQ", isVisible: false, sortOrder: 0 },
      { type: "HERO", isVisible: true, sortOrder: 1 },
    ]);
    expect(result.map((section) => section.sortOrder)).toEqual(SECTION_TYPES.map((_, index) => index));
    expect(normalizeSections(null).map((section) => section.type)).toEqual([...SECTION_TYPES]);
  });
});

describe("accent input", () => {
  it("accepts empty, short and long hex and rejects anything else", () => {
    expect(parseAccentInput("")).toEqual({ valid: true, value: "" });
    expect(parseAccentInput(" #abc ")).toEqual({ valid: true, value: "#AABBCC" });
    expect(parseAccentInput("#0f766e")).toEqual({ valid: true, value: "#0F766E" });
    expect(parseAccentInput("red")).toEqual({ valid: false, value: "" });
    expect(parseAccentInput("#12345g")).toEqual({ valid: false, value: "" });
    expect(parseAccentInput("url(x)")).toEqual({ valid: false, value: "" });
  });
});

describe("countPageChanges", () => {
  const sections = normalizeSections(null);
  const saved = { accentColor: "#C2410C", sections };

  it("is zero for identical (or equivalently written) settings", () => {
    expect(countPageChanges(saved, { accentColor: "#c2410c", sections: [...sections] })).toBe(0);
  });

  it("counts the accent, each visibility toggle and the order once", () => {
    const toggled = sections.map((section) => (section.type === "FAQ" || section.type === "VENUE" ? { ...section, isVisible: false } : section));
    expect(countPageChanges(saved, { accentColor: "#4B3FA8", sections: toggled })).toBe(3);
    const reordered = [sections[1]!, sections[0]!, ...sections.slice(2)].map((section, sortOrder) => ({ ...section, sortOrder }));
    expect(countPageChanges(saved, { accentColor: saved.accentColor, sections: reordered })).toBe(1);
    expect(countPageChanges(saved, { accentColor: "not-a-colour", sections })).toBe(1);
  });

  it("labels the count", () => {
    expect(unsavedLabel(1)).toBe("1 unsaved change");
    expect(unsavedLabel(2)).toBe("2 unsaved changes");
    expect(unsavedLabel(0)).toBe("Unsaved changes");
  });
});

describe("labels and excerpts", () => {
  it("matches the register button to the audience", () => {
    expect(registerLabelFor("PUBLIC")).toBe("Register — it's free");
    expect(registerLabelFor("HIDDEN_LINK")).toBe("Register — it's free");
    expect(registerLabelFor("APPROVAL_REQUIRED")).toBe("Request to join");
    expect(registerLabelFor("INVITE_ONLY")).toBe("Register with your invite");
    expect(registerLabelFor("PUBLIC", { soloPolicy: "TEAMS_ONLY" })).toBe("Register your team");
    expect(registerLabelFor("PUBLIC", { soloPolicy: "SOLO_ALLOWED" })).toBe("Register a team or yourself");
    expect(registerLabelFor("APPROVAL_REQUIRED", { soloPolicy: "TEAMS_ONLY" })).toBe("Request a place for your team");
  });

  it("names field types", () => {
    expect(fieldTypeLabel("MULTI_SELECT")).toBe("Multiple choice");
    expect(fieldTypeLabel("UNKNOWN")).toBe("unknown");
  });

  it("turns rich text into a short plain-text excerpt", () => {
    expect(htmlExcerpt("<p>Hello &amp; <strong>welcome</strong></p><script>alert(1)</script>")).toBe("Hello & welcome");
    expect(htmlExcerpt(`<p>${"a".repeat(200)}</p>`, 20)).toBe(`${"a".repeat(19)}…`);
    expect(htmlExcerpt("")).toBe("");
  });
});
