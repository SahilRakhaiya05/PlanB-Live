import { Assignment, ChangeRecord, EventPlan, Metrics } from "./types";

/** Diff + metrics are computed from the two assignments only (never copied from solver cost). */
export function originalAssignment(plan: EventPlan): Assignment {
  const a: Assignment = {};
  for (const s of plan.sessions) a[s.id] = { roomId: s.originalRoomId, startMinute: s.originalStartMinute };
  return a;
}

export function computeChanges(plan: EventPlan, next: Assignment): ChangeRecord[] {
  const out: ChangeRecord[] = [];
  for (const s of plan.sessions) {
    const to = next[s.id];
    if (!to) continue;
    const from = { roomId: s.originalRoomId, startMinute: s.originalStartMinute };
    const roomChanged = to.roomId !== from.roomId;
    const timeChanged = to.startMinute !== from.startMinute;
    if (roomChanged || timeChanged)
      out.push({ sessionId: s.id, title: s.title, from, to, delayMinutes: to.startMinute - from.startMinute, roomChanged, timeChanged });
  }
  return out;
}

export function computeMetrics(changes: ChangeRecord[]): Metrics {
  return {
    changedSessions: changes.length,
    totalDelayMinutes: changes.reduce((n, c) => n + Math.max(0, c.delayMinutes), 0),
    roomChanges: changes.filter((c) => c.roomChanged).length,
    maxDelayMinutes: changes.reduce((n, c) => Math.max(n, c.delayMinutes), 0),
  };
}
