import { SCHEMA_VERSION, Objective, RepairResponse } from "./types";
import { parsePlan, validateAssignment } from "./validate";
import { solve, SolveOptions } from "./solver";
import { computeChanges, computeMetrics } from "./diff";
import { suggestFixes } from "./diagnose";
import { planHash } from "./exports";

/** One entry point used by the Lambda handler, the local dev API and the in-browser engine. */
export function runRepair(input: unknown, objective: Objective, opts?: SolveOptions): RepairResponse {
  const t0 = Date.now();
  const parsed = parsePlan(input);
  if (!parsed.ok) {
    return { schemaVersion: SCHEMA_VERSION, inputVersion: "invalid", objective, status: "INVALID_INPUT", message: "The event could not be read. Fix the issues below and try again.", issues: parsed.issues, elapsedMs: 0, exploredStates: 0 };
  }
  const plan = parsed.plan;
  const inputVersion = planHash(plan);
  if (objective.mode === "B" && !plan.sessions.some((s) => s.id === objective.sessionId)) {
    return { schemaVersion: SCHEMA_VERSION, inputVersion, objective, status: "INVALID_INPUT", message: "The priority session is not part of this event.", issues: [`Unknown session "${objective.sessionId}".`], elapsedMs: 0, exploredStates: 0 };
  }
  const r = solve(plan, objective, opts);
  const base = { schemaVersion: SCHEMA_VERSION, inputVersion, objective, exploredStates: r.exploredStates, elapsedMs: Date.now() - t0 };

  if (r.assignment) {
    // Independent re-check: never present a plan the validator rejects.
    const report = validateAssignment(plan, r.assignment);
    if (!report.valid) {
      return { ...base, status: "INVALID_INPUT", message: "Internal check failed: the computed plan did not pass validation, so it was withheld.", report, issues: ["Solver output rejected by independent validator."] };
    }
    const changes = computeChanges(plan, r.assignment);
    const metrics = computeMetrics(changes);
    const msg = r.status === "OPTIMAL"
      ? "Search completed. This is the best plan under the stated objective."
      : "A valid plan was found before the time budget ended. A better one may exist.";
    return { ...base, status: r.status, message: msg, assignment: r.assignment, changes, metrics, report };
  }
  if (r.status === "SEARCH_LIMIT") {
    return { ...base, status: "SEARCH_LIMIT", message: "The search budget ran out before any valid plan was found. This does not prove the event is impossible." };
  }
  const fixes = suggestFixes(plan, objective);
  const message = r.blockers.length
    ? "No valid schedule exists under the current constraints (direct contradiction found)."
    : "The search finished and found no valid schedule under the current constraints. No minimal conflict set is claimed.";
  return { ...base, status: "INFEASIBLE", message, blockers: r.blockers, fixes };
}
