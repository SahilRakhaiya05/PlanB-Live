import { Assignment, EventPlan, parsePlan, planHash, validateAssignment } from "./domain";

const KEY = "planb-live:draft:v1";
export interface Approved {
  assignment: Assignment;
  version: string;
  label: string;
}
export interface Draft {
  plan: EventPlan;
  approved: Approved | null;
}
export function saveDraft(d: Draft) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* storage may be unavailable */ }
}
export function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    const p = parsePlan(j.plan);
    if (!p.ok) return null;
    let approved: Approved | null = null;
    try {
      const a = j.approved;
      if (a && typeof a.label === "string" && a.version === planHash(p.plan) &&
        a.assignment && typeof a.assignment === "object" &&
        validateAssignment(p.plan, a.assignment).valid) approved = a;
    } catch { /* Keep the draft even if its saved approval is damaged. */ }
    return { plan: p.plan, approved };
  } catch { return null; }
}
export function clearDraft() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
