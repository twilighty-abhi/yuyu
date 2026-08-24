import crypto from "crypto";

export function gravatarUrl(email: string, size = 160) {
  const normalizedEmail = email.trim().toLowerCase();
  const hash = crypto.createHash("md5").update(normalizedEmail).digest("hex");
  return `https://www.gravatar.com/avatar/${hash}?d=404&s=${size}`;
}
