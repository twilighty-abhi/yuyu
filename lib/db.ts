import "./env";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

/**
 * After `prisma migrate` / `prisma generate`, dev HMR can keep a cached PrismaClient
 * from before new models existed — delegates like `eventSeries` are then missing.
 * Replace stale singletons so `prisma.eventSeries.findMany` etc. always exist.
 */
function getPrisma(): PrismaClient {
  const existing = globalForPrisma.prisma;
  const delegateOk =
    existing &&
    typeof (existing as unknown as { eventSeries?: { findMany: unknown } })
      .eventSeries?.findMany === "function";

  if (delegateOk) {
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
