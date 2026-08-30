import crypto from "crypto";

/** Match one exact RFC 6750-style bearer value in constant time. */
export function bearerSecretMatches(authorization: string | null, configuredSecret: string | undefined) {
  if (!configuredSecret) return false;
  const match = authorization?.match(/^Bearer[ \t]+([^ \t]+)$/i);
  if (!match) return false;
  const supplied = Buffer.from(match[1], "utf8");
  const expected = Buffer.from(configuredSecret, "utf8");
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}
