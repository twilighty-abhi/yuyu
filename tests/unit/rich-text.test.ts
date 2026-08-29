import { describe, expect, it } from "vitest";
import { sanitizeRichText } from "@/lib/richText";

describe("event website rich text", () => {
  it("keeps constrained formatting and removes active markup", () => {
    const result = sanitizeRichText('<h2>Welcome</h2><script>alert(1)</script><a href="javascript:alert(1)">bad</a><strong>safe</strong>');
    expect(result).toContain("<h2>Welcome</h2>");
    expect(result).toContain("<strong>safe</strong>");
    expect(result).not.toContain("script");
    expect(result).not.toContain("javascript:");
  });
});
