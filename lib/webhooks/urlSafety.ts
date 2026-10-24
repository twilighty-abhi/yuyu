import dns from "node:dns";
import net from "node:net";

/**
 * SSRF rules for organisation webhook targets (docs/WEBHOOKS.md#target-rules).
 *
 * Organisation admins are tenants, not operators, so a webhook may only reach
 * the public internet: https on 443 or 8443, no credentials in the URL, and
 * every resolved address must be public unicast. The same checks run when the
 * URL is saved and again before every delivery, and the delivery connects only
 * to the address vetted here (see `pinnedLookup`), so a DNS answer that
 * changes between the check and the connection cannot reach a private host.
 */

export const WEBHOOK_ALLOWED_PORTS = ["", "443", "8443"] as const;
const MAX_URL_LENGTH = 2048;

/**
 * `WEBHOOKS_ALLOW_PRIVATE_TARGETS=1` lets development and test send to http
 * and private/loopback receivers. A production server ignores it, except in
 * the explicit CI-only production-build test mode
 * (`CI=true` + `ALLOW_INSECURE_PRODUCTION_TESTS=1`) used by the e2e suite.
 */
export function webhookPrivateTargetsAllowed(env: NodeJS.ProcessEnv = process.env) {
  if (env.WEBHOOKS_ALLOW_PRIVATE_TARGETS !== "1") return false;
  if (env.NODE_ENV !== "production") return true;
  return env.CI === "true" && env.ALLOW_INSECURE_PRODUCTION_TESTS === "1";
}

export class WebhookTargetBlockedError extends Error {
  override name = "WebhookTargetBlockedError";
  code = "ETARGETBLOCKED";
  constructor(message = "The webhook host resolves to a private or reserved address.") {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Address classification

function ipv4ToInt(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

const BLOCKED_IPV4: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this network", including the unspecified address
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, including cloud metadata 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, including broadcast 255.255.255.255
];

function inIpv4Range(value: number, base: string, prefix: number) {
  const baseValue = ipv4ToInt(base)!;
  const size = 2 ** (32 - prefix);
  return value >= baseValue && value < baseValue + size;
}

function isBlockedIpv4(address: string) {
  const value = ipv4ToInt(address);
  if (value === null) return true;
  return BLOCKED_IPV4.some(([base, prefix]) => inIpv4Range(value, base, prefix));
}

/** Parse an IPv6 address (optionally with a trailing dotted quad or zone) into eight 16-bit groups. */
export function parseIpv6(input: string): number[] | null {
  let address = input.trim().toLowerCase();
  if (address.startsWith("[") && address.endsWith("]")) address = address.slice(1, -1);
  const zone = address.indexOf("%");
  if (zone >= 0) address = address.slice(0, zone);
  if (!net.isIPv6(address)) return null;
  let tail: number[] = [];
  const lastColon = address.lastIndexOf(":");
  const last = address.slice(lastColon + 1);
  if (last.includes(".")) {
    const v4 = ipv4ToInt(last);
    if (v4 === null) return null;
    tail = [Math.floor(v4 / 65536), v4 % 65536];
    address = `${address.slice(0, lastColon + 1)}0:0`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part ? part.split(":").map((group) => parseInt(group, 16)) : []);
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  const groups = halves.length === 2
    ? [...head, ...new Array(8 - head.length - rest.length).fill(0), ...rest]
    : head;
  if (groups.length !== 8 || groups.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) return null;
  if (tail.length) {
    groups[6] = tail[0]!;
    groups[7] = tail[1]!;
  }
  return groups;
}

function groupsToIpv4(high: number, low: number) {
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

function isBlockedIpv6(address: string) {
  const g = parseIpv6(address);
  if (!g) return true;
  const firstFiveZero = g.slice(0, 5).every((group) => group === 0);
  // IPv4-mapped ::ffff:a.b.c.d is judged by its IPv4 address.
  if (firstFiveZero && g[5] === 0xffff) return isBlockedIpv4(groupsToIpv4(g[6]!, g[7]!));
  // ::/96: unspecified, loopback and deprecated IPv4-compatible addresses.
  if (firstFiveZero && g[5] === 0) return true;
  // NAT64 well-known prefix 64:ff9b::/96 is judged by the embedded IPv4 address.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((group) => group === 0)) {
    return isBlockedIpv4(groupsToIpv4(g[6]!, g[7]!));
  }
  // Only global unicast 2000::/3 can be public; this excludes ULA fc00::/7,
  // link-local fe80::/10, site-local fec0::/10, multicast ff00::/8,
  // discard 100::/64 and the local-use NAT64 prefix 64:ff9b:1::/48.
  if ((g[0]! & 0xe000) !== 0x2000) return true;
  // 2001::/23 IETF protocol assignments (includes Teredo 2001::/32).
  if (g[0] === 0x2001 && g[1]! < 0x200) return true;
  // 2001:db8::/32 and 3fff::/20 documentation.
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true;
  if (g[0] === 0x3fff && g[1]! < 0x1000) return true;
  // 6to4 2002::/16 embeds an IPv4 address in the next 32 bits.
  if (g[0] === 0x2002) return isBlockedIpv4(groupsToIpv4(g[1]!, g[2]!));
  return false;
}

/** True for any address a tenant webhook must never reach (unparseable input included). */
export function isBlockedWebhookAddress(address: string) {
  const trimmed = address.trim().replace(/^\[|\]$/g, "");
  const family = net.isIP(trimmed.split("%")[0]!);
  if (family === 4) return isBlockedIpv4(trimmed);
  if (family === 6) return isBlockedIpv6(trimmed);
  return true;
}

// ---------------------------------------------------------------------------
// URL validation

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".localdomain"];

function bareHostname(url: URL) {
  return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

export type ParsedWebhookUrl = { ok: true; url: string; host: string } | { ok: false; error: string };

/**
 * Validates a webhook URL without touching the network. `allowPrivate` is
 * `webhookPrivateTargetsAllowed()` in production code.
 *
 * WHATWG URL parsing normalises decimal, octal and hex IPv4 forms
 * (`2130706433`, `0x7f.1`, `0177.0.0.1`) to dotted quads first, so they are
 * caught by the address rules below.
 */
export function parseWebhookUrl(raw: string, options: { allowPrivate: boolean }): ParsedWebhookUrl {
  const value = raw.trim();
  if (!value || value.length > MAX_URL_LENGTH) return { ok: false, error: "Enter a webhook URL of up to 2,048 characters." };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "Enter a valid URL, starting with https://." };
  }
  const httpAllowed = options.allowPrivate && url.protocol === "http:";
  if (url.protocol !== "https:" && !httpAllowed) return { ok: false, error: "Webhook URLs must use https://." };
  if (url.username || url.password) return { ok: false, error: "Remove the user name or password from the URL; Yuyu signs each request instead." };
  url.hash = "";
  const host = bareHostname(url);
  if (!host) return { ok: false, error: "Enter a valid URL, starting with https://." };
  if (!options.allowPrivate) {
    if (!(WEBHOOK_ALLOWED_PORTS as readonly string[]).includes(url.port)) {
      return { ok: false, error: "Webhook URLs must use port 443 or 8443." };
    }
    const name = host.replace(/\.$/, "");
    if (net.isIP(name)) {
      if (isBlockedWebhookAddress(name)) return { ok: false, error: "This address is private or reserved. Use a public host." };
    } else if (name === "localhost" || BLOCKED_HOST_SUFFIXES.some((suffix) => name.endsWith(suffix)) || !name.includes(".")) {
      return { ok: false, error: "Use a public host name, not a local or internal one." };
    }
  }
  return { ok: true, url: url.href, host };
}

/** Host only, for audit metadata and the UI summary (never the path or query). */
export function webhookHostLabel(rawUrl: string) {
  try {
    return new URL(rawUrl).host.slice(0, 255);
  } catch {
    return "invalid";
  }
}

// ---------------------------------------------------------------------------
// DNS resolution and pinning

export type ResolvedAddress = { address: string; family: 4 | 6 };
type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

const RESOLVER_KEY = Symbol.for("yuyu.webhooks.testResolver");

async function systemResolver(hostname: string): Promise<ResolvedAddress[]> {
  const records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => ({ address: record.address, family: record.family === 6 ? 6 : 4 }));
}

/** Test-only DNS override, so the rebinding checks can run without real DNS. */
export function setWebhookResolverForTests(resolver: Resolver | null) {
  if (process.env.NODE_ENV !== "test") throw new Error("The webhook resolver can only be replaced in tests.");
  const g = globalThis as typeof globalThis & { [RESOLVER_KEY]?: Resolver | null };
  g[RESOLVER_KEY] = resolver;
}

function activeResolver(): Resolver {
  const g = globalThis as typeof globalThis & { [RESOLVER_KEY]?: Resolver | null };
  return (process.env.NODE_ENV === "test" && g[RESOLVER_KEY]) || systemResolver;
}

/**
 * Resolves the URL's host and returns the vetted addresses to connect to.
 * Throws `WebhookTargetBlockedError` when any resolved address is blocked
 * (one bad answer is enough to refuse: an attacker controls the whole set).
 */
export async function resolveWebhookTarget(rawUrl: string, options: { allowPrivate: boolean }): Promise<ResolvedAddress[]> {
  const parsed = parseWebhookUrl(rawUrl, options);
  if (!parsed.ok) throw new WebhookTargetBlockedError(parsed.error);
  const host = parsed.host.replace(/\.$/, "") || parsed.host;
  const literal = net.isIP(host);
  const addresses: ResolvedAddress[] = literal
    ? [{ address: host, family: literal === 6 ? 6 : 4 }]
    : await activeResolver()(host);
  if (addresses.length === 0) {
    const error = new Error("The webhook host did not resolve.") as Error & { code: string };
    error.code = "ENOTFOUND";
    throw error;
  }
  if (!options.allowPrivate && addresses.some((entry) => isBlockedWebhookAddress(entry.address))) {
    throw new WebhookTargetBlockedError();
  }
  return addresses;
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

/**
 * A `lookup` for http(s).request that answers only with the vetted
 * addresses, so the socket connects to exactly what was checked.
 */
export function pinnedLookup(addresses: ResolvedAddress[]) {
  return (_hostname: string, options: dns.LookupOptions | number | LookupCallback, callback?: LookupCallback) => {
    const cb = (typeof options === "function" ? options : callback) as LookupCallback;
    const opts = typeof options === "object" && options !== null ? options : {};
    const wanted = opts.family === 4 || opts.family === 6 ? addresses.filter((entry) => entry.family === opts.family) : addresses;
    const list = wanted.length > 0 ? wanted : addresses;
    if (opts.all) cb(null, list.map((entry) => ({ address: entry.address, family: entry.family })));
    else cb(null, list[0]!.address, list[0]!.family);
  };
}
