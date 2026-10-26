/*
 * The screenshot seed deletes and recreates demo users (including a
 * super-admin with a fixed password and authenticator), so it refuses to run
 * unless every one of these holds: an explicit opt-in, not production, and a
 * database on this machine.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function disposableDatabaseProblem(env: Record<string, string | undefined>): string | null {
  if (env.HELP_SCREENS_SEED !== "1") return "set HELP_SCREENS_SEED=1 to confirm the database is disposable";
  if (env.NODE_ENV === "production") return "NODE_ENV is production";
  const url = env.DATABASE_URL;
  if (!url) return "DATABASE_URL is not set";
  let host: string;
  try {
    const parsed = new URL(url);
    if (!/^postgres(ql)?:$/.test(parsed.protocol)) return "DATABASE_URL is not a PostgreSQL URL";
    // A socket path in ?host= would bypass the hostname check.
    if (parsed.searchParams.has("host")) return "DATABASE_URL must not set a host parameter";
    host = parsed.hostname;
  } catch {
    return "DATABASE_URL is not a valid URL";
  }
  if (!LOCAL_HOSTS.has(host)) return "DATABASE_URL must point at localhost, 127.0.0.1 or ::1";
  return null;
}

export function assertDisposableDatabase(env: Record<string, string | undefined> = process.env) {
  const problem = disposableDatabaseProblem(env);
  if (problem) {
    throw new Error(`Refusing to seed guide screenshots: ${problem}. The seed replaces demo users and data, so only run it against a disposable local database (see content/help/README.md).`);
  }
}
