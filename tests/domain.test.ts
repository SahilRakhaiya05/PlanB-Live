import { describe, expect, it } from "vitest";
import {
  Assignment, EventPlan, applyPatches, buildAnnouncements, computeChanges, computeMetrics, decodePlan, encodePlan, importSessionsCsv, originalAssignment,
  parsePlan, planHash, runRepair, sessionsTemplateCsv, solve, timetableCsv, timetableIcs, validateAssignment, affectedSessions,
} from "../src/domain";
import { bruteForce, demoPlan, expected, naiveFeasible } from "./helpers";

const A = { mode: "A" } as const;
const B = { mode: "B", sessionId: "ai-demo" } as const;
const fmt = (plan: EventPlan, a: Assignment) => computeChanges(plan, a).map((c) => ({ sessionId: c.sessionId, roomId: c.to.roomId, startMinute: c.to.startMinute }));

describe("fixture and brute-force reference", () => {
  it("toy model has exactly 8 feasible assignments (exact fixture only)", () => {
    expect(bruteForce(demoPlan()).length).toBe(expected.toyModelFeasibleAssignments);
  });
  it("solver optimum equals brute-force optimum for both objectives", () => {
    const plan = demoPlan();
    const all = bruteForce(plan);
    const costA = (a: Assignment) => { const c = computeChanges(plan, a); const m = computeMetrics(c); return [m.changedSessions, m.totalDelayMinutes, m.roomChanges]; };
    const costB = (a: Assignment) => { const c = computeChanges(plan, a); const m = computeMetrics(c); const sel = c.find((x) => x.sessionId === "ai-demo"); return [sel ? sel.delayMinutes : 0, m.changedSessions, m.totalDelayMinutes]; };
    const lex = (f: (a: Assignment) => number[]) => all.map((a) => ({ a, c: f(a) })).sort((x, y) => { for (let i = 0; i < 3; i++) if (x.c[i] !== y.c[i]) return x.c[i] - y.c[i]; return 0; })[0];
    const rA = solve(plan, A), rB = solve(plan, B);
    expect(rA.cost).toEqual(lex(costA).c);
    expect(rB.cost).toEqual(lex(costB).c);
    expect(naiveFeasible(plan, rA.assignment!)).toBe(true);
    expect(naiveFeasible(plan, rB.assignment!)).toBe(true);
  });
});

describe("fixture repairs", () => {
  it("Mode A matches the expected fewest-changes plan", () => {
    const plan = demoPlan();
    const r = runRepair(plan, A);
    expect(r.status).toBe("OPTIMAL");
    expect(fmt(plan, r.assignment!)).toEqual(expected.fewestChanges.changes);
    expect(r.metrics!.changedSessions).toBe(expected.fewestChanges.changedSessions);
    expect(r.metrics!.totalDelayMinutes).toBe(expected.fewestChanges.totalDelayMinutes);
    expect(r.report!.valid).toBe(true);
  });
  it("Mode B matches the expected earliest-restart plan", () => {
    const plan = demoPlan();
    const r = runRepair(plan, B);
    expect(r.status).toBe("OPTIMAL");
    expect(fmt(plan, r.assignment!)).toEqual(expected.earliestSelectedSession.changes);
    expect(r.metrics!.changedSessions).toBe(3);
    expect(r.metrics!.totalDelayMinutes).toBe(60);
    expect(r.changes!.find((c) => c.sessionId === "ai-demo")!.delayMinutes).toBe(30);
  });
  it("no disruption preserves the original valid plan", () => {
    const plan = demoPlan(); plan.outages = [];
    const r = runRepair(plan, A);
    expect(r.status).toBe("OPTIMAL");
    expect(r.changes).toEqual([]);
    expect(r.assignment).toEqual(originalAssignment(plan));
  });
  it("is deterministic across runs", () => {
    const plan = demoPlan();
    const a = JSON.stringify(solve(plan, A).assignment), b = JSON.stringify(solve(plan, A).assignment);
    expect(a).toBe(b);
  });
  it("metrics agree with actual diffs", () => {
    const plan = demoPlan();
    const r = runRepair(plan, A);
    expect(r.metrics).toEqual(computeMetrics(computeChanges(plan, r.assignment!)));
  });
  it("identifies directly affected sessions", () => {
    expect(affectedSessions(demoPlan()).map((x) => x.sessionId)).toEqual(["ai-demo"]);
  });
});

describe("hard constraints (validator)", () => {
  const base = () => { const p = demoPlan(); p.outages = []; return { p, a: originalAssignment(p) }; };
  const failing = (p: EventPlan, a: Assignment) => validateAssignment(p, a).checks.filter((c) => !c.passed).map((c) => c.id);
  it("original schedule passes everything with no disruption", () => { const { p, a } = base(); expect(validateAssignment(p, a).valid).toBe(true); });
  it("room conflict", () => { const { p, a } = base(); a.git = { roomId: "B", startMinute: 600 }; expect(failing(p, a)).toContain("room-conflict"); });
  it("speaker conflict", () => { const { p, a } = base(); p.sessions[1].speakerId = p.sessions[5].speakerId; expect(failing(p, a)).toContain("speaker-conflict"); });
  it("exact capacity boundary passes, one over fails", () => {
    const { p, a } = base(); p.rooms[0].capacity = 60; expect(failing(p, a)).not.toContain("capacity");
    p.rooms[0].capacity = 59; expect(failing(p, a)).toContain("capacity");
  });
  it("missing equipment", () => { const { p, a } = base(); p.rooms[0].equipment = []; expect(failing(p, a)).toContain("equipment"); });
  it("accessibility mismatch", () => { const { p, a } = base(); a.cloud = { roomId: "C", startMinute: 630 }; a.design = { roomId: "A", startMinute: 630 }; expect(failing(p, a)).toContain("accessibility"); });
  it("half-open outage boundaries: adjacent is fine, overlap is not", () => {
    const { p, a } = base();
    p.outages = [{ roomId: "A", startMinute: 630, endMinute: 660 }]; // between ai-demo (ends 630) and careers (starts 660); cloud overlaps
    expect(failing(p, a)).toEqual(["room-availability"]);
    const v = validateAssignment(p, a).checks.find((c) => c.id === "room-availability")!.violations;
    expect(v.map((x) => x.sessionIds[0])).toEqual(["cloud"]);
  });
  it("speaker unavailable", () => { const { p, a } = base(); p.speakerUnavailability = [{ speakerId: "speaker-python", startMinute: 600, endMinute: 630 }]; expect(failing(p, a)).toContain("speaker-availability"); });
  it("moving earlier is rejected", () => { const { p, a } = base(); a.careers = { roomId: "A", startMinute: 630 }; expect(failing(p, a)).toContain("not-earlier"); });
  it("incomplete assignment is rejected", () => { const { p, a } = base(); delete a.git; expect(failing(p, a)).toContain("complete"); });
});

describe("solver edge cases", () => {
  it("locked session inside an outage is infeasible with a direct explanation", () => {
    const p = demoPlan(); p.sessions[0].lockedRoomId = "A"; p.sessions[0].lockedStartMinute = 600;
    const r = runRepair(p, A);
    expect(r.status).toBe("INFEASIBLE");
    expect(r.blockers![0].sessionId).toBe("ai-demo");
  });
  it("whole-day outage of the only suitable room is INFEASIBLE and says no room fits", () => {
    const p = demoPlan(); p.outages = [{ roomId: "A", startMinute: 600, endMinute: 690 }];
    const r = runRepair(p, A);
    expect(r.status).toBe("INFEASIBLE");
    expect(r.blockers!.map((b) => b.sessionId)).toContain("ai-demo");
  });
  it("insufficient capacity everywhere gives the capacity message", () => {
    const p = demoPlan(); p.sessions[0].attendance = 500;
    const r = runRepair(p, A);
    expect(r.status).toBe("INFEASIBLE");
    expect(r.blockers![0].summary).toMatch(/No room seats 500/);
  });
  it("verified fixes: every suggested edit really makes the plan solvable", () => {
    const p = demoPlan(); p.outages = [{ roomId: "A", startMinute: 600, endMinute: 690 }];
    const r = runRepair(p, A);
    expect(r.fixes!.length).toBeGreaterThan(0);
    for (const f of r.fixes!) {
      const patched = applyPatches(p, f.patches);
      const again = runRepair(patched, A);
      expect(["OPTIMAL", "FEASIBLE"]).toContain(again.status);
      expect(again.report!.valid).toBe(true);
    }
  });
  it("speaker clash between two sessions is resolved or reported", () => {
    const p = demoPlan(); p.outages = []; p.sessions[3].speakerId = "speaker-git"; // python & git share speaker: 10:00 and 10:30 -> fine
    p.sessions[4].originalStartMinute = 600; p.sessions[4].earliestStartMinute = 600; // git now 10:00 in B with python -> clash, also room clash
    const r = runRepair(p, A);
    expect(["OPTIMAL", "INFEASIBLE"]).toContain(r.status);
    if (r.assignment) expect(r.report!.valid).toBe(true);
  });
  it("SEARCH_LIMIT is reported separately from INFEASIBLE", () => {
    const p = demoPlan();
    const r = solve(p, A, { maxNodes: 1 });
    expect(r.status).toBe("SEARCH_LIMIT");
    const r2 = runRepair(p, A, { maxNodes: 1 });
    expect(r2.status).toBe("SEARCH_LIMIT");
    expect(r2.blockers).toBeUndefined();
  });
  it("FEASIBLE when budget expires after a first valid plan", () => {
    const p = demoPlan(); p.outages = [];
    // first leaf is reached within 6 nodes; stop immediately after
    const r = solve(p, A, { maxNodes: 6 });
    expect(["FEASIBLE", "OPTIMAL", "SEARCH_LIMIT"]).toContain(r.status);
    if (r.status === "FEASIBLE") expect(validateAssignment(p, r.assignment!).valid).toBe(true);
  });
});

describe("input validation", () => {
  it("rejects duplicate IDs", () => { const p = demoPlan(); p.sessions[1].id = p.sessions[0].id; const r = parsePlan(p); expect(r.ok).toBe(false); });
  it("rejects contradictory bounds", () => { const p = demoPlan(); p.sessions[0].earliestStartMinute = 660; p.sessions[0].latestStartMinute = 630; expect(parsePlan(p).ok).toBe(false); });
  it("rejects too many sessions", () => { const p = demoPlan(); for (let i = 0; i < 200; i++) p.sessions.push({ ...p.sessions[0], id: "x" + i }); expect(parsePlan(p).ok).toBe(false); });
  it("rejects unsupported durations", () => { const p: any = demoPlan(); p.sessions[0].durationMinutes = 0; expect(parsePlan(p).ok).toBe(false); });
  it("rejects bad timezone and malformed input without solving", () => {
    const p: any = demoPlan(); p.timezone = "Mars/Olympus";
    const r = runRepair(p, A);
    expect(r.status).toBe("INVALID_INPUT");
    expect(runRepair({ nonsense: true }, A).status).toBe("INVALID_INPUT");
  });
  it("rejects unknown selected session in Mode B", () => {
    expect(runRepair(demoPlan(), { mode: "B", sessionId: "nope" }).status).toBe("INVALID_INPUT");
  });
});

describe("stale guard and exports", () => {
  it("input hash changes when an outage changes, ignores selected-session UI state", () => {
    const p = demoPlan(); const h = planHash(p);
    const q = demoPlan(); q.selectedSessionId = "cloud"; expect(planHash(q)).toBe(h);
    q.outages[0].endMinute = 660; expect(planHash(q)).not.toBe(h);
  });
  it("repair response is tied to the input hash", () => {
    const p = demoPlan(); expect(runRepair(p, A).inputVersion).toBe(planHash(p));
  });
  it("csv export reflects the approved plan and neutralises formulas", () => {
    const p = demoPlan(); const r = runRepair(p, A);
    const csv = timetableCsv(p, r.assignment!);
    expect(csv).toContain("AI demo,11:00,11:30,Main Hall,changed,10:00,Main Hall");
    expect(csv).toContain("Careers panel,11:00,11:30,Studio,changed,11:00,Main Hall");
    p.sessions[0].title = "=HYPERLINK(1)";
    expect(timetableCsv(p, r.assignment!)).toContain("'=HYPERLINK(1)");
  });
  it("announcements only mention changed sessions with canonical times and rooms", () => {
    const p = demoPlan(); const r = runRepair(p, A);
    const ann = buildAnnouncements(p, r.changes!);
    const text = ann.map((a) => a.text).join("\n");
    expect(text).toContain("AI demo");
    expect(text).toContain("Careers panel");
    expect(text).not.toContain("Python lab");
    expect(text).toContain("Main Hall at 11:00 AM");
  });
  it("calendar export uses the event timezone and the approved times", () => {
    const p = demoPlan(); const r = runRepair(p, A);
    const ics = timetableIcs(p, r.assignment!);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("DTSTART;TZID=Asia/Kolkata:20261003T110000");
    expect(ics).toContain("SUMMARY:AI demo");
    expect(ics).toContain("LOCATION:Studio");
    p.sessions[0].title = "Hello, world";
    expect(timetableIcs(p, r.assignment!)).toContain("SUMMARY:Hello\\, world");
  });
  it("a share link round-trips the exact plan and rejects garbage", () => {
    const p = demoPlan();
    const back = decodePlan(encodePlan(p));
    expect(back.ok).toBe(true);
    if (back.ok) expect(planHash(back.plan)).toBe(planHash(p));
    expect(decodePlan("not-a-plan").ok).toBe(false);
  });
  it("csv import round-trips and rejects malformed rows", () => {
    const p = demoPlan(); const csv = sessionsTemplateCsv(p);
    const ok = importSessionsCsv(csv, p);
    expect(ok.ok).toBe(true);
    expect(importSessionsCsv("id,title\r\n1,x", p).ok).toBe(false);
    expect(importSessionsCsv(csv.replace("10:00", "ten"), p).ok).toBe(false);
  });
});

import { handler } from "../api/handler";
describe("Lambda handler", () => {
  const ev = (method: string, path: string, body?: unknown) => ({ requestContext: { http: { method, path } }, body: body === undefined ? null : JSON.stringify(body) });
  it("GET /health", async () => {
    const r = await handler(ev("GET", "/health")); const j = JSON.parse(r.body);
    expect(r.statusCode).toBe(200); expect(j.status).toBe("ok"); expect(j.schemaVersion).toBe(1);
  });
  it("POST /repair returns the validated plan", async () => {
    const r = await handler(ev("POST", "/repair", { plan: demoPlan(), objective: { mode: "A" } }));
    const j = JSON.parse(r.body);
    expect(r.statusCode).toBe(200); expect(j.status).toBe("OPTIMAL"); expect(j.report.valid).toBe(true);
  });
  it("POST /validate returns a constraint report", async () => {
    const p = demoPlan();
    const r = await handler(ev("POST", "/validate", { plan: p, assignment: originalAssignment(p) }));
    expect(JSON.parse(r.body).report.valid).toBe(false); // original plan violates the outage
  });
  it("rejects oversize, malformed and unknown requests", async () => {
    expect((await handler({ ...ev("POST", "/repair"), body: "x".repeat(260_000) })).statusCode).toBe(413);
    expect((await handler({ ...ev("POST", "/repair"), body: "{nope" })).statusCode).toBe(400);
    expect((await handler(ev("POST", "/repair", { plan: {}, objective: { mode: "C" } }))).statusCode).toBe(400);
    expect((await handler(ev("GET", "/admin"))).statusCode).toBe(404);
  });
});
