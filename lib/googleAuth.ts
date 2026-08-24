/** Google supplies this OIDC claim only after it has verified the email. */
export function hasVerifiedGoogleEmail(profile: unknown) {
  return (
    typeof profile === "object" &&
    profile !== null &&
    (profile as { email_verified?: unknown }).email_verified === true
  );
}
