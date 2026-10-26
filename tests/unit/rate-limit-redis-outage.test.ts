import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

// A Redis that accepts connections and never answers, and one that has
// stopped: both must fail closed quickly in
// production instead of stalling every request behind reconnect backoff.

const servers: net.Server[] = [];
const sockets = new Set<net.Socket>();

function listen(onConnection: (socket: net.Socket) => void): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      onConnection(socket);
    });
    servers.push(server);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port));
  });
}

async function loadLimiter(port: number) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CI", "");
  vi.stubEnv("ALLOW_INSECURE_PRODUCTION_TESTS", "");
  vi.stubEnv("REDIS_URL", `redis://127.0.0.1:${port}`);
  return import("@/lib/rateLimit");
}

async function timed<T>(work: () => Promise<T>) {
  const started = Date.now();
  const value = await work();
  return { value, ms: Date.now() - started };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const socket of sockets) socket.destroy();
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe("rate limiter while Redis is unavailable", () => {
  it("fails closed within the command deadline when Redis never answers", async () => {
    const port = await listen(() => { /* accept and stay silent */ });
    const { checkRateLimitById } = await loadLimiter(port);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { value, ms } = await timed(() => checkRateLimitById("global", "198.51.100.40"));
      expect(value).toBe(false);
      expect(ms).toBeLessThan(1_500);
    }
  });

  it("keeps failing closed quickly while ioredis reconnects to a stopped Redis", async () => {
    const port = await listen(() => { /* placeholder; closed below */ });
    await new Promise((resolve) => servers.splice(0, 1)[0].close(resolve));
    const { checkRateLimitById } = await loadLimiter(port);

    const started = Date.now();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const { value, ms } = await timed(() => checkRateLimitById("global", "198.51.100.41"));
      expect(value).toBe(false);
      expect(ms).toBeLessThan(600);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    // Ten checks spread over about a second of reconnect backoff.
    expect(Date.now() - started).toBeLessThan(4_000);
  });
});
