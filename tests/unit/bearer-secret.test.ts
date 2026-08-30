import { describe, expect, it } from "vitest";
import { bearerSecretMatches } from "@/lib/bearerSecret";

describe("protected-route bearer matching", () => {
  const secret = "s".repeat(32);

  it("requires one exact bearer credential", () => {
    expect(bearerSecretMatches(`Bearer ${secret}`, secret)).toBe(true);
    expect(bearerSecretMatches(`bearer\t${secret}`, secret)).toBe(true);
    expect(bearerSecretMatches(secret, secret)).toBe(false);
    expect(bearerSecretMatches(`Basic ${secret}`, secret)).toBe(false);
    expect(bearerSecretMatches(`Bearer ${secret} extra`, secret)).toBe(false);
    expect(bearerSecretMatches("Bearer short", secret)).toBe(false);
    expect(bearerSecretMatches(null, secret)).toBe(false);
    expect(bearerSecretMatches(`Bearer ${secret}`, undefined)).toBe(false);
  });
});
