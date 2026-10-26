/**
 * Shared `Intl.DateTimeFormat` instances.
 *
 * Building a formatter is expensive: each one loads ICU calendar and timezone
 * data into native (non-JS-heap) memory, and Node returns little of it to the
 * operating system. Formatting in a loop with a fresh formatter per date (for
 * example once per registration on a large event's dashboard) allocated
 * gigabytes of native memory per request. Formatters are immutable and safe to
 * reuse, so every hot path asks this cache instead of calling the constructor.
 *
 * The key is the locale plus the options object as written, so call sites
 * should pass options in a consistent order. The cache is bounded: the inputs
 * are a handful of locales and option shapes times the IANA zones events use.
 */

const MAX_ENTRIES = 512;
const formatters = new Map<string, Intl.DateTimeFormat>();

export function cachedDateTimeFormat(locale: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale ?? ""}\u0000${JSON.stringify(options)}`;
  const hit = formatters.get(key);
  if (hit) return hit;
  // Throws a RangeError for an unknown time zone, like the constructor; a
  // failed construction is never cached.
  const formatter = new Intl.DateTimeFormat(locale, options);
  if (formatters.size >= MAX_ENTRIES) {
    const oldest = formatters.keys().next().value;
    if (oldest !== undefined) formatters.delete(oldest);
  }
  formatters.set(key, formatter);
  return formatter;
}

/** Number of cached formatters; for tests. */
export function cachedDateTimeFormatCount(): number {
  return formatters.size;
}
