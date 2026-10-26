import { buildCsv } from "@/lib/csv";

/*
 * Shared plumbing for the organiser CSV export routes under
 * `/api/exports/events/:eventId/*` (attendees, teams, judging). Every cell
 * still goes through `buildCsv` (lib/csv.ts), which neutralises spreadsheet
 * formulas; rows arrive in bounded batches, so a large event never sits in
 * memory at once.
 */

/** Headers on every export response, including the bare 404. */
export const EXPORT_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

/** The one answer to every denial and every malformed request: an empty, uncached 404. */
export function exportNotFound(): Response {
  return new Response(null, { status: 404, headers: EXPORT_NO_STORE_HEADERS });
}

/** `<prefix>_<Event_Title>_<YYYY-MM-DD>.csv`, ASCII only. */
export function exportFilename(prefix: string, eventTitle: string, date = new Date()): string {
  const safeTitle =
    eventTitle
      .replace(/[^a-zA-Z0-9 _-]/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 50) || "event";
  return `${prefix}_${safeTitle}_${date.toISOString().slice(0, 10)}.csv`;
}

/**
 * The names of the filters an export was narrowed by, for audit metadata
 * (`"status,search"`, or `"none"`). Names only: never the search text, which
 * can contain a person's name or email.
 */
export function exportFilterNames(active: Record<string, boolean>): string {
  const names = Object.entries(active)
    .filter(([, on]) => on)
    .map(([name]) => name);
  return names.length ? names.join(",") : "none";
}

/**
 * The CSV body as a pull-based byte stream: a UTF-8 BOM and the header row,
 * then one batch of rows each time the reader asks for more. The next batch
 * is read from the database only when the previous one has been consumed, so
 * a slow download holds about one batch in memory, never the whole file. A
 * failure part-way through errors the stream (the download fails) instead of
 * sending a silently short file; a cancelled download stops the reads.
 */
export function csvByteStream(params: {
  header: ReadonlyArray<string>;
  batches: () => AsyncIterable<ReadonlyArray<ReadonlyArray<string>>>;
  errorMessage: string;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let iterator: AsyncIterator<ReadonlyArray<ReadonlyArray<string>>> | null = null;
  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        controller.enqueue(encoder.encode(`﻿${buildCsv([params.header])}\n`));
      },
      async pull(controller) {
        try {
          iterator ??= params.batches()[Symbol.asyncIterator]();
          // Skip empty batches so every pull enqueues a chunk or closes.
          for (;;) {
            const next = await iterator.next();
            if (next.done) {
              controller.close();
              return;
            }
            if (next.value.length) {
              controller.enqueue(encoder.encode(`${buildCsv(next.value)}\n`));
              return;
            }
          }
        } catch {
          controller.error(new Error(params.errorMessage));
        }
      },
      async cancel() {
        await iterator?.return?.();
      },
    },
    // Read ahead by at most one batch.
    { highWaterMark: 1 },
  );
}

/** A streamed `text/csv` attachment (see `csvByteStream`). */
export function csvStreamResponse(params: {
  header: ReadonlyArray<string>;
  batches: () => AsyncIterable<ReadonlyArray<ReadonlyArray<string>>>;
  filename: string;
  errorMessage: string;
}): Response {
  const stream = csvByteStream(params);
  return new Response(stream, {
    headers: {
      ...EXPORT_NO_STORE_HEADERS,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${params.filename}"`,
    },
  });
}
