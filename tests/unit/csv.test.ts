import { describe, expect, it } from "vitest";
import { buildCsv, escapeCsvCell } from "@/lib/csv";

describe("CSV encoding", () => {
  it("quotes delimiters and neutralizes whitespace-prefixed formula payloads", () => {
    expect(escapeCsvCell("ordinary")).toBe("ordinary");
    expect(escapeCsvCell("line,break")).toBe('"line,break"');
    expect(escapeCsvCell("\r=cmd|' /C calc'!A0")).toBe('"\'\r=cmd|\' /C calc\'!A0"');
    expect(escapeCsvCell("\uFEFF=HYPERLINK(\"https://evil.test\")")).toBe('"\'\uFEFF=HYPERLINK(""https://evil.test"")"');
    expect(buildCsv([["Name"], ["  @SUM(1,2)"]])).toBe("Name\n\"'  @SUM(1,2)\"");
  });
});
