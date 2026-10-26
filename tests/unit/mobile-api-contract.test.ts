import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import * as dto from "@/lib/mobile/schemas";

/*
 * Keeps docs/mobile-api.openapi.yaml, docs/mobile-api-fixtures/ and the strict
 * response schemas used by the routes (lib/mobile/schemas.ts) from drifting.
 */

const root = resolve(import.meta.dirname, "../..");
type Schema = Record<string, unknown>;
const spec = load(readFileSync(join(root, "docs/mobile-api.openapi.yaml"), "utf8")) as {
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, Schema> };
};

function deref(schema: Schema): Schema {
  const ref = schema.$ref;
  if (typeof ref !== "string") return schema;
  const name = ref.replace("#/components/schemas/", "");
  const target = spec.components.schemas[name];
  if (!target) throw new Error(`Unknown $ref ${ref}`);
  return deref(target);
}

/** Merge `allOf` members into one closed object schema (members extend EventSummary-style bases). */
function flatten(input: Schema): Schema {
  const schema = deref(input);
  if (!Array.isArray(schema.allOf)) return schema;
  const parts = (schema.allOf as Schema[]).map(flatten);
  return {
    type: "object",
    properties: Object.assign({}, ...parts.map((part) => part.properties ?? {})),
    required: parts.flatMap((part) => (part.required as string[] | undefined) ?? []),
    additionalProperties: false,
  };
}

function typeOf(value: unknown) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

/** A deliberately small JSON Schema (OpenAPI 3.1) validator covering what the spec uses. */
function validate(value: unknown, input: Schema, path = "$"): string[] {
  const schema = flatten(input);
  if (Array.isArray(schema.oneOf)) {
    const matches = (schema.oneOf as Schema[]).filter((option) => validate(value, option, path).length === 0);
    return matches.length === 1 ? [] : [`${path}: expected exactly one oneOf match, got ${matches.length}`];
  }
  if ("const" in schema && value !== schema.const) return [`${path}: expected const ${JSON.stringify(schema.const)}`];
  if (Array.isArray(schema.enum) && !(schema.enum as unknown[]).includes(value)) return [`${path}: ${JSON.stringify(value)} not in enum`];
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
    const actual = typeOf(value);
    const ok = allowed.includes(actual) || (actual === "integer" && allowed.includes("number"));
    if (!ok) return [`${path}: expected ${allowed.join("|")}, got ${actual}`];
    if (actual === "null") return [];
  }
  const errors: string[] = [];
  if (typeof value === "string" && schema.format === "date-time" && Number.isNaN(Date.parse(value))) errors.push(`${path}: invalid date-time`);
  if (typeof value === "string" && schema.format === "uri" && !/^https?:\/\//.test(value)) errors.push(`${path}: invalid uri`);
  if (Array.isArray(value) && schema.items) value.forEach((item, index) => errors.push(...validate(item, schema.items as Schema, `${path}[${index}]`)));
  if (typeOf(value) === "object") {
    const object = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    for (const key of (schema.required as string[] | undefined) ?? []) if (!(key in object)) errors.push(`${path}.${key}: required`);
    for (const [key, item] of Object.entries(object)) {
      if (properties[key]) errors.push(...validate(item, properties[key]!, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: not allowed`);
      else if (typeof schema.additionalProperties === "object") errors.push(...validate(item, schema.additionalProperties as Schema, `${path}.${key}`));
    }
  }
  return errors;
}

const fixtures: Array<[file: string, component: string, zod: z.ZodType]> = [
  ["session.json", "SessionResponse", dto.successEnvelope(dto.sessionDtoSchema)],
  ["me.json", "MeResponse", dto.successEnvelope(dto.meDtoSchema)],
  ["registrations.json", "RegistrationsResponse", dto.successEnvelope(dto.registrationsDtoSchema)],
  ["public-event.json", "PublicEventResponse", dto.successEnvelope(dto.publicEventDtoSchema)],
  ["guests.json", "GuestListResponse", dto.successEnvelope(dto.guestListDtoSchema)],
  ["check-in-preview.json", "CheckInPreviewResponse", dto.successEnvelope(dto.checkInPreviewSchema)],
  ["broadcasts-meta.json", "BroadcastsMetaResponse", dto.successEnvelope(dto.broadcastsMetaDtoSchema)],
  ["org-events.json", "OrgEventsResponse", dto.successEnvelope(dto.orgEventsDtoSchema)],
  ["org-event-detail.json", "OrgEventDetailResponse", dto.successEnvelope(dto.orgEventDetailDtoSchema)],
  ["registration-state.json", "RegistrationStateResponse", dto.successEnvelope(dto.registrationStateDtoSchema)],
  ["error.json", "ErrorEnvelope", dto.errorEnvelopeSchema],
  ["error-team-member.json", "ErrorEnvelope", dto.errorEnvelopeSchema],
  ["my-team.json", "MyTeamResponse", dto.successEnvelope(dto.myTeamResultDtoSchema)],
  ["teams.json", "TeamListResponse", dto.successEnvelope(dto.teamListDtoSchema)],
  ["team.json", "TeamResponse", dto.successEnvelope(dto.organiserTeamSchema)],
  ["judge-submissions.json", "JudgeSubmissionListResponse", dto.successEnvelope(dto.judgeSubmissionListDtoSchema)],
  ["judging-criteria.json", "JudgingCriteriaResponse", dto.successEnvelope(dto.judgingCriteriaDtoSchema)],
  ["judge-submission.json", "JudgeSubmissionDetailResponse", dto.successEnvelope(dto.judgeSubmissionDetailDtoSchema)],
  ["judge-next.json", "JudgeNextResponse", dto.successEnvelope(dto.judgeNextDtoSchema)],
  ["judge-scores-saved.json", "JudgeScoresSavedResponse", dto.successEnvelope(dto.judgeScoresSavedDtoSchema)],
];

describe("mobile API contract", () => {
  it("covers every fixture file", () => {
    const files = readdirSync(join(root, "docs/mobile-api-fixtures")).filter((file) => file.endsWith(".json")).sort();
    expect(files).toEqual(fixtures.map(([file]) => file).sort());
  });

  it.each(fixtures)("%s matches the OpenAPI schema and the route's Zod schema", (file, component, zod) => {
    const value = JSON.parse(readFileSync(join(root, "docs/mobile-api-fixtures", file), "utf8"));
    expect(validate(value, { $ref: `#/components/schemas/${component}` })).toEqual([]);
    const parsed = zod.safeParse(value);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });

  it("the validator itself rejects drift", () => {
    const value = JSON.parse(readFileSync(join(root, "docs/mobile-api-fixtures/guests.json"), "utf8"));
    value.data.guests[0].ticketToken = "leak";
    delete value.data.guests[1].isGuest;
    value.data.guests[1].status = "MAYBE";
    expect(validate(value, { $ref: "#/components/schemas/GuestListResponse" })).toEqual([
      "$.data.guests[0].ticketToken: not allowed",
      "$.data.guests[1].isGuest: required",
      '$.data.guests[1].status: "MAYBE" not in enum',
    ]);
  });

  it("documents exactly the implemented /api/mobile/v1 routes and methods", () => {
    const routeDir = join(root, "app/api/mobile/v1");
    const implemented = new Map<string, string[]>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry === "route.ts") {
          const path = `/api/mobile/v1/${relative(routeDir, dir)}`.replace(/\/$/, "").replace(/\[([^\]]+)\]/g, "{$1}");
          const methods = [...readFileSync(full, "utf8").matchAll(/export const (GET|POST|PATCH|PUT|DELETE)\b/g)].map((match) => match[1]!.toLowerCase()).sort();
          implemented.set(path, methods);
        }
      }
    };
    walk(routeDir);
    const documented = new Map(
      Object.entries(spec.paths)
        .filter(([path]) => path.startsWith("/api/mobile/v1/"))
        .map(([path, item]) => [path, Object.keys(item).filter((key) => ["get", "post", "patch", "put", "delete"].includes(key)).sort()]),
    );
    expect(Object.fromEntries(documented)).toEqual(Object.fromEntries(implemented));
  });

  const parity: Array<[component: string, zod: z.ZodObject]> = [
    ["User", dto.userDtoSchema],
    ["Session", dto.sessionDtoSchema],
    ["AuthConfig", dto.authConfigDtoSchema],
    ["Me", dto.meDtoSchema],
    ["EventSummary", dto.eventSummarySchema],
    ["Registration", dto.registrationDtoSchema],
    ["RegistrationField", dto.registrationFieldSchema],
    ["PublicEvent", dto.publicEventDtoSchema],
    ["RsvpResult", dto.rsvpResultDtoSchema],
    ["FeedbackForm", dto.feedbackFormDtoSchema],
    ["EventPermissions", dto.eventPermissionsSchema],
    ["EventCounts", dto.eventCountsSchema],
    ["OrgEventDetail", dto.orgEventDetailDtoSchema],
    ["Guest", dto.guestSchema],
    ["GuestDetail", dto.guestDetailDtoSchema],
    ["CheckInResult", dto.checkInResultSchema],
    ["CheckInPreview", dto.checkInPreviewSchema],
    ["CheckInStats", dto.checkInStatsDtoSchema],
    ["Roster", dto.rosterDtoSchema],
    ["SyncResult", dto.syncDtoSchema],
    ["BroadcastsMeta", dto.broadcastsMetaDtoSchema],
    ["Schedule", dto.scheduleDtoSchema],
    ["RegistrationState", dto.registrationStateDtoSchema],
    ["JudgingEvent", dto.judgingEventSchema],
    ["MyTeam", dto.myTeamSchema],
    ["MyTeamResult", dto.myTeamResultDtoSchema],
    ["OrganiserTeam", dto.organiserTeamSchema],
    ["TeamList", dto.teamListDtoSchema],
    ["JudgingCriterion", dto.judgingCriterionSchema],
    ["JudgeSubmission", dto.judgeSubmissionSchema],
    ["JudgeSubmissionList", dto.judgeSubmissionListDtoSchema],
    ["JudgingCriteria", dto.judgingCriteriaDtoSchema],
    ["JudgeSubmissionDetail", dto.judgeSubmissionDetailDtoSchema],
    ["JudgeNext", dto.judgeNextDtoSchema],
    ["JudgeScoresSaved", dto.judgeScoresSavedDtoSchema],
  ];

  it("documents every mobile error code", () => {
    const envelope = spec.components.schemas.ErrorEnvelope as { properties: { error: { properties: { code: { enum: string[] } } } } };
    expect([...envelope.properties.error.properties.code.enum].sort()).toEqual([...dto.mobileErrorCodeSchema.options].sort());
  });

  it.each(parity)("OpenAPI %s has the same fields as the Zod schema", (component, zod) => {
    const schema = flatten({ $ref: `#/components/schemas/${component}` });
    expect(Object.keys(schema.properties as object).sort()).toEqual(Object.keys(zod.shape).sort());
  });
});
