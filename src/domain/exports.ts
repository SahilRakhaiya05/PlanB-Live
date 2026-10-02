import { Assignment, ChangeRecord, EventPlan, SCHEMA_VERSION, SESSION_MINUTES, LIMITS } from "./types";
import { fmtTime, parseHHMM, toHHMM } from "./time";
import { parsePlan } from "./validate";

/* ---------------- version hash (non-cryptographic, stable) ---------------- */

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
/** Identifies the exact inputs a repair was computed from (selected-session UI choice excluded). */
export function planHash(plan: EventPlan): string {
  const { selectedSessionId: _ignored, ...rest } = plan;
  return cyrb53(stable(rest)).toString(16).padStart(14, "0").slice(0, 10);
}

/* ---------------- revised timetable exports ---------------- */

function csvCell(v: string | number): string {
  let s = String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function timetableCsv(plan: EventPlan, assignment: Assignment): string {
  const roomName = new Map(plan.rooms.map((r) => [r.id, r.name]));
  const header = ["session", "start", "end", "room", "status", "original_start", "original_room"];
  const rows = plan.sessions
    .map((s) => ({ s, a: assignment[s.id] }))
    .sort((x, y) => x.a.startMinute - y.a.startMinute || (roomName.get(x.a.roomId) ?? "").localeCompare(roomName.get(y.a.roomId) ?? ""))
    .map(({ s, a }) => {
      const changed = a.startMinute !== s.originalStartMinute || a.roomId !== s.originalRoomId;
      return [s.title, toHHMM(a.startMinute), toHHMM(a.startMinute + s.durationMinutes), roomName.get(a.roomId) ?? a.roomId, changed ? "changed" : "unchanged", toHHMM(s.originalStartMinute), roomName.get(s.originalRoomId) ?? s.originalRoomId].map(csvCell).join(",");
    });
  return [header.join(","), ...rows].join("\r\n") + "\r\n";
}

export function approvedJson(plan: EventPlan, assignment: Assignment, inputVersion: string, objectiveLabel: string): string {
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, kind: "planb-live-approved-plan", inputVersion, objective: objectiveLabel, event: { id: plan.id, title: plan.title, localDate: plan.localDate, timezone: plan.timezone }, assignments: assignment, plan }, null, 2);
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}
function foldIcs(line: string): string {
  if (line.length <= 73) return line;
  const parts = [line.slice(0, 73)];
  for (let i = 73; i < line.length; i += 72) parts.push(" " + line.slice(i, i + 72));
  return parts.join("\r\n");
}
function icsLocal(date: string, minute: number): string {
  const calendar = new Date(`${date}T12:00:00Z`);
  calendar.setUTCDate(calendar.getUTCDate() + Math.floor(minute / 1440));
  const [y, m, d] = calendar.toISOString().slice(0, 10).split("-");
  const hh = String(Math.floor(minute / 60) % 24).padStart(2, "0");
  const mm = String(minute % 60).padStart(2, "0");
  return `${y}${m}${d}T${hh}${mm}00`;
}

/** Revised timetable as an iCalendar file. Times stay in the event timezone. */
export function timetableIcs(plan: EventPlan, assignment: Assignment): string {
  const roomName = new Map(plan.rooms.map((r) => [r.id, r.name]));
  const tzOk = /^[A-Za-z0-9_/+-]+$/.test(plan.timezone);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PlanB Live//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const s of plan.sessions) {
    const a = assignment[s.id];
    if (!a) continue;
    const moved = a.startMinute !== s.originalStartMinute || a.roomId !== s.originalRoomId;
    const where = roomName.get(a.roomId) ?? a.roomId;
    const was = `${roomName.get(s.originalRoomId) ?? s.originalRoomId} at ${fmtTime(s.originalStartMinute)}`;
    const start = icsLocal(plan.localDate, a.startMinute);
    const end = icsLocal(plan.localDate, a.startMinute + s.durationMinutes);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${plan.id}-${s.id}@planb.live`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(tzOk ? `DTSTART;TZID=${plan.timezone}:${start}` : `DTSTART:${start}`);
    lines.push(tzOk ? `DTEND;TZID=${plan.timezone}:${end}` : `DTEND:${end}`);
    lines.push(foldIcs(`SUMMARY:${icsEscape(s.title)}`));
    lines.push(foldIcs(`LOCATION:${icsEscape(where)}`));
    lines.push(foldIcs(`DESCRIPTION:${icsEscape(moved ? `Moved. It was ${was}. Approved with PlanB Live. Nothing was sent automatically.` : `Unchanged from the original plan (${was}).`)}`));
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(token: string): string {
  const pad = token.length % 4 === 0 ? "" : "=".repeat(4 - (token.length % 4));
  const bin = atob(token.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Compact token for a URL hash. Opens the exact schedule, including disruptions. */
export function encodePlan(plan: EventPlan): string {
  return toBase64Url(JSON.stringify(plan));
}
export function decodePlan(token: string): { ok: true; plan: EventPlan } | { ok: false; issues: string[] } {
  try {
    const raw = JSON.parse(fromBase64Url(token)) as unknown;
    return parsePlan(raw);
  } catch {
    return { ok: false, issues: ["This link does not contain a readable PlanB schedule."] };
  }
}

/* ---------------- template announcements (no model needed) ---------------- */

export interface Announcement {
  id: string;
  audience: "attendees" | "speaker" | "room-team";
  heading: string;
  text: string;
}

export function buildAnnouncements(plan: EventPlan, changes: ChangeRecord[]): Announcement[] {
  const roomName = new Map(plan.rooms.map((r) => [r.id, r.name]));
  const out: Announcement[] = [];
  const when = (p: { roomId: string; startMinute: number }) => `${roomName.get(p.roomId)} at ${fmtTime(p.startMinute)}`;
  for (const c of changes) {
    const s = plan.sessions.find((x) => x.id === c.sessionId)!;
    out.push({
      id: `att-${c.sessionId}`, audience: "attendees", heading: `Attendees: ${c.title}`,
      text: `Schedule update for ${plan.title}: "${c.title}" has moved from ${when(c.from)} to ${when(c.to)}. Everything else you planned to attend is unchanged unless you hear otherwise.`,
    });
    out.push({
      id: `spk-${c.sessionId}`, audience: "speaker", heading: `Speaker: ${s.speakerName ?? c.title}`,
      text: `Hi${s.speakerName ? " " + s.speakerName : ""}, we had to adjust the schedule. Your session "${c.title}" now runs at ${fmtTime(c.to.startMinute)} in ${roomName.get(c.to.roomId)} (it was ${fmtTime(c.from.startMinute)} in ${roomName.get(c.from.roomId)}). Please confirm you can make the new slot.`,
    });
  }
  const touched = new Set<string>();
  changes.forEach((c) => { touched.add(c.from.roomId); touched.add(c.to.roomId); });
  for (const roomId of touched) {
    const leaving = changes.filter((c) => c.from.roomId === roomId && (c.to.roomId !== roomId || c.to.startMinute !== c.from.startMinute));
    const arriving = changes.filter((c) => c.to.roomId === roomId && (c.from.roomId !== roomId || c.from.startMinute !== c.to.startMinute));
    const lines: string[] = [];
    leaving.forEach((c) => lines.push(`- Remove "${c.title}" from ${fmtTime(c.from.startMinute)}.`));
    arriving.forEach((c) => lines.push(`- Set up for "${c.title}" at ${fmtTime(c.to.startMinute)}.`));
    for (const o of plan.outages.filter((o) => o.roomId === roomId))
      lines.push(`- ${roomName.get(roomId)} is unavailable ${fmtTime(o.startMinute)}–${fmtTime(o.endMinute)}.`);
    out.push({ id: `room-${roomId}`, audience: "room-team", heading: `Room team: ${roomName.get(roomId)}`, text: `Changes for ${roomName.get(roomId)}:\n${lines.join("\n")}` });
  }
  return out;
}

/* ---------------- sessions CSV import ---------------- */

export const SESSIONS_CSV_HEADER = "id,title,speakerId,attendance,equipment,requiresAccessible,startTime,roomId,earliestStart,latestStart";

export function sessionsTemplateCsv(plan: EventPlan): string {
  const rows = plan.sessions.map((s) => [s.id, s.title, s.speakerId, s.attendance, s.equipment.join(";"), s.requiresAccessible ? "yes" : "no", toHHMM(s.originalStartMinute), s.originalRoomId, toHHMM(s.earliestStartMinute), toHHMM(s.latestStartMinute)].map(csvCell).join(","));
  return [SESSIONS_CSV_HEADER + ",durationMinutes", ...rows.map((row, i) => row + "," + plan.sessions[i].durationMinutes)].join("\r\n") + "\r\n";
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/** Replace the sessions of `base` with rows from a CSV. Rooms, slots and disruptions come from `base`. */
export function importSessionsCsv(text: string, base: EventPlan): { ok: true; plan: EventPlan } | { ok: false; issues: string[] } {
  if (text.length > 200_000) return { ok: false, issues: ["File is too large (max 200 KB)."] };
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return { ok: false, issues: ["The file is empty."] };
  const head = splitCsvLine(lines[0]);
  const need = SESSIONS_CSV_HEADER.split(",");
  const missing = need.filter((h) => !head.includes(h));
  if (missing.length) return { ok: false, issues: [`Missing columns: ${missing.join(", ")}. Download the template to see the expected header.`] };
  if (lines.length - 1 > LIMITS.maxSessions) return { ok: false, issues: [`At most ${LIMITS.maxSessions} sessions are supported per event day.`] };
  const issues: string[] = [];
  const sessions: EventPlan["sessions"] = [];
  lines.slice(1).forEach((line, idx) => {
    const cells = splitCsvLine(line);
    const get = (k: string) => cells[head.indexOf(k)] ?? "";
    const row = idx + 2;
    const start = parseHHMM(get("startTime")), early = parseHHMM(get("earliestStart")), late = parseHHMM(get("latestStart"));
    if (start === null || early === null || late === null) { issues.push(`Row ${row}: times must look like 10:30.`); return; }
    const att = Number(get("attendance"));
    if (!Number.isInteger(att) || att < 0) { issues.push(`Row ${row}: attendance must be a whole number.`); return; }
    sessions.push({
      id: get("id"), title: get("title"), speakerId: get("speakerId"), attendance: att,
      equipment: get("equipment") ? get("equipment").split(";").map((x) => x.trim()).filter(Boolean) : [],
      requiresAccessible: /^(yes|true|1)$/i.test(get("requiresAccessible")),
      durationMinutes: get("durationMinutes") ? Number(get("durationMinutes")) : SESSION_MINUTES, originalStartMinute: start, originalRoomId: get("roomId"), earliestStartMinute: early, latestStartMinute: late,
    });
  });
  if (issues.length) return { ok: false, issues };
  const candidate = { ...base, fictional: false, outages: [], speakerUnavailability: [], selectedSessionId: sessions[0]?.id, sessions };
  const parsed = parsePlan(candidate);
  return parsed.ok ? { ok: true, plan: parsed.plan } : parsed;
}
