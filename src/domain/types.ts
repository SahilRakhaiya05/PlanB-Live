import { z } from "zod";

export const SCHEMA_VERSION = 1;
export const SESSION_MINUTES = 30;
export const LIMITS = {
  maxSessions: 200,
  maxRooms: 40,
  maxSlots: 288,
  maxOutages: 200,
  maxSpeakerBlocks: 400,
  maxEquipment: 32,
} as const;

const id = z
  .string()
  .min(1, "ID cannot be empty")
  .max(40, "ID is too long (max 40)")
  .regex(/^[A-Za-z0-9_-]+$/, "IDs may only use letters, numbers, - and _")
  .refine(v => !["__proto__", "constructor", "prototype"].includes(v), "This identifier is reserved");
const label = z.string().min(1, "Label cannot be empty").max(80, "Label is too long (max 80)");
const minute = z.number().int("Minutes must be whole numbers").min(0).max(1440);
const equipment = z.array(z.string().min(1).max(30)).max(LIMITS.maxEquipment);

export const RoomSchema = z.object({
  id,
  name: label,
  capacity: z.number().int().min(1).max(5000),
  equipment,
  accessible: z.boolean(),
});

export const SessionSchema = z.object({
  id,
  title: label,
  speakerId: id,
  speakerName: z.string().min(1).max(60).optional(),
  attendance: z.number().int().min(0).max(5000),
  equipment,
  requiresAccessible: z.boolean(),
  durationMinutes: z.number().int().min(5).max(480),
  originalStartMinute: minute,
  originalRoomId: id,
  earliestStartMinute: minute,
  latestStartMinute: minute,
  lockedRoomId: id.optional(),
  lockedStartMinute: minute.optional(),
});

export const OutageSchema = z.object({ roomId: id, startMinute: minute, endMinute: minute });
export const SpeakerBlockSchema = z.object({ speakerId: id, startMinute: minute, endMinute: minute });

export const EventPlanSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION, { message: `schemaVersion must be ${SCHEMA_VERSION}` }),
  fictional: z.boolean().optional(),
  id,
  title: label,
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "localDate must look like 2026-10-03"),
  timezone: z.string().min(1).max(60),
  startSlots: z.array(minute).min(1).max(LIMITS.maxSlots, `At most ${LIMITS.maxSlots} start slots`),
  endMinute: minute,
  rooms: z.array(RoomSchema).min(1).max(LIMITS.maxRooms, `At most ${LIMITS.maxRooms} rooms`),
  sessions: z.array(SessionSchema).min(1).max(LIMITS.maxSessions, `At most ${LIMITS.maxSessions} sessions`),
  outages: z.array(OutageSchema).max(LIMITS.maxOutages),
  speakerUnavailability: z.array(SpeakerBlockSchema).max(LIMITS.maxSpeakerBlocks),
  selectedSessionId: id.optional(),
});

export type Room = z.infer<typeof RoomSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type Outage = z.infer<typeof OutageSchema>;
export type SpeakerBlock = z.infer<typeof SpeakerBlockSchema>;
export type EventPlan = z.infer<typeof EventPlanSchema>;

export interface Placement {
  roomId: string;
  startMinute: number;
}
export type Assignment = Record<string, Placement>;

export type Objective = { mode: "A" } | { mode: "B"; sessionId: string };
export type SolverStatus = "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "SEARCH_LIMIT" | "INVALID_INPUT";

export type CheckId =
  | "complete"
  | "slot"
  | "window"
  | "not-earlier"
  | "event-end"
  | "capacity"
  | "equipment"
  | "accessibility"
  | "room-availability"
  | "speaker-availability"
  | "room-conflict"
  | "speaker-conflict"
  | "locks";

export interface Violation {
  sessionIds: string[];
  roomId?: string;
  message: string;
}
export interface CheckResult {
  id: CheckId;
  label: string;
  passed: boolean;
  violations: Violation[];
}
export interface ConstraintReport {
  valid: boolean;
  checks: CheckResult[];
}

export interface ChangeRecord {
  sessionId: string;
  title: string;
  from: Placement;
  to: Placement;
  delayMinutes: number;
  roomChanged: boolean;
  timeChanged: boolean;
}
export interface Metrics {
  changedSessions: number;
  totalDelayMinutes: number;
  roomChanges: number;
  maxDelayMinutes: number;
}

export interface Blocker {
  sessionId: string;
  title: string;
  summary: string;
  perRoom: { roomId: string; roomName: string; reasons: string[] }[];
}

export interface FixSuggestion {
  id: string;
  label: string;
  detail: string;
  /** Edits the organizer can apply explicitly (one, or two that only work together). */
  patches: PlanPatch[];
  resultingChangedSessions: number;
  resultingTotalDelay: number;
}
export type PlanPatch =
  | { kind: "room"; roomId: string; set: Partial<Pick<Room, "capacity" | "accessible" | "equipment">> }
  | { kind: "session"; sessionId: string; set: Partial<Pick<Session, "requiresAccessible" | "equipment">> }
  | { kind: "addSlot" }
  | { kind: "removeOutage"; index: number };

export interface RepairResponse {
  schemaVersion: number;
  inputVersion: string;
  objective: Objective;
  status: SolverStatus;
  message: string;
  assignment?: Assignment;
  metrics?: Metrics;
  changes?: ChangeRecord[];
  report?: ConstraintReport;
  blockers?: Blocker[];
  fixes?: FixSuggestion[];
  issues?: string[];
  elapsedMs: number;
  exploredStates: number;
}
