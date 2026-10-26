/*
 * End-to-end timing of the organiser CSV exports against a running
 * production build (docs/PERFORMANCE.md). Signs in as the seeded owner of
 * load-a (giving that seeded user a known password first), downloads each
 * export, and reports time to first byte, total time, rows, bytes and the
 * server's peak resident memory (sampled with `ps` when PERF_SERVER_PID is set).
 *
 *   PERF_DATABASE_URL=… PERF_BASE_URL=http://127.0.0.1:4550 PERF_SERVER_PID=1234 \
 *     node tests/perf/export-timing.mts
 *
 * Only for the disposable seeded database: it refuses any other.
 */
import { execFileSync } from "node:child_process";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const url = process.env.PERF_DATABASE_URL?.trim();
const base = process.env.PERF_BASE_URL?.trim() ?? "http://127.0.0.1:4550";
const serverPid = process.env.PERF_SERVER_PID?.trim();
if (!url || !/load|perf/.test(new URL(url).pathname)) throw new Error("PERF_DATABASE_URL must name the seeded load database.");
const prisma = new PrismaClient({ datasources: { db: { url } } });
const password = "load-test-password-not-secret";

class Jar {
  cookies = new Map<string, string>();
  store(response: Response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const index = pair!.indexOf("=");
      this.cookies.set(pair!.slice(0, index), pair!.slice(index + 1));
    }
  }
  header() {
    return [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; ");
  }
}

function rssKb(): number {
  if (!serverPid) return 0;
  try {
    return Number(execFileSync("ps", ["-o", "rss=", "-p", serverPid]).toString().trim()) || 0;
  } catch {
    return 0;
  }
}

async function main() {
  const event = await prisma.event.findFirstOrThrow({ where: { slug: "load-hackathon" }, select: { id: true, organisationId: true } });
  const owner = await prisma.membership.findFirstOrThrow({ where: { organisationId: event.organisationId, role: "OWNER" }, select: { user: { select: { id: true, email: true } } } });
  await prisma.user.update({ where: { id: owner.user.id }, data: { passwordHash: await bcrypt.hash(password, 10), emailVerified: new Date() } });

  const jar = new Jar();
  const headers = () => ({ cookie: jar.header(), "cf-connecting-ip": "192.0.2.77" });
  const csrf = await fetch(`${base}/api/auth/csrf`, { headers: headers() });
  jar.store(csrf);
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  const login = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { ...headers(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, email: owner.user.email!, password, callbackUrl: `${base}/` }),
  });
  jar.store(login);
  const session = (await (await fetch(`${base}/api/auth/session`, { headers: headers() })).json()) as { user?: { id?: string } } | null;
  if (!session?.user) throw new Error("Sign-in failed.");

  const exports = [
    ["attendees (all)", `/api/exports/events/${event.id}/attendees`],
    ["attendees (filtered: going, search)", `/api/exports/events/${event.id}/attendees?status=going&q=a`],
    ["attendee emails", `/api/exports/events/${event.id}/attendee-emails`],
    ["teams (all)", `/api/exports/events/${event.id}/teams`],
    ["judging results (all reviews)", `/api/exports/events/${event.id}/judging`],
    ["judging submissions", `/api/exports/events/${event.id}/judging?view=submissions`],
  ] as const;
  const results = [];
  for (const [name, path] of exports) {
    const runs: Array<{ ttfb: number; total: number; bytes: number; rows: number; peakRssKb: number }> = [];
    for (let run = 0; run < 3; run++) {
      const before = rssKb();
      let peak = before;
      const sampler = setInterval(() => (peak = Math.max(peak, rssKb())), 50);
      const started = performance.now();
      const response = await fetch(`${base}${path}`, { headers: headers() });
      if (!response.ok || !response.body) throw new Error(`${name}: HTTP ${response.status}`);
      const reader = response.body.getReader();
      let ttfb = 0;
      let bytes = 0;
      let rows = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!ttfb) ttfb = performance.now() - started;
        bytes += value.byteLength;
        for (const byte of value) if (byte === 10) rows += 1;
      }
      const total = performance.now() - started;
      clearInterval(sampler);
      peak = Math.max(peak, rssKb());
      runs.push({ ttfb, total, bytes, rows: rows - 1, peakRssKb: peak });
    }
    runs.sort((a, b) => a.total - b.total);
    const median = runs[1]!;
    results.push({ name, path, ...median });
    console.log(`${name.padEnd(40)} ttfb ${median.ttfb.toFixed(0).padStart(6)} ms  total ${median.total.toFixed(0).padStart(6)} ms  rows ${String(median.rows).padStart(6)}  ${(median.bytes / 1024).toFixed(0).padStart(6)} KiB  peak rss ${(median.peakRssKb / 1024).toFixed(0)} MiB`);
  }
  if (process.env.PERF_OUT) (await import("node:fs")).writeFileSync(process.env.PERF_OUT, JSON.stringify(results, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
