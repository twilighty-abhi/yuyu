/** Remove values that must not be surfaced in operational or audit UIs. */
export function redactSensitiveText(value: string) {
  return value
    .replace(/https?:\/\/[^\s"']+/gi, "[redacted URL]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]");
}
