import { createHash } from "node:crypto";
import { AUTO_ASSIGN_MODES, type AutoAssignMode } from "@/lib/judgingProgress";

/*
 * Automatic judge assignment (docs/HACKATHON.md, "Automatic assignment"), as
 * pure functions so the rules are unit tested without a database
 * (tests/unit/judging-assignment.test.ts). The core in lib/core/judgingOps.ts
 * reads the event, builds the input, and writes the plan.
 *
 * Rules:
 * - Every SUBMITTED project should end up with `perProject` judges from the
 *   pool. The pool is the judges the organiser picked: JUDGE collaborators
 *   are in it by default, organisation owners and admins only when the
 *   organiser opts them in. The core checks every pool member can judge.
 * - A judge is never given a project they have a conflict of interest with
 *   (`blocked`, the same rule as the judge's own list).
 * - "keep" leaves every existing assignment alone; a kept assignment counts
 *   towards the project's target when its judge may judge it (`countable`).
 *   "replace" removes existing assignments, except where that judge has
 *   already scored or reviewed the project (`started`), which are kept and
 *   counted the same way. A replace re-run that would remove an assignment
 *   and add it straight back leaves it alone, so an unchanged event plans no
 *   changes in either mode.
 * - Work a judge did without an assignment (possible while judges see every
 *   project) is never ignored. When `adoptStarted` is set (judges see every
 *   project now, and applying switches that off) each started pair by a judge
 *   who may judge it becomes an assignment (`adopt`), counts towards the
 *   target and towards the judge's load, so the judge keeps access to their
 *   own work. Otherwise a submitted review by such a judge still counts
 *   towards the target (it counts in Results) and that judge isn't picked for
 *   the project again.
 * - Load is balanced with a min-heap on each judge's current load (kept and
 *   new assignments on SUBMITTED projects). Ties break on a hash of the judge
 *   and project ids, then the judge id, so the same input always gives the
 *   same plan and ties don't always favour the same judge.
 * - Projects with the fewest possible judges go first, so a project with
 *   many conflicts isn't starved by easier ones. A project that can't reach
 *   the target is reported as a shortfall.
 */

export { AUTO_ASSIGN_MODES, type AutoAssignMode };

export type AssignmentPair = { judgeUserId: string; submissionId: string };

export type AutoAssignInput = {
  /** SUBMITTED project ids. */
  projectIds: readonly string[];
  /** The judges to assign from (already checked as eligible). */
  poolJudgeIds: readonly string[];
  /** Target judges per project. */
  perProject: number;
  mode: AutoAssignMode;
  /** Every current assignment on the event's SUBMITTED projects. */
  existing: readonly AssignmentPair[];
  /** `pairKey(judge, project)` for conflicts of interest. */
  blocked: ReadonlySet<string>;
  /** `pairKey` of every judge/project pair with saved scores or a review row (draft or submitted), assigned or not. */
  started: ReadonlySet<string>;
  /** `pairKey` of pairs with a submitted review (a subset of `started`). */
  submitted?: ReadonlySet<string>;
  /** Turn started, unassigned pairs into assignments (judges currently see every project). */
  adoptStarted?: boolean;
  /** Whether an existing assignment's judge can still judge the event (counts towards the target). */
  canJudge: (judgeUserId: string) => boolean;
};

/**
 * Projects on each pool judge's plate: now (assignments on SUBMITTED projects,
 * plus started projects that become assignments), added, removed (replace
 * mode), and after the plan. `before + added - removed = after`.
 */
export type JudgeLoad = { judgeUserId: string; before: number; added: number; removed: number; after: number };
export type ProjectShortfall = { submissionId: string; assigned: number; missing: number; possible: number };

export type AutoAssignPlan = {
  add: AssignmentPair[];
  remove: AssignmentPair[];
  /** Started, unassigned pairs that become assignments so their judge keeps access. */
  adopt: AssignmentPair[];
  /** Pool judges, in pool order. */
  loads: JudgeLoad[];
  shortfalls: ProjectShortfall[];
  /** Projects that reach the target. */
  covered: number;
  /** Short digest of the add and remove lists, so applying can refuse a plan that changed since the preview. */
  fingerprint: string;
};

export function pairKey(judgeUserId: string, submissionId: string): string {
  return `${judgeUserId}\u0000${submissionId}`;
}

/** 32-bit FNV-1a: a cheap, stable hash for tie-breaks (not a security boundary). */
export function tieHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** A small binary min-heap with a caller-supplied ordering. */
export class MinHeap<T> {
  private readonly items: T[] = [];
  constructor(private readonly less: (a: T, b: T) => boolean) {}

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    const items = this.items;
    items.push(item);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.less(items[index]!, items[parent]!)) break;
      [items[index], items[parent]] = [items[parent]!, items[index]!];
      index = parent;
    }
  }

  pop(): T | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < items.length && this.less(items[left]!, items[smallest]!)) smallest = left;
        if (right < items.length && this.less(items[right]!, items[smallest]!)) smallest = right;
        if (smallest === index) break;
        [items[index], items[smallest]] = [items[smallest]!, items[index]!];
        index = smallest;
      }
    }
    return top;
  }
}

function comparePairs(a: AssignmentPair, b: AssignmentPair) {
  return a.submissionId < b.submissionId ? -1 : a.submissionId > b.submissionId ? 1 : a.judgeUserId < b.judgeUserId ? -1 : a.judgeUserId > b.judgeUserId ? 1 : 0;
}

export function planFingerprint(
  add: readonly AssignmentPair[],
  remove: readonly AssignmentPair[],
  perProject: number,
  mode: AutoAssignMode,
  adopt: readonly AssignmentPair[] = [],
): string {
  const hash = createHash("sha256");
  hash.update(`${mode}:${perProject}\n`);
  for (const pair of [...add].sort(comparePairs)) hash.update(`+${pair.judgeUserId}:${pair.submissionId}\n`);
  for (const pair of [...remove].sort(comparePairs)) hash.update(`-${pair.judgeUserId}:${pair.submissionId}\n`);
  for (const pair of [...adopt].sort(comparePairs)) hash.update(`=${pair.judgeUserId}:${pair.submissionId}\n`);
  return hash.digest("base64url").slice(0, 22);
}

type Candidate = { judgeUserId: string; load: number; tie: number };

/** Build the assignment plan. Pure and deterministic: the same input gives the same plan. */
export function planAutoAssignment(input: AutoAssignInput): AutoAssignPlan {
  const perProject = Math.max(1, Math.floor(input.perProject));
  const pool = [...new Set(input.poolJudgeIds)];
  const projects = [...new Set(input.projectIds)].sort();
  const projectSet = new Set(projects);

  const kept: AssignmentPair[] = [];
  let remove: AssignmentPair[] = [];
  for (const pair of input.existing) {
    if (!projectSet.has(pair.submissionId)) continue;
    if (input.mode === "replace" && !input.started.has(pairKey(pair.judgeUserId, pair.submissionId))) remove.push(pair);
    else kept.push(pair);
  }

  const load = new Map<string, number>(pool.map((id) => [id, 0]));
  const assignedTo = new Map<string, Set<string>>(projects.map((id) => [id, new Set<string>()]));
  const counted = new Map<string, number>(projects.map((id) => [id, 0]));
  for (const pair of kept) {
    assignedTo.get(pair.submissionId)!.add(pair.judgeUserId);
    if (load.has(pair.judgeUserId)) load.set(pair.judgeUserId, load.get(pair.judgeUserId)! + 1);
    if (input.canJudge(pair.judgeUserId) && !input.blocked.has(pairKey(pair.judgeUserId, pair.submissionId))) {
      counted.set(pair.submissionId, counted.get(pair.submissionId)! + 1);
    }
  }
  const before = new Map<string, number>(pool.map((id) => [id, 0]));
  for (const pair of input.existing) {
    if (!projectSet.has(pair.submissionId) || !before.has(pair.judgeUserId)) continue;
    before.set(pair.judgeUserId, before.get(pair.judgeUserId)! + 1);
  }

  // Work done without an assignment row (see the rules above).
  const existingKeys = new Set(input.existing.filter((pair) => projectSet.has(pair.submissionId)).map((pair) => pairKey(pair.judgeUserId, pair.submissionId)));
  const adopt: AssignmentPair[] = [];
  for (const key of [...input.started].sort()) {
    if (existingKeys.has(key) || input.blocked.has(key)) continue;
    const [judgeUserId, submissionId] = key.split("\u0000") as [string, string];
    if (!projectSet.has(submissionId) || !input.canJudge(judgeUserId)) continue;
    if (input.adoptStarted) {
      adopt.push({ judgeUserId, submissionId });
      assignedTo.get(submissionId)!.add(judgeUserId);
      counted.set(submissionId, counted.get(submissionId)! + 1);
      if (load.has(judgeUserId)) {
        load.set(judgeUserId, load.get(judgeUserId)! + 1);
        before.set(judgeUserId, before.get(judgeUserId)! + 1);
      }
    } else if (input.submitted?.has(key)) {
      assignedTo.get(submissionId)!.add(judgeUserId);
      counted.set(submissionId, counted.get(submissionId)! + 1);
    }
  }

  // Who could still take each project; the most constrained projects go first.
  const possible = new Map<string, string[]>();
  for (const projectId of projects) {
    const taken = assignedTo.get(projectId)!;
    possible.set(projectId, pool.filter((judgeId) => !taken.has(judgeId) && !input.blocked.has(pairKey(judgeId, projectId))));
  }
  const order = projects
    .map((id) => ({ id, room: possible.get(id)!.length + counted.get(id)!, tie: tieHash(id) }))
    .sort((a, b) => a.room - b.room || a.tie - b.tie || (a.id < b.id ? -1 : 1));

  let add: AssignmentPair[] = [];
  const shortfalls: ProjectShortfall[] = [];
  let covered = 0;
  for (const { id: projectId } of order) {
    let have = counted.get(projectId)!;
    const need = perProject - have;
    if (need > 0) {
      const heap = new MinHeap<Candidate>((a, b) => a.load < b.load || (a.load === b.load && (a.tie < b.tie || (a.tie === b.tie && a.judgeUserId < b.judgeUserId))));
      for (const judgeUserId of possible.get(projectId)!) {
        heap.push({ judgeUserId, load: load.get(judgeUserId)!, tie: tieHash(pairKey(judgeUserId, projectId)) });
      }
      for (let picked = 0; picked < need && heap.size > 0; picked += 1) {
        const next = heap.pop()!;
        add.push({ judgeUserId: next.judgeUserId, submissionId: projectId });
        load.set(next.judgeUserId, load.get(next.judgeUserId)! + 1);
        have += 1;
      }
    }
    if (have >= perProject) covered += 1;
    else shortfalls.push({ submissionId: projectId, assigned: have, missing: perProject - have, possible: possible.get(projectId)!.length + counted.get(projectId)! });
  }

  // Replace mode: an assignment removed and picked straight back is simply kept.
  if (remove.length && add.length) {
    const addKeys = new Set(add.map((pair) => pairKey(pair.judgeUserId, pair.submissionId)));
    const removeKeys = new Set(remove.map((pair) => pairKey(pair.judgeUserId, pair.submissionId)));
    const both = (pair: AssignmentPair) => addKeys.has(pairKey(pair.judgeUserId, pair.submissionId)) && removeKeys.has(pairKey(pair.judgeUserId, pair.submissionId));
    add = add.filter((pair) => !both(pair));
    remove = remove.filter((pair) => !both(pair));
  }
  const removedBy = new Map<string, number>();
  for (const pair of remove) removedBy.set(pair.judgeUserId, (removedBy.get(pair.judgeUserId) ?? 0) + 1);

  const added = new Map<string, number>();
  for (const pair of add) added.set(pair.judgeUserId, (added.get(pair.judgeUserId) ?? 0) + 1);
  const loads = pool.map((judgeUserId) => ({
    judgeUserId,
    before: before.get(judgeUserId)!,
    added: added.get(judgeUserId) ?? 0,
    removed: removedBy.get(judgeUserId) ?? 0,
    after: load.get(judgeUserId)!,
  }));
  shortfalls.sort((a, b) => b.missing - a.missing || (a.submissionId < b.submissionId ? -1 : 1));
  add.sort(comparePairs);
  remove.sort(comparePairs);
  adopt.sort(comparePairs);
  return { add, remove, adopt, loads, shortfalls, covered, fingerprint: planFingerprint(add, remove, perProject, input.mode, adopt) };
}
