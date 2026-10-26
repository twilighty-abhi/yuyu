import { describe, expect, it } from "vitest";
import robots from "@/app/robots";

describe("robots.txt", () => {
  it("keeps every bearer-capability path out of crawlers, including the solo submission and attendance confirmation links", () => {
    const rules = robots().rules;
    const disallow = (Array.isArray(rules) ? rules[0] : rules)?.disallow;
    expect(disallow).toEqual(expect.arrayContaining(["/ticket/", "/team/", "/*/*/team/", "/submit/", "/attend/", "/join/"]));
  });
});
