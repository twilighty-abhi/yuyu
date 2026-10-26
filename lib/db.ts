import "./env";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Unique-constraint violations are expected and handled by their callers (a
 * duplicate registration answers 400 "already registered"), so they are not
 * logged. Every other Prisma error is still written to the server log as one
 * line; the thrown error reaches its caller either way.
 */
export function logPrismaError(event: { message: string }) {
  if (/Unique constraint failed/i.test(event.message)) return;
  // Straight to stderr, as Prisma's own logger did: Prisma messages can echo
  // query arguments, so they stay out of the console-forwarded ops alerts.
  process.stderr.write(`prisma:error ${event.message.replace(/\s+/g, " ").trim()}\n`);
}

function createPrismaClient() {
  const client = new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", { emit: "event", level: "error" }, "warn"]
        : [{ emit: "event", level: "error" }],
  });
  client.$on("error", logPrismaError);
  return client as unknown as PrismaClient;
}

/**
 * After `prisma migrate` / `prisma generate`, dev HMR can keep a cached PrismaClient
 * from before new models existed — delegates like `eventSeries` are then missing.
 * Replace stale singletons so `prisma.eventSeries.findMany` etc. always exist.
 */
function getPrisma(): PrismaClient {
  const existing = globalForPrisma.prisma;
  const delegates = existing as unknown as {
    eventSeries?: { findMany: unknown };
    apiClient?: { findMany: unknown };
    apiCredential?: { findMany: unknown };
    mobileSession?: { findMany: unknown };
  } | undefined;
  const delegateOk = Boolean(
    delegates &&
      typeof delegates.eventSeries?.findMany === "function" &&
      typeof delegates.apiClient?.findMany === "function" &&
      typeof delegates.apiCredential?.findMany === "function" &&
      typeof delegates.mobileSession?.findMany === "function",
  );

  if (delegateOk && existing) {
    return existing;
  }

  if (existing) {
    void existing.$disconnect();
  }

  const client = createPrismaClient();
  globalForPrisma.prisma = client;
  return client;
}

export const prisma = getPrisma();
