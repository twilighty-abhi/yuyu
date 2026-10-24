import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  generateTeamManageToken,
  generateTeamToken,
  hashTeamManageToken,
  isTeamTokenShape,
  teamJoinPath,
  teamManagePath,
} from "@/lib/teamToken";

describe("team tokens", () => {
  it("generates 256-bit base64url tokens that pass the shape check", () => {
    const token = generateTeamToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(isTeamTokenShape(token)).toBe(true);
    expect(generateTeamToken()).not.toBe(token);
  });

  it("stores only a SHA-256 hex digest of the management token", () => {
    const { raw, hash } = generateTeamManageToken();
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(raw);
    expect(hash).toBe(crypto.createHash("sha256").update(raw).digest("hex"));
    expect(hashTeamManageToken(raw)).toBe(hash);
    expect(hashTeamManageToken(`${raw}x`)).not.toBe(hash);
  });

  it("rejects malformed tokens before any lookup", () => {
    expect(isTeamTokenShape("short")).toBe(false);
    expect(isTeamTokenShape("a".repeat(129))).toBe(false);
    expect(isTeamTokenShape(`${"a".repeat(40)}%2F`)).toBe(false);
    expect(isTeamTokenShape(undefined)).toBe(false);
  });

  it("builds site-relative team links", () => {
    expect(teamJoinPath("org", "jam", "tok")).toBe("/org/jam/team/tok");
    expect(teamManagePath("tok")).toBe("/team/tok");
  });
});
