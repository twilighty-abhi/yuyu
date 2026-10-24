import type { RsvpStatus, SubmissionStatus } from "@prisma/client";
import { z } from "zod";
import { ORGANISER_TEAM_FILTERS, type OrganiserTeamFilter } from "@/lib/organiserTeamFilters";

/*
 * Guests · Teams → "Export CSV" (`/api/exports/events/:eventId/teams`): the
 * filter parameters and the row shape, as pure functions so they are unit
 * tested without a database and imported by the client list for its link.
 * The route reads the teams through the Teams view's own query
 * (`listEventTeamsForOrganiser`, lib/core/teams.ts).
 */

export const TEAM_EXPORT_HEADER = ["Team", "Status", "Size", "Incomplete", "Looking for members", "Leader", "Leader email", "Members", "Submission status", "Created"] as const;

export type TeamExportView = { status: OrganiserTeamFilter; query: string };

const teamExportParamsSchema = z
  .object({
    status: z.enum(ORGANISER_TEAM_FILTERS).optional().default("all"),
    q: z.string().trim().max(100).optional().default(""),
  })
  .strict();

/** Query-string form of the Teams view, for the export link ("" for the unfiltered view). */
export function teamExportSearchParams(view: { status: OrganiserTeamFilter; query: string }): string {
  const params = new URLSearchParams();
  if (view.status !== "all") params.set("status", view.status);
  if (view.query.trim()) params.set("q", view.query.trim());
  return params.toString();
}

/** Parses the export link's query string (only `status` and `q`); null for anything malformed. */
export function parseTeamExportSearchParams(params: URLSearchParams): TeamExportView | null {
  const parsed = teamExportParamsSchema.safeParse({ status: params.get("status") ?? undefined, q: params.get("q") ?? undefined });
  return parsed.success ? { status: parsed.data.status, query: parsed.data.q } : null;
}

export type TeamExportSource = {
  name: string;
  status: RsvpStatus;
  size: number;
  incomplete: boolean;
  lookingForMembers: boolean;
  createdAt: Date;
  members: Array<{ name: string; email: string | null; isLeader: boolean }>;
};

/** "Name <email>", or the name alone when there is no email. */
function memberLabel(member: { name: string; email: string | null }): string {
  return member.email ? `${member.name} <${member.email}>` : member.name;
}

/** One CSV row for a team, in TEAM_EXPORT_HEADER order. Pass the result to `buildCsv`. */
export function teamExportRow(team: TeamExportSource, submissionStatus: SubmissionStatus | null): string[] {
  const leader = team.members.find((member) => member.isLeader) ?? null;
  return [
    team.name,
    team.status,
    String(team.size),
    team.incomplete ? "Yes" : "No",
    team.lookingForMembers ? "Yes" : "No",
    leader?.name ?? "",
    leader?.email ?? "",
    team.members.map(memberLabel).join("; "),
    submissionStatus ?? "None",
    team.createdAt.toISOString(),
  ];
}
