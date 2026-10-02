import { EventPlan, RepairResponse, fmtTime } from "./domain";

export interface RepairPair {
  A: RepairResponse;
  B: RepairResponse;
}

function roomName(plan: EventPlan, id: string): string {
  return plan.rooms.find((r) => r.id === id)?.name ?? id;
}

function repairFacts(res: RepairResponse | undefined) {
  if (!res) return null;
  return {
    status: res.status,
    message: res.message,
    checksPassed: res.report ? res.report.checks.filter((c) => c.passed).length : null,
    checksTotal: res.report?.checks.length ?? null,
    metrics: res.metrics ?? null,
    changes: (res.changes ?? []).map((c) => ({
      title: c.title,
      delayMinutes: c.delayMinutes,
      to: `${fmtTime(c.to.startMinute)}`,
    })),
    fixes: (res.fixes ?? []).map((f) => f.label),
  };
}

/** Compact, model-safe description of the board. Contains no secrets. */
export function planFacts(plan: EventPlan, results: RepairPair | null, approvedLabel: string | null) {
  const priority = plan.sessions.find((s) => s.id === plan.selectedSessionId);
  return {
    product: "PlanB Live compares checked repairs of one event day. It does not send messages and it does not invent a plan.",
    fictional: plan.fictional === true,
    title: plan.title,
    date: plan.localDate,
    timezone: plan.timezone,
    rooms: plan.rooms.map((r) => ({ name: r.name, seats: r.capacity, equipment: r.equipment, accessible: r.accessible })),
    sessions: plan.sessions.map((s) => ({
      title: s.title,
      speaker: s.speakerName ?? s.speakerId,
      people: s.attendance,
      equipment: s.equipment,
      needsAccessible: s.requiresAccessible,
      original: `${fmtTime(s.originalStartMinute)} · ${roomName(plan, s.originalRoomId)}`,
    })),
    roomsClosed: plan.outages.map((o) => `${roomName(plan, o.roomId)} ${fmtTime(o.startMinute)}–${fmtTime(o.endMinute)}`),
    speakersUnavailable: plan.speakerUnavailability.map((b) => `${b.speakerId} ${fmtTime(b.startMinute)}–${fmtTime(b.endMinute)}`),
    prioritySession: priority?.title ?? null,
    fewestChanges: results ? repairFacts(results.A) : null,
    restartSooner: results ? repairFacts(results.B) : null,
    approvedLabel,
    calculated: results !== null,
  };
}
