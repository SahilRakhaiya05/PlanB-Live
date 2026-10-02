import demo from "./demo-scenario.json";
import { EventPlan, parsePlan } from "../domain";

function load(extra?: (p: EventPlan) => void): EventPlan {
  const r = parsePlan(demo);
  if (!r.ok) throw new Error("Bundled demo is invalid: " + r.issues.join("; "));
  const p = structuredClone(r.plan);
  extra?.(p);
  return p;
}
/** Fictional workshop day with Main Hall closed 10:00-10:30. */
export const demoPlan = () => load();
/** Same fictional day, but Main Hall (the only room that fits the 60-person session) is closed all day. */
export const impossiblePlan = () => load((p) => { p.outages = [{ roomId: "A", startMinute: 600, endMinute: 690 }]; });
