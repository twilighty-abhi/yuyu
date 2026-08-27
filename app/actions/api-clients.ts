"use server";

import crypto from "node:crypto";
import { ApiClientStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getMembership, canManageMembers } from "@/lib/permissions";
import { hasRecentAuthentication } from "@/lib/reauth";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { recordAuditEvent } from "@/lib/audit";
import { apiScopeSchema } from "@/lib/api/v1/scopes";
import { generateApiCredential } from "@/lib/api/v1/credentials";
import type { ActionResult } from "./org";

const orgSlug = z.string().trim().min(1).max(120);
const clientId = z.string().trim().min(1).max(128);
const credentialId = z.string().trim().min(1).max(128);
const credentialName = z.string().trim().min(1).max(80);
const scopes = z.array(apiScopeSchema).min(1).max(20).transform((items) => [...new Set(items)]);
const expiresAt = z.string().datetime().nullable().optional();

const createClientSchema = z.object({
  organisationSlug: orgSlug,
  name: z.string().trim().min(1).max(100),
  credentialName,
  scopes,
  expiresAt,
}).strict();
const createCredentialSchema = z.object({ organisationSlug: orgSlug, apiClientId: clientId, name: credentialName, expiresAt }).strict();
const revokeCredentialSchema = z.object({ organisationSlug: orgSlug, apiClientId: clientId, credentialId }).strict();
const updateScopesSchema = z.object({ organisationSlug: orgSlug, apiClientId: clientId, scopes }).strict();
const setStatusSchema = z.object({ organisationSlug: orgSlug, apiClientId: clientId, status: z.nativeEnum(ApiClientStatus) }).strict();

type OwnerAccess =
  | { error: string }
  | { userId: string; organisation: { id: string; slug: string } };

async function requireOwner(organisationSlug: string): Promise<OwnerAccess> {
  const session = await auth();
  if (!session?.user?.id) return { error: "You must be signed in." } as const;
  const organisation = await prisma.organisation.findUnique({
    where: { slug: organisationSlug },
    select: { id: true, slug: true },
  });
  if (!organisation) return { error: "Organisation not found." } as const;
  const membership = await getMembership(session.user.id, organisation.id);
  if (!canManageMembers(membership)) return { error: "Only the organisation owner can manage API access." } as const;
  if (!(await hasRecentAuthentication())) return { error: "For security, sign in again before changing API access." } as const;
  if (await isActionRateLimited("action", session.user.id)) return { error: "Too many API access changes. Try again shortly." } as const;
  return { userId: session.user.id, organisation } as const;
}

function parseExpiry(value: string | null | undefined): { value: Date | null } | { error: string } {
  if (!value) return { value: null } as const;
  const date = new Date(value);
  if (date <= new Date()) return { error: "Credential expiry must be in the future." } as const;
  return { value: date } as const;
}

function newCredentialId() {
  return `cr${crypto.randomBytes(16).toString("hex")}`;
}

export async function createApiClient(input: unknown): Promise<ActionResult<{ token: string }>> {
  const parsed = createClientSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter valid API client details." };
  const access = await requireOwner(parsed.data.organisationSlug);
  if ("error" in access) return { ok: false, error: access.error };
  const expiry = parseExpiry(parsed.data.expiresAt);
  if ("error" in expiry) return { ok: false, error: expiry.error };

  const newId = newCredentialId();
  const generated = generateApiCredential(newId);
  await prisma.$transaction(async (tx) => {
    const apiClient = await tx.apiClient.create({
      data: {
        organisationId: access.organisation.id,
        name: parsed.data.name,
        scopes: { create: parsed.data.scopes.map((scope) => ({ scope })) },
        credentials: { create: { id: newId, name: parsed.data.credentialName, secretHash: generated.secretHash, expiresAt: expiry.value } },
      },
      select: { id: true },
    });
    await recordAuditEvent({
      action: "API_CLIENT_CREATED",
      actorUserId: access.userId,
      organisationId: access.organisation.id,
      targetType: "ApiClient",
      targetId: apiClient.id,
      metadata: { scopeCount: parsed.data.scopes.length },
      client: tx,
    });
  });
  revalidatePath(`/dashboard/${access.organisation.slug}/settings/api`);
  return { ok: true, data: { token: generated.token } };
}

export async function createApiCredential(input: unknown): Promise<ActionResult<{ token: string }>> {
  const parsed = createCredentialSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter valid credential details." };
  const access = await requireOwner(parsed.data.organisationSlug);
  if ("error" in access) return { ok: false, error: access.error };
  const expiry = parseExpiry(parsed.data.expiresAt);
  if ("error" in expiry) return { ok: false, error: expiry.error };
  const existing = await prisma.apiClient.findFirst({ where: { id: parsed.data.apiClientId, organisationId: access.organisation.id }, select: { id: true } });
  if (!existing) return { ok: false, error: "API client not found." };

  const newId = newCredentialId();
  const generated = generateApiCredential(newId);
  await prisma.$transaction(async (tx) => {
    await tx.apiCredential.create({ data: { id: newId, apiClientId: existing.id, name: parsed.data.name, secretHash: generated.secretHash, expiresAt: expiry.value } });
    await recordAuditEvent({ action: "API_CREDENTIAL_CREATED", actorUserId: access.userId, organisationId: access.organisation.id, targetType: "ApiCredential", targetId: newId, client: tx });
  });
  revalidatePath(`/dashboard/${access.organisation.slug}/settings/api`);
  return { ok: true, data: { token: generated.token } };
}

export async function revokeApiCredential(input: unknown): Promise<ActionResult> {
  const parsed = revokeCredentialSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid credential." };
  const access = await requireOwner(parsed.data.organisationSlug);
  if ("error" in access) return { ok: false, error: access.error };
  const credential = await prisma.apiCredential.findFirst({
    where: { id: parsed.data.credentialId, apiClientId: parsed.data.apiClientId, apiClient: { organisationId: access.organisation.id } },
    select: { id: true, revokedAt: true },
  });
  if (!credential) return { ok: false, error: "Credential not found." };
  if (credential.revokedAt) return { ok: true };
  await prisma.$transaction(async (tx) => {
    await tx.apiCredential.update({ where: { id: credential.id }, data: { revokedAt: new Date() } });
    await recordAuditEvent({ action: "API_CREDENTIAL_REVOKED", actorUserId: access.userId, organisationId: access.organisation.id, targetType: "ApiCredential", targetId: credential.id, client: tx });
  });
  revalidatePath(`/dashboard/${access.organisation.slug}/settings/api`);
  return { ok: true };
}

export async function updateApiClientScopes(input: unknown): Promise<ActionResult> {
  const parsed = updateScopesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Select at least one valid scope." };
  const access = await requireOwner(parsed.data.organisationSlug);
  if ("error" in access) return { ok: false, error: access.error };
  const existing = await prisma.apiClient.findFirst({ where: { id: parsed.data.apiClientId, organisationId: access.organisation.id }, select: { id: true } });
  if (!existing) return { ok: false, error: "API client not found." };
  await prisma.$transaction(async (tx) => {
    await tx.apiClientScope.deleteMany({ where: { apiClientId: existing.id } });
    await tx.apiClientScope.createMany({ data: parsed.data.scopes.map((scope) => ({ apiClientId: existing.id, scope })) });
    await recordAuditEvent({ action: "API_CLIENT_SCOPES_CHANGED", actorUserId: access.userId, organisationId: access.organisation.id, targetType: "ApiClient", targetId: existing.id, metadata: { scopeCount: parsed.data.scopes.length }, client: tx });
  });
  revalidatePath(`/dashboard/${access.organisation.slug}/settings/api`);
  return { ok: true };
}

export async function setApiClientStatus(input: unknown): Promise<ActionResult> {
  const parsed = setStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid API client status." };
  const access = await requireOwner(parsed.data.organisationSlug);
  if ("error" in access) return { ok: false, error: access.error };
  const existing = await prisma.apiClient.findFirst({ where: { id: parsed.data.apiClientId, organisationId: access.organisation.id }, select: { id: true, status: true } });
  if (!existing) return { ok: false, error: "API client not found." };
  if (existing.status === parsed.data.status) return { ok: true };
  await prisma.$transaction(async (tx) => {
    await tx.apiClient.update({ where: { id: existing.id }, data: { status: parsed.data.status } });
    await recordAuditEvent({ action: parsed.data.status === "DISABLED" ? "API_CLIENT_DISABLED" : "API_CLIENT_ENABLED", actorUserId: access.userId, organisationId: access.organisation.id, targetType: "ApiClient", targetId: existing.id, client: tx });
  });
  revalidatePath(`/dashboard/${access.organisation.slug}/settings/api`);
  return { ok: true };
}
