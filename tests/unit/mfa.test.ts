import * as OTPAuth from "otpauth";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.AUTH_SECRET = "unit-test-auth-secret-with-at-least-32-characters";
  process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe("MFA security primitives", () => {
  it("encrypts authenticator seeds with authenticated encryption", async () => {
    const { decryptMfaSecret, encryptMfaSecret } = await import("@/lib/mfa");
    const encrypted = encryptMfaSecret("JBSWY3DPEHPK3PXP");
    expect(encrypted).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptMfaSecret(encrypted)).toBe("JBSWY3DPEHPK3PXP");
    const parts = encrypted.split(".");
    parts[3] = `${parts[3]![0] === "A" ? "B" : "A"}${parts[3]!.slice(1)}`;
    expect(() => decryptMfaSecret(parts.join("."))).toThrow();
  });

  it("validates current TOTP codes and hashes normalized recovery codes", async () => {
    const { createMfaEnrollment, hashRecoveryCode, verifyMfaCode } = await import("@/lib/mfa");
    const enrollment = createMfaEnrollment("person@example.com");
    const parsed = OTPAuth.URI.parse(enrollment.uri);
    if (!(parsed instanceof OTPAuth.TOTP)) throw new Error("Expected a TOTP URI.");
    expect(verifyMfaCode(enrollment.secret, "person@example.com", parsed.generate())).toBe(true);
    expect(hashRecoveryCode("ABCD-EF12-3456")).toBe(hashRecoveryCode("abcdef123456"));
  });
});
