import { describe, expect, it } from "vitest";
import { peopleCount, teamCapacityLabel, teamUnitNoun, teamUnitShortNoun } from "@/lib/teamCapacityDisplay";

describe("team capacity wording", () => {
  it("names units by solo policy", () => {
    expect(teamUnitNoun("SOLO_ALLOWED", 3)).toBe("teams & solo places");
    expect(teamUnitNoun("SOLO_ALLOWED", 1)).toBe("team or solo place");
    expect(teamUnitNoun("TEAMS_ONLY", 3)).toBe("teams");
    expect(teamUnitNoun("TEAMS_ONLY", 1)).toBe("team");
    expect(teamUnitShortNoun("SOLO_ALLOWED")).toBe("places");
    expect(teamUnitShortNoun("TEAMS_ONLY")).toBe("teams");
  });

  it("shows units against capacity, never people", () => {
    expect(teamCapacityLabel(3, 3, "SOLO_ALLOWED")).toBe("3 / 3 teams & solo places");
    expect(teamCapacityLabel(2, 5, "TEAMS_ONLY")).toBe("2 / 5 teams");
    expect(teamCapacityLabel(2, null, "TEAMS_ONLY")).toBe("2 teams");
  });

  it("counts people separately", () => {
    expect(peopleCount(1)).toBe("1 person");
    expect(peopleCount(6)).toBe("6 people");
    expect(peopleCount(0)).toBe("0 people");
  });
});
