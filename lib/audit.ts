import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Write a deliberately minimal audit record. Callers must not pass PII,
 * passwords, reset links, check-in tokens, or registration answers in metadata.
 */
export async function recordAuditEvent(params: {
  action: string;
  actorUserId?: string | null;
  actorApiClientId?: string | null;
  organisationId?: string | null;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, string | number | boolean | null>;
  client?: Prisma.TransactionClient;
}) {
  const client = params.client ?? prisma;
  return client.auditEvent.create({
    data: {
      action: params.action,
      actorUserId: params.actorUserId ?? null,
      actorApiClientId: params.actorApiClientId ?? null,
      organisationId: params.organisationId ?? null,
      targetType: params.targetType ?? null,
      targetId: params.targetId ?? null,
      metadata: params.metadata ?? undefined,
    },
  });
}
