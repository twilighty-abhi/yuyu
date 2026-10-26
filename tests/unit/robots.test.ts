import { describe, expect, it, vi } from "vitest";
import robots from "@/app/robots";

describe("robots.txt", () => {
  it("keeps every bearer-capability path out of crawlers, including the solo submission and attendance confirmation links", () => {
    const rules = robots().rules;
    const disallow = (Array.isArray(rules) ? rules[0] : rules)?.disallow;
    expect(disallow).toEqual(expect.arrayContaining(["/ticket/", "/team/", "/*/*/team/", "/submit/", "/attend/", "/join/"]));
  });

  it("points crawlers at an absolute sitemap URL on the public base address", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://events.example.test/");
    try {
      expect(robots().sitemap).toBe("https://events.example.test/sitemap.xml");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
