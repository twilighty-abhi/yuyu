import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

describe("capability link referrer policy", () => {
  it("sends no-referrer on invitation, password-reset and email-verification pages", async () => {
    const rules = await nextConfig.headers!();
    const noReferrer = (source: string) =>
      rules.some((rule) => rule.source === source && rule.headers.some((h) => h.key === "Referrer-Policy" && h.value === "no-referrer"));
    for (const source of ["/join/:kind/:token", "/reset-password", "/verify-email", "/ticket/:token", "/team/:token", "/submit/:token"]) {
      expect(noReferrer(source), source).toBe(true);
    }
  });
});
