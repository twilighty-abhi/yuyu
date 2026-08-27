import { z } from "zod";

const cursorSchema = z.object({
  v: z.literal(1),
  timestamp: z.string().datetime(),
  id: z.string().min(1).max(128),
}).strict();

export type ApiCursor = z.infer<typeof cursorSchema>;

export function encodeCursor(timestamp: Date, id: string) {
  return Buffer.from(JSON.stringify({ v: 1, timestamp: timestamp.toISOString(), id }))
    .toString("base64url");
}

export function decodeCursor(value: string | undefined): ApiCursor | null {
  if (!value) return null;
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch {
    return null;
  }
}
