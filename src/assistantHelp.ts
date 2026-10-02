import { EventPlan } from "./domain";
import { affectedSessions } from "./domain/diagnose";
import { RepairPair } from "./assistantFacts";

export function quickAnswer(question: string, plan: EventPlan, results: RepairPair | null): string | null {
  if (/what (broke|changed)|affected|unavailable/i.test(question)) {
    const affected = affectedSessions(plan);
    return affected.length ? `${affected.length} session${affected.length === 1 ? " is" : "s are"} affected: ${affected.map(a => a.title).join(", ")}. Update availability, then choose Calculate alternatives to compare your options.` : "No sessions are affected by the current availability changes.";
  }
  if (/fewer|fewest|compare|which repair/i.test(question)) {
    if (!results) return "Calculate alternatives first. Then I can compare how many sessions move in each option.";
    if (!results.A.assignment || !results.B.assignment) return "Two valid alternatives are not available yet. Review the planning results and any suggested changes to your requirements.";
    return `Fewest changes moves ${results.A.metrics?.changedSessions ?? 0} sessions, with ${results.A.metrics?.totalDelayMinutes ?? 0} minutes of total delay. Restart sooner moves ${results.B.metrics?.changedSessions ?? 0} sessions, with ${results.B.metrics?.totalDelayMinutes ?? 0} minutes of total delay. Preview either option before approving.`;
  }
  if (/nothing fits|no.*(plan|schedule)|impossible/i.test(question)) return "If no schedule meets all your requirements, review the suggested changes below the results. Choose a change, calculate alternatives again, and approve only when all checks pass.";
  return null;
}
