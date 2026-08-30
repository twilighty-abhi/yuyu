/** Remove values that must not be surfaced in operational or audit UIs. */
export function redactSensitiveText(value: string) {
  return value
    .replace(/https?:\/\/[^\s"']+/gi, "[redacted URL]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]");
}

/**
 * Preserve a small amount of actionable failure metadata without persisting an
 * exception message. SMTP/database clients routinely include recipients,
 * connection strings, and message URLs in those messages.
 */
export function describeOperationalError(error: unknown) {
  if (!error || typeof error !== "object") return "Operation failed";
  const candidateName = "name" in error && typeof error.name === "string" ? error.name : "Error";
  const name = /^[A-Za-z]{1,30}Error$/.test(candidateName) ? candidateName : "Error";
  const candidateCode = "code" in error && typeof error.code === "string" ? error.code : "";
  const code = /^[A-Z0-9_-]{1,40}$/.test(candidateCode) ? candidateCode : "";
  return code ? `${name} (${code})` : name;
}
