import { Assignment, Blocker, EventPlan, Objective, Session, SolverStatus } from "./types";
import { overlaps } from "./time";
import { staticRejections } from "./validate";

export interface SolveOptions {
  maxNodes?: number;
  maxMillis?: number;
  now?: () => number;
}
export interface SolveResult {
  status: SolverStatus;
  assignment?: Assignment;
  cost?: number[];
  exploredStates: number;
  elapsedMs: number;
  blockers: Blocker[];
}

interface Candidate {
  roomId: string;
  start: number;
  end: number;
  cost: [number, number, number];
}

export const DEFAULT_BUDGET = { maxNodes: 250_000, maxMillis: 1_500 };

function candidateCost(objective: Objective, s: Session, roomId: string, start: number): [number, number, number] {
  const roomChanged = roomId !== s.originalRoomId ? 1 : 0;
  const delay = start - s.originalStartMinute;
  const changed = roomChanged || delay !== 0 ? 1 : 0;
  if (objective.mode === "A") return [changed, delay, roomChanged];
  const selected = objective.sessionId === s.id ? delay : 0;
  return [selected, changed, delay];
}

function lexLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

/** Eligible (room, start) pairs for a session after all single-session hard constraints. */
export function buildDomain(plan: EventPlan, s: Session, objective: Objective): Candidate[] {
  const out: Candidate[] = [];
  const speakerBlocks = plan.speakerUnavailability.filter(b => b.speakerId === s.speakerId);
  for (const room of plan.rooms) {
    if (room.capacity < s.attendance || (s.requiresAccessible && !room.accessible) || s.equipment.some(e => !room.equipment.includes(e)) || (s.lockedRoomId && s.lockedRoomId !== room.id)) continue;
    const closures = plan.outages.filter(o => o.roomId === room.id);
    for (const start of plan.startSlots) {
      if (start < Math.max(s.originalStartMinute, s.earliestStartMinute) || start > s.latestStartMinute || start + s.durationMinutes > plan.endMinute) continue;
      if ((s.lockedStartMinute === undefined || s.lockedStartMinute === start) && !closures.some(o => overlaps(start, start + s.durationMinutes, o.startMinute, o.endMinute)) && !speakerBlocks.some(b => overlaps(start, start + s.durationMinutes, b.startMinute, b.endMinute)))
        out.push({ roomId: room.id, start, end: start + s.durationMinutes, cost: candidateCost(objective, s, room.id, start) });
    }
  }
  // Deterministic: cheapest first (original assignment costs 0 so it is tried first), then time, then room id.
  out.sort((x, y) => {
    for (let i = 0; i < 3; i++) if (x.cost[i] !== y.cost[i]) return x.cost[i] - y.cost[i];
    if (x.start !== y.start) return x.start - y.start;
    return x.roomId < y.roomId ? -1 : x.roomId > y.roomId ? 1 : 0;
  });
  return out;
}

export function explainEmptyDomains(plan: EventPlan): Blocker[] {
  const blockers: Blocker[] = [];
  for (const s of plan.sessions) {
    if (buildDomain(plan, s, { mode: "A" }).length > 0) continue;
    const perRoom = plan.rooms.map((room) => {
      const reasons = new Set<string>();
      for (const start of plan.startSlots) for (const r of staticRejections(plan, s, room, start)) reasons.add(r.text);
      return { roomId: room.id, roomName: room.name, reasons: [...reasons] };
    });
    const noCapacity = plan.rooms.every((r) => r.capacity < s.attendance);
    const summary = noCapacity
      ? `No room seats ${s.attendance} people for "${s.title}".`
      : `No room and start time satisfy every requirement for "${s.title}".`;
    blockers.push({ sessionId: s.id, title: s.title, summary, perRoom });
  }
  return blockers;
}

export function solve(plan: EventPlan, objective: Objective, opts: SolveOptions = {}): SolveResult {
  const now = opts.now ?? (() => Date.now());
  const t0 = now();
  const maxNodes = opts.maxNodes ?? DEFAULT_BUDGET.maxNodes;
  const maxMillis = opts.maxMillis ?? DEFAULT_BUDGET.maxMillis;

  const domains = new Map<string, Candidate[]>();
  for (const s of plan.sessions) {
    if (now() - t0 > maxMillis) return { status: "SEARCH_LIMIT", exploredStates: 0, elapsedMs: now() - t0, blockers: [] };
    domains.set(s.id, buildDomain(plan, s, objective));
  }

  // Sound direct contradiction: some session has no eligible placement at all.
  const empty = plan.sessions.filter(s => !domains.get(s.id)!.length);
  const blockers = empty.map(s => ({ sessionId: s.id, title: s.title, summary: plan.rooms.every(r => r.capacity < s.attendance) ? `No room seats ${s.attendance} people for "${s.title}".` : `No room and start time meet the requirements for "${s.title}".`, perRoom: plan.rooms.map(room => ({ roomId: room.id, roomName: room.name, reasons: [...new Set(staticRejections(plan, s, room, s.originalStartMinute).map(r => r.text))] })) }));
  if (blockers.length) {
    return { status: "INFEASIBLE", exploredStates: 0, elapsedMs: now() - t0, blockers };
  }

  // Most-constrained session first; ties broken by id for determinism.
  const order = [...plan.sessions].sort((a, b) => {
    const d = domains.get(a.id)!.length - domains.get(b.id)!.length;
    return d !== 0 ? d : a.id < b.id ? -1 : 1;
  });
  const n = order.length;

  // Admissible bound: per-component minimum over each remaining domain (component-wise <= any real completion).
  const suffixMin: [number, number, number][] = Array.from({ length: n + 1 }, () => [0, 0, 0] as [number, number, number]);
  for (let i = n - 1; i >= 0; i--) {
    const dom = domains.get(order[i].id)!;
    for (let k = 0; k < 3; k++) suffixMin[i][k] = suffixMin[i + 1][k] + dom.reduce((min, c) => Math.min(min, c.cost[k]), Infinity);
  }

  const placed: { roomId: string; start: number; end: number; speakerId: string; id: string; cand: Candidate }[] = [];
  const byRoom = new Map<string, typeof placed>();
  const bySpeaker = new Map<string, typeof placed>();
  let best: number[] | null = null;
  let bestAssign: Assignment | null = null;
  let nodes = 0;
  let aborted = false;

  const dfs = (i: number, partial: [number, number, number]) => {
    if (aborted) return;
    if (i === n) {
      if (best === null || lexLess(partial, best)) {
        best = [...partial];
        bestAssign = {};
        for (const p of placed) bestAssign[p.id] = { roomId: p.roomId, startMinute: p.start };
      }
      return;
    }
    const bound = partial.map((v, k) => v + suffixMin[i][k]);
    if (best && !lexLess(bound, best)) return;
    const s = order[i];
    for (const c of domains.get(s.id)!) {
      nodes++;
      if (nodes > maxNodes || ((nodes & 127) === 0 && now() - t0 > maxMillis)) {
        aborted = true;
        return;
      }
      let clash = false;
      for (const p of [...(byRoom.get(c.roomId) ?? []), ...(bySpeaker.get(s.speakerId) ?? [])]) {
        if (!overlaps(c.start, c.end, p.start, p.end)) continue;
        if (p.roomId === c.roomId || p.speakerId === s.speakerId) { clash = true; break; }
      }
      if (clash) continue;
      const next: [number, number, number] = [partial[0] + c.cost[0], partial[1] + c.cost[1], partial[2] + c.cost[2]];
      const lb: number[] = [next[0] + suffixMin[i + 1][0], next[1] + suffixMin[i + 1][1], next[2] + suffixMin[i + 1][2]];
      if (best !== null && !lexLess(lb, best)) continue; // cannot beat current best
      const entry = { roomId: c.roomId, start: c.start, end: c.end, speakerId: s.speakerId, id: s.id, cand: c };
      placed.push(entry);
      if (!byRoom.has(c.roomId)) byRoom.set(c.roomId, []);
      if (!bySpeaker.has(s.speakerId)) bySpeaker.set(s.speakerId, []);
      byRoom.get(c.roomId)!.push(entry); bySpeaker.get(s.speakerId)!.push(entry);
      dfs(i + 1, next);
      byRoom.get(c.roomId)!.pop(); bySpeaker.get(s.speakerId)!.pop(); placed.pop();
    }
  };
  dfs(0, [0, 0, 0]);

  const elapsedMs = now() - t0;
  if (bestAssign) {
    return { status: aborted ? "FEASIBLE" : "OPTIMAL", assignment: bestAssign, cost: best!, exploredStates: nodes, elapsedMs, blockers: [] };
  }
  if (aborted) return { status: "SEARCH_LIMIT", exploredStates: nodes, elapsedMs, blockers: [] };
  return { status: "INFEASIBLE", exploredStates: nodes, elapsedMs, blockers: [] };
}
