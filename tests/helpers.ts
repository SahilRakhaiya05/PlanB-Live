import demo from "../src/fixtures/demo-scenario.json";
import { Assignment, EventPlan, parsePlan } from "../src/domain";

export function demoPlan(): EventPlan {
  const { expected: _e, ...plan } = demo as Record<string, unknown>;
  const r = parsePlan(plan);
  if (!r.ok) throw new Error(r.issues.join("; "));
  return structuredClone(r.plan);
}
export const expected = (demo as any).expected;

/** Independent, deliberately naive feasibility check used only by tests. */
export function naiveFeasible(plan: EventPlan, a: Assignment): boolean {
  const ov = (s0: number, e0: number, s1: number, e1: number) => s0 < e1 && s1 < e0;
  for (const s of plan.sessions) {
    const p = a[s.id];
    const room = plan.rooms.find((r) => r.id === p.roomId)!;
    const end = p.startMinute + 30;
    if (!plan.startSlots.includes(p.startMinute)) return false;
    if (p.startMinute < s.earliestStartMinute || p.startMinute > s.latestStartMinute) return false;
    if (p.startMinute < s.originalStartMinute) return false;
    if (end > plan.endMinute) return false;
    if (room.capacity < s.attendance) return false;
    if (!s.equipment.every((e) => room.equipment.includes(e))) return false;
    if (s.requiresAccessible && !room.accessible) return false;
    if (plan.outages.some((o) => o.roomId === room.id && ov(p.startMinute, end, o.startMinute, o.endMinute))) return false;
    if (plan.speakerUnavailability.some((b) => b.speakerId === s.speakerId && ov(p.startMinute, end, b.startMinute, b.endMinute))) return false;
    if (s.lockedRoomId && s.lockedRoomId !== room.id) return false;
    if (s.lockedStartMinute !== undefined && s.lockedStartMinute !== p.startMinute) return false;
  }
  for (let i = 0; i < plan.sessions.length; i++)
    for (let j = i + 1; j < plan.sessions.length; j++) {
      const a1 = a[plan.sessions[i].id], a2 = a[plan.sessions[j].id];
      if (!ov(a1.startMinute, a1.startMinute + 30, a2.startMinute, a2.startMinute + 30)) continue;
      if (a1.roomId === a2.roomId) return false;
      if (plan.sessions[i].speakerId === plan.sessions[j].speakerId) return false;
    }
  return true;
}

/** Enumerate EVERY room x slot assignment (toy-model reference). */
export function bruteForce(plan: EventPlan): Assignment[] {
  const options = plan.rooms.flatMap((r) => plan.startSlots.map((st) => ({ roomId: r.id, startMinute: st })));
  const out: Assignment[] = [];
  const cur: Assignment = {};
  const rec = (i: number) => {
    if (i === plan.sessions.length) { if (naiveFeasible(plan, cur)) out.push({ ...cur }); return; }
    for (const o of options) { cur[plan.sessions[i].id] = o; rec(i + 1); }
  };
  rec(0);
  return out;
}
