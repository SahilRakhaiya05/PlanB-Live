import {
  Assignment,
  CheckId,
  CheckResult,
  ConstraintReport,
  EventPlan,
  EventPlanSchema,
  Room,
  Session,
  Violation,
} from "./types";
import { fmtRange, fmtTime, overlaps } from "./time";

/* ------------------------------------------------------------------ */
/* Input validation (INVALID_INPUT)                                    */
/* ------------------------------------------------------------------ */

export type ParseResult = { ok: true; plan: EventPlan } | { ok: false; issues: string[] };

function isIana(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function parsePlan(input: unknown): ParseResult {
  const parsed = EventPlanSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.slice(0, 12).map((i) => {
        const path = i.path.length ? i.path.join(".") : "event";
        return `${path}: ${i.message}`;
      }),
    };
  }
  const plan = parsed.data;
  const issues = semanticIssues(plan);
  return issues.length ? { ok: false, issues } : { ok: true, plan };
}

export function semanticIssues(plan: EventPlan): string[] {
  const out: string[] = [];
  const dup = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const x of ids) {
      if (seen.has(x)) out.push(`Duplicate ${kind} ID "${x}". Every ${kind} needs a unique ID.`);
      seen.add(x);
    }
  };
  dup("room", plan.rooms.map((r) => r.id));
  dup("session", plan.sessions.map((s) => s.id));
  dup("start slot", plan.startSlots.map(String));

  const date = new Date(`${plan.localDate}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== plan.localDate) out.push("Choose a valid calendar date.");
  if (!isIana(plan.timezone)) out.push(`timezone "${plan.timezone}" is not a valid IANA time zone (e.g. Asia/Kolkata).`);
  if (plan.endMinute <= 0) out.push("endMinute must be after midnight.");
  for (const s of plan.startSlots) {
    if (s + 5 > plan.endMinute) out.push(`Start slot ${fmtTime(s)} does not leave 5 minutes before the event ends at ${fmtTime(plan.endMinute)}.`);
  }
  const roomIds = new Set(plan.rooms.map((r) => r.id));
  const speakerIds = new Set(plan.sessions.map((s) => s.speakerId));
  for (const s of plan.sessions) {
    if (!roomIds.has(s.originalRoomId)) out.push(`Session "${s.title}" starts in unknown room "${s.originalRoomId}".`);
    if (!plan.startSlots.includes(s.originalStartMinute)) out.push(`Session "${s.title}" original start ${fmtTime(s.originalStartMinute)} is not one of the event's start slots.`);
    if (s.earliestStartMinute > s.latestStartMinute) out.push(`Session "${s.title}": earliest start is after latest start.`);
    if (s.originalStartMinute < s.earliestStartMinute || s.originalStartMinute > s.latestStartMinute)
      out.push(`Session "${s.title}": original start is outside its own allowed window.`);
    if (s.lockedRoomId && !roomIds.has(s.lockedRoomId)) out.push(`Session "${s.title}" is locked to unknown room "${s.lockedRoomId}".`);
    if (s.lockedStartMinute !== undefined && !plan.startSlots.includes(s.lockedStartMinute))
      out.push(`Session "${s.title}" is locked to ${fmtTime(s.lockedStartMinute)}, which is not a start slot.`);
  }
  plan.outages.forEach((o, i) => {
    if (!roomIds.has(o.roomId)) out.push(`Outage ${i + 1} refers to unknown room "${o.roomId}".`);
    if (o.startMinute >= o.endMinute) out.push(`Outage ${i + 1}: end must be after start.`);
  });
  plan.speakerUnavailability.forEach((b, i) => {
    if (!speakerIds.has(b.speakerId)) out.push(`Speaker block ${i + 1} refers to unknown speaker "${b.speakerId}".`);
    if (b.startMinute >= b.endMinute) out.push(`Speaker block ${i + 1}: end must be after start.`);
  });
  if (plan.selectedSessionId && !plan.sessions.some((s) => s.id === plan.selectedSessionId))
    out.push(`selectedSessionId "${plan.selectedSessionId}" is not a session in this event.`);
  return out;
}

/* ------------------------------------------------------------------ */
/* Static eligibility reasons (shared by solver + diagnostics)         */
/* ------------------------------------------------------------------ */

export type RejectCode =
  | "slot"
  | "window"
  | "not-earlier"
  | "event-end"
  | "capacity"
  | "equipment"
  | "accessibility"
  | "room-outage"
  | "speaker-unavailable"
  | "locked-room"
  | "locked-start";

export interface Rejection {
  code: RejectCode;
  text: string;
}

/** Every static hard constraint a (room, start) can violate for one session. Empty list = eligible. */
export function staticRejections(plan: EventPlan, s: Session, room: Room, start: number): Rejection[] {
  const out: Rejection[] = [];
  const end = start + s.durationMinutes;
  if (!plan.startSlots.includes(start)) out.push({ code: "slot", text: `${fmtTime(start)} is not a start slot` });
  if (start < s.earliestStartMinute || start > s.latestStartMinute)
    out.push({ code: "window", text: `outside allowed window ${fmtTime(s.earliestStartMinute)}–${fmtTime(s.latestStartMinute)} start` });
  if (start < s.originalStartMinute) out.push({ code: "not-earlier", text: "would move earlier than the original start" });
  if (end > plan.endMinute) out.push({ code: "event-end", text: `would end after ${fmtTime(plan.endMinute)}` });
  if (room.capacity < s.attendance) out.push({ code: "capacity", text: `seats ${room.capacity}, needs ${s.attendance}` });
  const missing = s.equipment.filter((e) => !room.equipment.includes(e));
  if (missing.length) out.push({ code: "equipment", text: `missing ${missing.join(", ")}` });
  if (s.requiresAccessible && !room.accessible) out.push({ code: "accessibility", text: "not accessible" });
  for (const o of plan.outages) {
    if (o.roomId === room.id && overlaps(start, end, o.startMinute, o.endMinute))
      out.push({ code: "room-outage", text: `closed ${fmtRange(o.startMinute, o.endMinute)}` });
  }
  for (const b of plan.speakerUnavailability) {
    if (b.speakerId === s.speakerId && overlaps(start, end, b.startMinute, b.endMinute))
      out.push({ code: "speaker-unavailable", text: `speaker unavailable ${fmtRange(b.startMinute, b.endMinute)}` });
  }
  if (s.lockedRoomId && s.lockedRoomId !== room.id) out.push({ code: "locked-room", text: "session is locked to another room" });
  if (s.lockedStartMinute !== undefined && s.lockedStartMinute !== start) out.push({ code: "locked-start", text: `session is locked to ${fmtTime(s.lockedStartMinute)}` });
  return out;
}

/* ------------------------------------------------------------------ */
/* Independent complete-assignment validator                           */
/* ------------------------------------------------------------------ */
/* Deliberately written without importing solver code. It re-checks    */
/* every hard constraint from the raw plan and the proposed assignment. */

const CHECK_LABELS: Record<CheckId, string> = {
  complete: "Every session is scheduled in a real room",
  slot: "Starts on an event start slot",
  window: "Within each session's allowed window",
  "not-earlier": "Nothing moves earlier than its original start",
  "event-end": "Finishes before the event ends",
  capacity: "Room capacity fits expected attendance",
  equipment: "Required equipment is in the room",
  accessibility: "Accessibility requirement is met",
  "room-availability": "Room is open (no outage overlap)",
  "speaker-availability": "Speaker is available",
  "room-conflict": "No two sessions share a room at the same time",
  "speaker-conflict": "No speaker is double-booked",
  locks: "Locked sessions stay where they are locked",
};

export function validateAssignment(plan: EventPlan, assignment: Assignment): ConstraintReport {
  const roomById = new Map(plan.rooms.map((r) => [r.id, r]));
  const v: Record<CheckId, Violation[]> = {
    complete: [], slot: [], window: [], "not-earlier": [], "event-end": [], capacity: [], equipment: [],
    accessibility: [], "room-availability": [], "speaker-availability": [], "room-conflict": [], "speaker-conflict": [], locks: [],
  };

  const ids = new Set(plan.sessions.map(s => s.id));
  for (const id of Object.keys(assignment)) if (!ids.has(id)) v.complete.push({ sessionIds: [id], message: "The schedule contains an unknown session." });
  for (const s of plan.sessions) {
    const a = Object.hasOwn(assignment, s.id) ? assignment[s.id] : undefined;
    const room = a ? roomById.get(a.roomId) : undefined;
    if (!a || !room) {
      v.complete.push({ sessionIds: [s.id], message: `"${s.title}" has no ${a ? "valid room" : "assignment"}.` });
      continue;
    }
    const end = a.startMinute + s.durationMinutes;
    if (!plan.startSlots.includes(a.startMinute))
      v.slot.push({ sessionIds: [s.id], message: `"${s.title}" starts at ${fmtTime(a.startMinute)}, which is not a start slot.` });
    if (a.startMinute < s.earliestStartMinute || a.startMinute > s.latestStartMinute)
      v.window.push({ sessionIds: [s.id], roomId: room.id, message: `"${s.title}" at ${fmtTime(a.startMinute)} is outside its allowed window.` });
    if (a.startMinute < s.originalStartMinute)
      v["not-earlier"].push({ sessionIds: [s.id], message: `"${s.title}" would start earlier than ${fmtTime(s.originalStartMinute)}.` });
    if (end > plan.endMinute)
      v["event-end"].push({ sessionIds: [s.id], message: `"${s.title}" would end at ${fmtTime(end)}, after the event ends.` });
    if (room.capacity < s.attendance)
      v.capacity.push({ sessionIds: [s.id], roomId: room.id, message: `${room.name} seats ${room.capacity}; "${s.title}" expects ${s.attendance}.` });
    for (const e of s.equipment) {
      if (!room.equipment.includes(e))
        v.equipment.push({ sessionIds: [s.id], roomId: room.id, message: `${room.name} has no ${e} for "${s.title}".` });
    }
    if (s.requiresAccessible && !room.accessible)
      v.accessibility.push({ sessionIds: [s.id], roomId: room.id, message: `"${s.title}" needs an accessible room; ${room.name} is not.` });
    for (const o of plan.outages) {
      if (o.roomId === room.id && overlaps(a.startMinute, end, o.startMinute, o.endMinute))
        v["room-availability"].push({ sessionIds: [s.id], roomId: room.id, message: `${room.name} is closed ${fmtRange(o.startMinute, o.endMinute)}, overlapping "${s.title}".` });
    }
    for (const b of plan.speakerUnavailability) {
      if (b.speakerId === s.speakerId && overlaps(a.startMinute, end, b.startMinute, b.endMinute))
        v["speaker-availability"].push({ sessionIds: [s.id], message: `Speaker for "${s.title}" is unavailable ${fmtRange(b.startMinute, b.endMinute)}.` });
    }
    if (s.lockedRoomId && s.lockedRoomId !== room.id)
      v.locks.push({ sessionIds: [s.id], roomId: room.id, message: `"${s.title}" is locked to another room.` });
    if (s.lockedStartMinute !== undefined && s.lockedStartMinute !== a.startMinute)
      v.locks.push({ sessionIds: [s.id], message: `"${s.title}" is locked to ${fmtTime(s.lockedStartMinute)}.` });
  }

  const placed = plan.sessions.filter((s) => assignment[s.id] && roomById.has(assignment[s.id].roomId));
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], b = placed[j];
      const pa = assignment[a.id], pb = assignment[b.id];
      const hit = overlaps(pa.startMinute, pa.startMinute + a.durationMinutes, pb.startMinute, pb.startMinute + b.durationMinutes);
      if (!hit) continue;
      if (pa.roomId === pb.roomId)
        v["room-conflict"].push({ sessionIds: [a.id, b.id], roomId: pa.roomId, message: `"${a.title}" and "${b.title}" both use ${roomById.get(pa.roomId)!.name} at overlapping times.` });
      if (a.speakerId === b.speakerId)
        v["speaker-conflict"].push({ sessionIds: [a.id, b.id], message: `"${a.title}" and "${b.title}" share a speaker at overlapping times.` });
    }
  }

  const order = Object.keys(CHECK_LABELS) as CheckId[];
  const checks: CheckResult[] = order.map((id) => ({ id, label: CHECK_LABELS[id], passed: v[id].length === 0, violations: v[id] }));
  return { valid: checks.every((c) => c.passed), checks };
}
