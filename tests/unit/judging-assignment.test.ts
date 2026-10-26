import { describe, expect, it } from "vitest";
import { MinHeap, pairKey, planAutoAssignment, tieHash, type AutoAssignInput } from "@/lib/judgingAssignment";

function input(overrides: Partial<AutoAssignInput> = {}): AutoAssignInput {
  return {
    projectIds: Array.from({ length: 12 }, (_, index) => `p${String(index).padStart(2, "0")}`),
    poolJudgeIds: ["ja", "jb", "jc", "jd"],
    perProject: 2,
    mode: "keep",
    existing: [],
    blocked: new Set(),
    started: new Set(),
    canJudge: () => true,
    ...overrides,
  };
}

function judgesOf(plan: ReturnType<typeof planAutoAssignment>, projectId: string) {
  return plan.add.filter((pair) => pair.submissionId === projectId).map((pair) => pair.judgeUserId);
}

describe("MinHeap", () => {
  it("pops in order with a custom comparison", () => {
    const heap = new MinHeap<number>((a, b) => a < b);
    for (const value of [5, 3, 9, 1, 1, 7, 2]) heap.push(value);
    const out: number[] = [];
    while (heap.size) out.push(heap.pop()!);
    expect(out).toEqual([1, 1, 2, 3, 5, 7, 9]);
    expect(heap.pop()).toBeUndefined();
  });
});

describe("tieHash", () => {
  it("is stable and spreads values", () => {
    expect(tieHash("abc")).toBe(tieHash("abc"));
    expect(tieHash("abc")).not.toBe(tieHash("abd"));
    expect(tieHash("")).toBe(0x811c9dc5);
  });
});

describe("planAutoAssignment", () => {
  it("gives every project the target and balances load exactly when it divides", () => {
    const plan = planAutoAssignment(input());
    expect(plan.add).toHaveLength(24);
    expect(plan.shortfalls).toEqual([]);
    expect(plan.covered).toBe(12);
    expect(plan.loads.map((load) => load.after)).toEqual([6, 6, 6, 6]);
    for (const projectId of input().projectIds) {
      const judges = judgesOf(plan, projectId);
      expect(judges).toHaveLength(2);
      expect(new Set(judges).size).toBe(2);
    }
  });

  it("keeps loads within one of each other when it doesn't divide", () => {
    const plan = planAutoAssignment(input({ projectIds: Array.from({ length: 7 }, (_, index) => `q${index}`), perProject: 3 }));
    const loads = plan.loads.map((load) => load.after);
    expect(loads.reduce((sum, value) => sum + value, 0)).toBe(21);
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(1);
  });

  it("never assigns a judge with a conflict of interest", () => {
    const blocked = new Set([pairKey("ja", "p00"), pairKey("jb", "p00"), pairKey("jc", "p05")]);
    const plan = planAutoAssignment(input({ blocked }));
    expect(judgesOf(plan, "p00").sort()).toEqual(["jc", "jd"]);
    expect(judgesOf(plan, "p05")).not.toContain("jc");
    for (const pair of plan.add) expect(blocked.has(pairKey(pair.judgeUserId, pair.submissionId))).toBe(false);
  });

  it("reports projects that can't reach the target", () => {
    const blocked = new Set([pairKey("ja", "p03"), pairKey("jb", "p03"), pairKey("jc", "p03")]);
    const plan = planAutoAssignment(input({ blocked }));
    expect(plan.shortfalls).toEqual([{ submissionId: "p03", assigned: 1, missing: 1, possible: 1 }]);
    expect(plan.covered).toBe(11);
  });

  it("reports every project when the target is above the pool size", () => {
    const plan = planAutoAssignment(input({ perProject: 5 }));
    expect(plan.shortfalls).toHaveLength(12);
    expect(plan.shortfalls[0]).toMatchObject({ assigned: 4, missing: 1 });
    expect(plan.add).toHaveLength(48);
  });

  it("is deterministic, whatever the input order", () => {
    const a = planAutoAssignment(input());
    const b = planAutoAssignment(input({ projectIds: [...input().projectIds].reverse(), poolJudgeIds: ["ja", "jb", "jc", "jd"] }));
    expect(b.add).toEqual(a.add);
    expect(b.fingerprint).toBe(a.fingerprint);
  });

  it("re-running after applying adds nothing", () => {
    const first = planAutoAssignment(input());
    const second = planAutoAssignment(input({ existing: first.add }));
    expect(second.add).toEqual([]);
    expect(second.remove).toEqual([]);
    expect(second.covered).toBe(12);
    expect(second.fingerprint).not.toBe(first.fingerprint);
  });

  it("keep mode counts existing assignments and fills only the gaps", () => {
    const existing = [
      { judgeUserId: "ja", submissionId: "p00" },
      { judgeUserId: "jb", submissionId: "p00" },
      { judgeUserId: "ja", submissionId: "p01" },
    ];
    const plan = planAutoAssignment(input({ existing }));
    expect(judgesOf(plan, "p00")).toEqual([]);
    expect(judgesOf(plan, "p01")).toHaveLength(1);
    expect(judgesOf(plan, "p01")).not.toContain("ja");
    expect(plan.remove).toEqual([]);
    expect(plan.loads.find((load) => load.judgeUserId === "ja")!.before).toBe(2);
    const total = plan.loads.reduce((sum, load) => sum + load.after, 0);
    expect(total).toBe(24);
  });

  it("keep mode does not count an assignment whose judge can no longer judge", () => {
    const existing = [{ judgeUserId: "gone", submissionId: "p00" }];
    const plan = planAutoAssignment(input({ existing, canJudge: (id) => id !== "gone" }));
    expect(judgesOf(plan, "p00")).toHaveLength(2);
  });

  it("replace mode removes assignments but keeps started ones", () => {
    const existing = [
      { judgeUserId: "ja", submissionId: "p00" },
      { judgeUserId: "jb", submissionId: "p00" },
      { judgeUserId: "jc", submissionId: "p01" },
    ];
    const plan = planAutoAssignment(input({ mode: "replace", existing, started: new Set([pairKey("jb", "p00")]) }));
    // jb's started assignment is kept; the others may go, unless the fresh plan picks them straight back (then they stay put).
    expect(plan.remove).not.toContainEqual({ judgeUserId: "jb", submissionId: "p00" });
    const addKeys = new Set(plan.add.map((pair) => pairKey(pair.judgeUserId, pair.submissionId)));
    expect(plan.remove.filter((pair) => addKeys.has(pairKey(pair.judgeUserId, pair.submissionId)))).toEqual([]);
    expect(plan.remove.length).toBeGreaterThan(0);
    expect(judgesOf(plan, "p00")).not.toContain("jb");
    const kept = existing.filter((pair) => !plan.remove.some((gone) => gone.judgeUserId === pair.judgeUserId && gone.submissionId === pair.submissionId));
    expect(kept.filter((pair) => pair.submissionId === "p00").length + judgesOf(plan, "p00").length).toBe(2);
    for (const load of plan.loads) expect(load.after).toBe(load.before + load.added - load.removed);
    expect(plan.loads.reduce((sum, load) => sum + load.after, 0)).toBe(24);
  });

  it("a replace re-run on an unchanged event plans no changes", () => {
    const first = planAutoAssignment(input({ mode: "replace" }));
    const again = planAutoAssignment(input({ mode: "replace", existing: first.add }));
    expect(again.add).toEqual([]);
    expect(again.remove).toEqual([]);
    expect(again.covered).toBe(12);
    expect(again.loads.every((load) => load.added === 0 && load.removed === 0 && load.before === load.after)).toBe(true);
  });

  it("adopts work started without an assignment when judges see every project", () => {
    // ja saved scores on p00; jb and jc submitted reviews of p00; an organiser outside the pool started p01; jd has a conflict with p02; "gone" can no longer judge.
    const started = new Set([pairKey("ja", "p00"), pairKey("jb", "p00"), pairKey("jc", "p00"), pairKey("organiser", "p01"), pairKey("jd", "p02"), pairKey("gone", "p03")]);
    const submitted = new Set([pairKey("jb", "p00"), pairKey("jc", "p00")]);
    const blocked = new Set([pairKey("jd", "p02")]);
    const canJudge = (id: string) => id !== "gone";
    const plan = planAutoAssignment(input({ started, submitted, blocked, adoptStarted: true, canJudge }));
    expect(plan.adopt).toEqual([
      { judgeUserId: "ja", submissionId: "p00" },
      { judgeUserId: "jb", submissionId: "p00" },
      { judgeUserId: "jc", submissionId: "p00" },
      { judgeUserId: "organiser", submissionId: "p01" },
    ]);
    // p00 already has three judges with work, so it gets nobody new; p01 needs one more beside the organiser.
    expect(judgesOf(plan, "p00")).toEqual([]);
    expect(judgesOf(plan, "p01")).toHaveLength(1);
    expect(judgesOf(plan, "p02")).not.toContain("jd");
    expect(judgesOf(plan, "p03")).toHaveLength(2);
    const ja = plan.loads.find((load) => load.judgeUserId === "ja")!;
    expect(ja.before).toBe(1);
    for (const load of plan.loads) expect(load.after).toBe(load.before + load.added - load.removed);
    // Applying then re-running (judges now see assigned projects only) changes nothing.
    const again = planAutoAssignment(input({ started, submitted, blocked, canJudge, existing: [...plan.adopt, ...plan.add] }));
    expect(again.add).toEqual([]);
    expect(again.adopt).toEqual([]);
    expect(plan.fingerprint).not.toBe(planAutoAssignment(input({ started, submitted, blocked, canJudge })).fingerprint);
  });

  it("without adopting, submitted unassigned reviews still count and their judges aren't picked again", () => {
    const started = new Set([pairKey("ja", "p00"), pairKey("jb", "p00"), pairKey("jc", "p00")]);
    const submitted = new Set([pairKey("jb", "p00"), pairKey("jc", "p00")]);
    const plan = planAutoAssignment(input({ perProject: 3, started, submitted }));
    expect(plan.adopt).toEqual([]);
    // Two submitted reviews count; ja only saved scores, so one more judge is needed, and it isn't jb or jc.
    const picked = judgesOf(plan, "p00");
    expect(picked).toHaveLength(1);
    expect(["jb", "jc"]).not.toContain(picked[0]);
  });

  it("ignores existing assignments on projects outside the list", () => {
    const plan = planAutoAssignment(input({ mode: "replace", existing: [{ judgeUserId: "ja", submissionId: "withdrawn" }] }));
    expect(plan.remove).toEqual([]);
  });

  it("serves the most constrained projects first", () => {
    // Only jd may judge p11; with a target of one everybody else is free.
    const blocked = new Set(["ja", "jb", "jc"].map((judge) => pairKey(judge, "p11")));
    const plan = planAutoAssignment(input({ perProject: 1, blocked, poolJudgeIds: ["ja", "jb", "jc", "jd"] }));
    expect(judgesOf(plan, "p11")).toEqual(["jd"]);
    expect(plan.shortfalls).toEqual([]);
    expect(plan.loads.map((load) => load.after)).toEqual([3, 3, 3, 3]);
  });

  it("handles an empty pool or no projects", () => {
    expect(planAutoAssignment(input({ poolJudgeIds: [] })).shortfalls).toHaveLength(12);
    const none = planAutoAssignment(input({ projectIds: [] }));
    expect(none.add).toEqual([]);
    expect(none.covered).toBe(0);
  });
});
