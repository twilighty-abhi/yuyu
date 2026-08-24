import { beforeEach, describe, expect, it } from "vitest";
import { createSuperAdminMfaProof, hasValidSuperAdminMfaProof, SUPER_ADMIN_MFA_MAX_AGE_SECONDS } from "@/lib/superAdminMfa";

describe("super-admin MFA proof", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "unit-test-auth-secret-with-at-least-32-characters";
  });

  it("accepts a proof only for the verified user and session version", () => {
    const now = 1_000_000;
    const proof = createSuperAdminMfaProof("user_1", 3, now);
    expect(hasValidSuperAdminMfaProof(proof, "user_1", 3, now + 1)).toBe(true);
    expect(hasValidSuperAdminMfaProof(proof, "user_2", 3, now + 1)).toBe(false);
    expect(hasValidSuperAdminMfaProof(proof, "user_1", 4, now + 1)).toBe(false);
  });

  it("rejects tampered and expired proofs", () => {
    const now = 1_000_000;
    const proof = createSuperAdminMfaProof("user_1", 3, now);
    expect(hasValidSuperAdminMfaProof(`${proof}x`, "user_1", 3, now + 1)).toBe(false);
    expect(hasValidSuperAdminMfaProof(proof, "user_1", 3, now + SUPER_ADMIN_MFA_MAX_AGE_SECONDS * 1000)).toBe(false);
  });
});
