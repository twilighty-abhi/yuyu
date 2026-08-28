import "server-only";
import crypto from "crypto";
export function hashEventCollaboratorToken(token: string) { return crypto.createHash("sha256").update(token).digest("hex"); }
export function createEventCollaboratorToken() { return crypto.randomBytes(32).toString("base64url"); }
