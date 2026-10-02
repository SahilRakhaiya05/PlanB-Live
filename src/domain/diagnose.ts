import {
  Assignment, ChangeRecord, EventPlan, FixSuggestion, Objective, PlanPatch,
} from "./types";
import { fmtRange, fmtTime, overlaps } from "./time";
import { solve } from "./solver";
import { parsePlan, staticRejections, validateAssignment } from "./validate";
import { computeChanges, computeMetrics } from "./diff";

export interface Affected {
  sessionId: string;
  title: string;
  reasons: string[];
}

/** Sessions whose ORIGINAL placement collides with an outage or speaker block. */
export function affectedSessions(plan: EventPlan): Affected[] {
  const out: Affected[] = [];
  const roomName = new Map(plan.rooms.map((r) => [r.id, r.name]));
  for (const s of plan.sessions) {
    const reasons: string[] = [];
    const end = s.originalStartMinute + s.durationMinutes;
    for (const o of plan.outages) {
      if (o.roomId === s.originalRoomId && overlaps(s.originalStartMinute, end, o.startMinute, o.endMinute))
        reasons.push(`${roomName.get(o.roomId)} is closed ${fmtRange(o.startMinute, o.endMinute)}, overlapping ${fmtRange(s.originalStartMinute, end)}.`);
    }
    for (const b of plan.speakerUnavailability) {
      if (b.speakerId === s.speakerId && overlaps(s.originalStartMinute, end, b.startMinute, b.endMinute))
        reasons.push(`The speaker is unavailable ${fmtRange(b.startMinute, b.endMinute)}, overlapping ${fmtRange(s.originalStartMinute, end)}.`);
    }
    if (reasons.length) out.push({ sessionId: s.id, title: s.title, reasons });
  }
  return out;
}

/** Explain why each changed session moved: directly affected, or displaced by another session. */
export function explainChanges(plan: EventPlan, assignment: Assignment, changes: ChangeRecord[]): Record<string, string> {
  const direct = new Map(affectedSessions(plan).map((a) => [a.sessionId, a]));
  const roomName = new Map(plan.rooms.map((r) => [r.id, r.name]));
  const title = new Map(plan.sessions.map((s) => [s.id, s.title]));
  const out: Record<string, string> = {};
  for (const c of changes) {
    const d = direct.get(c.sessionId);
    if (d) { out[c.sessionId] = "Directly affected: " + d.reasons[0]; continue; }
    const s = plan.sessions.find((x) => x.id === c.sessionId)!;
    const origEnd = s.originalStartMinute + s.durationMinutes;
    const taker = plan.sessions.find((o) => {
      if (o.id === c.sessionId) return false;
      const a = assignment[o.id];
      return a && a.roomId === s.originalRoomId && overlaps(a.startMinute, a.startMinute + o.durationMinutes, s.originalStartMinute, origEnd);
    });
    out[c.sessionId] = taker
      ? `Moved to make way: "${title.get(taker.id)}" now uses ${roomName.get(s.originalRoomId)} at ${fmtTime(assignment[taker.id].startMinute)}.`
      : "Moved to keep every hard constraint satisfied.";
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Verified "what would unblock this" edits (organizer decisions)      */
/* ------------------------------------------------------------------ */

export function applyPatches(plan: EventPlan, patches: PlanPatch[]): EventPlan {
  return patches.reduce((p, patch) => applyPatch(p, patch), plan);
}

export function applyPatch(plan: EventPlan, patch: PlanPatch): EventPlan {
  const p: EventPlan = structuredClone(plan);
  switch (patch.kind) {
    case "room": {
      const r = p.rooms.find((x) => x.id === patch.roomId);
      if (r) Object.assign(r, patch.set);
      break;
    }
    case "session": {
      const s = p.sessions.find((x) => x.id === patch.sessionId);
      if (s) Object.assign(s, patch.set);
      break;
    }
    case "addSlot": {
      const last = Math.max(...p.startSlots);
      const next = last + 30;
      p.startSlots = [...p.startSlots, next];
      p.endMinute = Math.max(p.endMinute, next + 30);
      for (const s of p.sessions) if (s.latestStartMinute >= last) s.latestStartMinute = Math.max(s.latestStartMinute, next);
      break;
    }
    case "removeOutage":
      p.outages = p.outages.filter((_, i) => i !== patch.index);
      break;
  }
  return p;
}

/**
 * Try single, explicit organizer edits and keep only those that a real re-solve proves
 * make the event schedulable. Nothing here relaxes constraints automatically.
 */
export function suggestFixes(plan: EventPlan, objective: Objective, limit = 5): FixSuggestion[] {
  if (plan.sessions.length > 30 || plan.rooms.length > 10) return [];
  const deadline = Date.now() + 1200;
  const roomName = new Map(plan.rooms.map((r) => [r.id, r.name]));
  const candidates: { id: string; label: string; detail: string; patch: PlanPatch }[] = [];

  plan.outages.forEach((o, i) => {
    candidates.push({
      id: `outage-${i}`,
      label: `Reopen ${roomName.get(o.roomId)} (${fmtRange(o.startMinute, o.endMinute)})`,
      detail: "Removes this outage. Only choose this if the room can really reopen.",
      patch: { kind: "removeOutage", index: i },
    });
  });

  for (const s of plan.sessions) {
    for (const room of plan.rooms) {
      const reasons = new Set<string>();
      for (const start of plan.startSlots) for (const r of staticRejections(plan, s, room, start)) reasons.add(r.code);
      const fixable = [...reasons].filter((c) => c === "capacity" || c === "accessibility" || c === "equipment");
      if (!fixable.length) continue;
      const set: Partial<{ capacity: number; accessible: boolean; equipment: string[] }> = {};
      const bits: string[] = [];
      if (fixable.includes("capacity")) { set.capacity = s.attendance; bits.push(`seat ${s.attendance}`); }
      if (fixable.includes("accessibility")) { set.accessible = true; bits.push("be accessible"); }
      if (fixable.includes("equipment")) {
        set.equipment = [...new Set([...room.equipment, ...s.equipment])];
        bits.push(`have ${s.equipment.join(" + ")}`);
      }
      candidates.push({
        id: `room-${room.id}-for-${s.id}`,
        label: `Make ${room.name} ${bits.join(" and ")}`,
        detail: `Use ${room.name} for "${s.title}". Confirm the venue can really offer this.`,
        patch: { kind: "room", roomId: room.id, set },
      });
    }
    if (s.requiresAccessible) {
      candidates.push({
        id: `drop-access-${s.id}`,
        label: `Drop the accessibility requirement for "${s.title}"`,
        detail: "Only if attendees confirm no one needs it. This is your decision, not a default.",
        patch: { kind: "session", sessionId: s.id, set: { requiresAccessible: false } },
      });
    }
  }
  if (plan.startSlots.length < 8) {
    candidates.push({
      id: "add-slot",
      label: `Add a ${fmtTime(Math.max(...plan.startSlots) + 30)} start slot`,
      detail: "Extends the event day by 30 minutes.",
      patch: { kind: "addSlot" },
    });
  }

  // De-duplicate identical patches, then verify each by re-solving.
  const seen = new Set<string>();
  const unique = candidates.filter((c) => { const k = JSON.stringify(c.patch); if (seen.has(k)) return false; seen.add(k); return true; });
  const tryPatches = (patches: PlanPatch[]) => {
    const patched = applyPatches(plan, patches);
    if (Date.now() >= deadline || !parsePlan(patched).ok) return null;
    const r = solve(patched, objective, { maxNodes: 50_000, maxMillis: Math.min(150, deadline - Date.now()) });
    if ((r.status === "OPTIMAL" || r.status === "FEASIBLE") && r.assignment && validateAssignment(patched, r.assignment).valid) {
      const m = computeMetrics(computeChanges(patched, r.assignment));
      return m;
    }
    return null;
  };
  const verified: FixSuggestion[] = [];
  const failedSingles: typeof unique = [];
  for (const c of unique) {
    if (Date.now() >= deadline) break;
    const m = tryPatches([c.patch]);
    if (m) verified.push({ id: c.id, label: c.label, detail: c.detail, patches: [c.patch], resultingChangedSessions: m.changedSessions, resultingTotalDelay: m.totalDelayMinutes });
    else failedSingles.push(c);
  }
  // If few single edits work, look for pairs that only work together (e.g. upgrade a room AND add a slot).
  if (verified.length < 3) {
    const pool = failedSingles.filter((c) => c.patch.kind !== "removeOutage").slice(0, 14);
    let tried = 0;
    outer: for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        if (++tried > 120 || Date.now() >= deadline) break outer;
        const a = pool[i], b = pool[j];
        const m = tryPatches([a.patch, b.patch]);
        if (m) verified.push({ id: `${a.id}+${b.id}`, label: `${a.label}, and ${b.label.charAt(0).toLowerCase()}${b.label.slice(1)}`, detail: "These two edits only work together. Confirm both are really possible.", patches: [a.patch, b.patch], resultingChangedSessions: m.changedSessions, resultingTotalDelay: m.totalDelayMinutes });
      }
    }
  }
  verified.sort((a, b) => a.patches.length - b.patches.length || a.resultingChangedSessions - b.resultingChangedSessions || a.resultingTotalDelay - b.resultingTotalDelay || a.id.localeCompare(b.id));
  // One suggestion per distinct set of targets (avoids "seat 40 / 50 / 60" variants of the same idea).
  const sig = (f: FixSuggestion) => f.patches.map((x) => x.kind + ("roomId" in x ? x.roomId : "sessionId" in x ? x.sessionId : "")).sort().join("|");
  const bySig = new Set<string>();
  const distinct = verified.filter((f) => { const k = sig(f); if (bySig.has(k)) return false; bySig.add(k); return true; });
  return distinct.slice(0, limit);
}
