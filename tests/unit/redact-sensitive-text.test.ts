import { describe, expect, it } from "vitest";
import { redactSensitiveText } from "@/lib/redactSensitiveText";

describe("redactSensitiveText", () => {
  it("removes email addresses and URLs from operator-facing text", () => {
    const result = redactSensitiveText("SMTP rejected person@example.com; retry https://example.test/reset?token=secret");

    expect(result).not.toContain("person@example.com");
    expect(result).not.toContain("token=secret");
    expect(result).toContain("[redacted email]");
    expect(result).toContain("[redacted URL]");
  });
});
