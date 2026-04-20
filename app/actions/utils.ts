import type { ZodError } from "zod";

export function flattenZodErrors(error: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const iss of error.issues) {
    const path = iss.path.join(".") || "_root";
    out[path] = out[path] ?? [];
    out[path].push(iss.message);
  }
  return out;
}
