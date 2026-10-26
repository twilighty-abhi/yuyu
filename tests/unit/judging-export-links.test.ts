import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The panels read their filters from the address bar (saved views) when they open.
const address = vi.hoisted(() => ({ params: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => address.params,
}));
vi.mock("@/components/feedback/ToastProvider", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/app/actions/judging-admin", () => ({
  saveJudgingSettings: vi.fn(),
  changeJudgingStatus: vi.fn(),
  publishJudgingResults: vi.fn(),
  unpublishJudgingResults: vi.fn(),
  changeScoreNormalization: vi.fn(),
  loadResultsPage: vi.fn(),
  assignProjectJudge: vi.fn(),
  disqualifyProject: vi.fn(),
  loadProjectReviews: vi.fn(),
  loadSubmissionsPage: vi.fn(),
  reinstateProject: vi.fn(),
  unassignProjectJudge: vi.fn(),
  loadUnsubmittedEntrantsPage: vi.fn(),
}));
vi.mock("@/app/actions/judging", () => ({ loadJudgeSubmission: vi.fn(), loadNextJudgeSubmission: vi.fn(), saveJudgeReviewAction: vi.fn() }));
vi.mock("@/app/actions/saved-views", () => ({ saveView: vi.fn(), renameView: vi.fn(), shareView: vi.fn(), deleteView: vi.fn() }));

import { JudgingPanelResults } from "@/components/event-dashboard/panels/JudgingPanelResults";
import { JudgingPanelSubmissions } from "@/components/event-dashboard/panels/JudgingPanelSubmissions";

const scope = { organisationSlug: "org", eventId: "event_1" };
const decode = (html: string) => html.replace(/&amp;/g, "&");

function exportLinks(html: string): string[] {
  return [...decode(html).matchAll(/href="(\/api\/exports\/events\/event_1\/judging[^"]*)"/g)].map((match) => match[1]);
}

function renderResults() {
  return renderToString(
    createElement(JudgingPanelResults, {
      scope,
      initialPage: { rows: [], page: 1, totalPages: 1, total: 0, start: 0, pageSize: 50, query: "", rankedTotal: 3, scoreNormalization: "RAW", scored: "all", scoreCounts: { all: 3, unscored: 1, underTwo: 2 } },
      criteria: [],
      judgingStatus: "CLOSED",
      resultsPublishedAt: null,
      resultsUrl: "https://yuyu.example/org/hack/results",
      exportHref: "/api/exports/events/event_1/judging",
      timezone: "UTC",
    }),
  );
}

function renderSubmissions(unsubmittedCount: number) {
  return renderToString(
    createElement(JudgingPanelSubmissions, {
      scope,
      initialPage: { submissions: [], nextCursor: null },
      counts: { DRAFT: 0, SUBMITTED: 2, WITHDRAWN: 0, DISQUALIFIED: 0 },
      total: 2,
      judges: [],
      criteria: [],
      judgesSeeAll: true,
      timezone: "UTC",
      awards: [],
      resultsPublished: false,
      limits: { criteria: 10, criterionName: 80, description: 500, weight: 10, maxScore: 100, awards: 10, awardName: 80, awardPlace: 10, disqualifyReason: 500 },
      unsubmittedCount,
    }),
  );
}

beforeEach(() => {
  address.params = new URLSearchParams();
});

describe("Judging export links carry the filters showing", () => {
  it("Results passes the score chip, search and method", () => {
    address.params = new URLSearchParams({ scored: "unscored" });
    const links = exportLinks(renderResults());
    expect(links).toHaveLength(1);
    const params = new URL(links[0], "https://x").searchParams;
    expect(params.get("scored")).toBe("unscored");
    expect(params.get("method")).toBe("RAW");
  });

  it("Results omits the score chip when every project is shown", () => {
    const [href] = exportLinks(renderResults());
    expect(new URL(href, "https://x").searchParams.has("scored")).toBe(false);
  });

  it("Not submitted exports the entrants when there are any", () => {
    address.params = new URLSearchParams({ status: "notSubmitted" });
    const html = renderSubmissions(8);
    const links = exportLinks(html);
    expect(links).toHaveLength(1);
    const params = new URL(links[0], "https://x").searchParams;
    expect(params.get("view")).toBe("submissions");
    expect(params.get("status")).toBe("notSubmitted");
    expect(html).not.toContain("No projects match this filter");
  });

  it("Not submitted with no entrants disables the export with an entrant reason", () => {
    address.params = new URLSearchParams({ status: "notSubmitted" });
    const html = renderSubmissions(0);
    expect(exportLinks(html)).toHaveLength(0);
    expect(html).toContain("No entrants match this filter");
  });
});
