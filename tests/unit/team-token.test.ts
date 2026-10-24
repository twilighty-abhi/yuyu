import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  generateTeamManageToken,
  generateTeamToken,
  hashTeamManageToken,
  isTeamTokenShape,
  joinTokenFromInput,
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

describe("join links pasted on the ticket page", () => {
  const token = "A".repeat(20) + "b_c-" + "9".repeat(19);

  it("accepts a bare token or a join link, absolute, relative or without its scheme", () => {
    expect(joinTokenFromInput(token)).toBe(token);
    expect(joinTokenFromInput(`  ${token}\n`)).toBe(token);
    expect(joinTokenFromInput(`https://yuyu.example/acme/hack-night/team/${token}`)).toBe(token);
    expect(joinTokenFromInput(`https://yuyu.example/acme/hack-night/team/${token}?utm=x#top`)).toBe(token);
    expect(joinTokenFromInput(`/acme/hack-night/team/${token}`)).toBe(token);
    expect(joinTokenFromInput(`yuyu.example/acme/hack-night/team/${token}`)).toBe(token);
    expect(joinTokenFromInput(teamJoinPath("acme", "hack-night", token))).toBe(token);
  });

  it("refuses management links, ticket links and anything else", () => {
    expect(joinTokenFromInput(teamManagePath(token))).toBeNull();
    expect(joinTokenFromInput(`https://yuyu.example/team/${token}`)).toBeNull();
    expect(joinTokenFromInput(`https://yuyu.example/ticket/${token}`)).toBeNull();
    expect(joinTokenFromInput(`https://yuyu.example/acme/hack-night/teams/${token}`)).toBeNull();
    expect(joinTokenFromInput("https://yuyu.example/acme/hack-night/team/short")).toBeNull();
    expect(joinTokenFromInput(`https://yuyu.example/acme/hack-night/team/${token}%3Cx%3E`)).toBeNull();
    expect(joinTokenFromInput("")).toBeNull();
    expect(joinTokenFromInput(42)).toBeNull();
    expect(joinTokenFromInput("x".repeat(3000))).toBeNull();
  });
});
