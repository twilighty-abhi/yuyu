import { NextResponse } from "next/server";

export type ApiRouteStats = {
  routeId: string;
  total: number;
  errors: number;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  // Latency buckets in ms (upper bounds)
  buckets: Record<string, number>;
  lastSeenAt: string | null;
};

type Store = {
  startedAtMs: number;
  routes: Record<string, ApiRouteStats>;
};

const BUCKETS_MS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000] as const;

function bucketKey(ms: number): string {
  for (const b of BUCKETS_MS) if (ms <= b) return `<=${b}`;
  return ">5000";
}

function getStore(): Store {
  const g = globalThis as unknown as { __yuyuApiMonitor?: Store };
  if (!g.__yuyuApiMonitor) {
    g.__yuyuApiMonitor = { startedAtMs: Date.now(), routes: {} };
  }
  return g.__yuyuApiMonitor;
}

function getRoute(store: Store, routeId: string): ApiRouteStats {
  const existing = store.routes[routeId];
  if (existing) return existing;
  const buckets: Record<string, number> = {};
  for (const b of BUCKETS_MS) buckets[`<=${b}`] = 0;
  buckets[">5000"] = 0;
  const created: ApiRouteStats = {
    routeId,
    total: 0,
    errors: 0,
    lastErrorAt: null,
    lastErrorMessage: null,
    buckets,
    lastSeenAt: null,
  };
  store.routes[routeId] = created;
  return created;
}

export function getApiMonitorSnapshot(): {
  startedAtMs: number;
  routes: ApiRouteStats[];
} {
  const store = getStore();
  return {
    startedAtMs: store.startedAtMs,
    routes: Object.values(store.routes).sort((a, b) =>
      a.routeId.localeCompare(b.routeId),
    ),
  };
}

export function withApiMonitoring<TArgs extends unknown[]>(
  routeId: string,
  handler: (request: Request, ...args: TArgs) => Promise<Response>,
) {
  return async (request: Request, ...args: TArgs) => {
    const store = getStore();
    const s = getRoute(store, routeId);
    const t0 = performance.now();
    try {
      const res = await handler(request, ...args);
      const dt = Math.max(0, Math.round(performance.now() - t0));
      s.total += 1;
      s.buckets[bucketKey(dt)] += 1;
      s.lastSeenAt = new Date().toISOString();
      if (res.status >= 500) {
        s.errors += 1;
        s.lastErrorAt = new Date().toISOString();
        s.lastErrorMessage = `HTTP ${res.status}`;
      }
      return res;
    } catch {
      const dt = Math.max(0, Math.round(performance.now() - t0));
      s.total += 1;
      s.buckets[bucketKey(dt)] += 1;
      s.errors += 1;
      s.lastSeenAt = new Date().toISOString();
      s.lastErrorAt = new Date().toISOString();
      // Monitoring must never retain exception text: upstream libraries can
      // include SQL details, request data, or other sensitive values.
      s.lastErrorMessage = "Unhandled exception";
      if (routeId.includes("/api/v1/")) {
        return NextResponse.json(
          { error: { code: "INTERNAL_ERROR", message: "The request could not be completed." } },
          { status: 500, headers: { "Cache-Control": "no-store" } },
        );
      }
      return NextResponse.json({ ok: false, error: "Internal server error." }, { status: 500 });
    }
  };
}
