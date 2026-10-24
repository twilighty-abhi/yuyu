import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  limited: vi.fn(),
  byManageToken: vi.fn(),
  byLeaderUser: vi.fn(),
  byTicket: vi.fn(),
  seekersForLeader: vi.fn(),
  requestsForLeader: vi.fn(),
  seekersForSeeker: vi.fn(),
  teamsLooking: vi.fn(),
  invites: vi.fn(),
  requests: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.session }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.limited }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/core/teams", () => ({
  resolveTeamByManageToken: mocks.byManageToken,
  resolveLeaderForUser: mocks.byLeaderUser,
  resolveRsvpByTicketToken: mocks.byTicket,
  listSeekersForLeader: mocks.seekersForLeader,
  listTeamJoinRequestsForLeader: mocks.requestsForLeader,
  listSeekersForSeeker: mocks.seekersForSeeker,
  listTeamsLookingForMembers: mocks.teamsLooking,
  listSeekerInvites: mocks.invites,
  listSeekerRequests: mocks.requests,
}));

import {
  loadTeamJoinRequestsPageAction,
  loadTeamSeekersPageAction,
  loadTicketInvitesPageAction,
  loadTicketSeekersPageAction,
  loadTicketTeamsPageAction,
} from "@/app/actions/teams";

const MANAGE_TOKEN = "m".repeat(43);
const TICKET_TOKEN = "c".repeat(24);
const leader = { kind: "token", teamId: "team_1", eventId: "evt_1", manageTokenHash: "h".repeat(64) };
const holder = { rsvpId: "rsvp_1", eventId: "evt_1", organisationId: "org_1", userId: null, teamId: null };
const page = { items: [{ id: "x" }], nextCursor: null, total: 1 };

describe("attendee team list actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue(null);
    mocks.limited.mockResolvedValue(false);
    mocks.byManageToken.mockResolvedValue(leader);
    mocks.byTicket.mockResolvedValue(holder);
    for (const list of [mocks.seekersForLeader, mocks.requestsForLeader, mocks.seekersForSeeker, mocks.teamsLooking, mocks.invites, mocks.requests]) {
      list.mockResolvedValue(page);
    }
  });

  it("resolves the leader link before every page and passes the input through for the core to validate", async () => {
    await expect(loadTeamSeekersPageAction({ manageToken: MANAGE_TOKEN }, { query: "go", cursor: null })).resolves.toEqual({ ok: true, data: page });
    expect(mocks.seekersForLeader).toHaveBeenCalledWith(leader, { query: "go", cursor: null });
    expect(mocks.limited).toHaveBeenCalledWith("search", "team:team_1");

    mocks.byManageToken.mockResolvedValue(null);
    await expect(loadTeamSeekersPageAction({ manageToken: MANAGE_TOKEN }, {})).resolves.toMatchObject({ ok: false });
    expect(mocks.seekersForLeader).toHaveBeenCalledTimes(1);
  });

  it("never resolves a bare team id without its signed-in leader", async () => {
    await expect(loadTeamJoinRequestsPageAction({ teamId: "team_1" }, "REQUEST", {})).resolves.toMatchObject({ ok: false });
    expect(mocks.byLeaderUser).not.toHaveBeenCalled();
    expect(mocks.requestsForLeader).not.toHaveBeenCalled();
  });

  it("accepts only the two request directions", async () => {
    await expect(loadTeamJoinRequestsPageAction({ manageToken: MANAGE_TOKEN }, "ACCEPTED", {})).resolves.toMatchObject({ ok: false });
    await expect(loadTeamJoinRequestsPageAction({ manageToken: MANAGE_TOKEN }, "INVITE", { cursor: "1.a" })).resolves.toEqual({ ok: true, data: page });
    expect(mocks.requestsForLeader).toHaveBeenCalledWith(leader, "INVITE", { cursor: "1.a" });
  });

  it("reports a list the core refuses, and rate limits searches", async () => {
    mocks.seekersForLeader.mockResolvedValue(null);
    await expect(loadTeamSeekersPageAction({ manageToken: MANAGE_TOKEN }, {})).resolves.toMatchObject({ ok: false });
    mocks.limited.mockResolvedValue(true);
    await expect(loadTicketTeamsPageAction(TICKET_TOKEN, {})).resolves.toEqual({ ok: false, error: "Too many searches. Try again shortly." });
    expect(mocks.teamsLooking).not.toHaveBeenCalled();
  });

  it("pages the ticket lists only for the resolved ticket holder", async () => {
    await expect(loadTicketSeekersPageAction(TICKET_TOKEN, { query: "rust" })).resolves.toEqual({ ok: true, data: page });
    expect(mocks.byTicket).toHaveBeenCalledWith(TICKET_TOKEN, null);
    expect(mocks.seekersForSeeker).toHaveBeenCalledWith(holder, { query: "rust" });
    await loadTicketInvitesPageAction(TICKET_TOKEN, { cursor: null });
    expect(mocks.invites).toHaveBeenCalledWith(holder, { cursor: null });

    mocks.byTicket.mockResolvedValue(null);
    await expect(loadTicketTeamsPageAction(TICKET_TOKEN, {})).resolves.toEqual({ ok: false, error: "Registration not found." });
    await expect(loadTicketSeekersPageAction("not a token", {})).resolves.toMatchObject({ ok: false });
    expect(mocks.teamsLooking).not.toHaveBeenCalled();
  });
});
