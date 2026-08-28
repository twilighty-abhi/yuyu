import { z } from "zod";

export const API_SCOPES = [
  "events:read",
  "participants:read",
  "participants:attendance:read",
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export const apiScopeSchema = z.enum(API_SCOPES);

export function isApiScope(value: string): value is ApiScope {
  return API_SCOPES.some((scope) => scope === value);
}
