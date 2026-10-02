import { EventPlan, Objective, RepairResponse, parsePlan, planHash, validateAssignment } from "./domain";
import { cloudBase, signedIn, cloudRequest } from "./auth";
export const engineInfo = { remote: !!cloudBase, label: cloudBase ? "Cloud available" : "Browser workspace", detail: "Sample events run in your browser. Sign in to use connected cloud services." };
function localRepair(plan: EventPlan, objective: Objective): Promise<RepairResponse> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./solver.worker.ts", import.meta.url), { type: "module" });
    const timer = window.setTimeout(() => { worker.terminate(); reject(new Error("Planning took too long. Narrow the available rooms or start times and try again.")); }, 15000);
    const finish = () => { window.clearTimeout(timer); worker.terminate(); };
    worker.onmessage = e => { finish(); e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.result); };
    worker.onerror = () => { finish(); reject(new Error("Planning stopped unexpectedly. Please try again.")); };
    worker.postMessage({ plan, objective });
  });
}
export async function repair(plan: EventPlan, objective: Objective): Promise<RepairResponse> {
  const data: RepairResponse = cloudBase && await signedIn() ? await cloudRequest("/repair", { plan, objective }) : await localRepair(plan, objective);
  if (data.inputVersion !== planHash(plan) && data.status !== "INVALID_INPUT") throw new Error("This result does not match your current event. Calculate again.");
  if (data.assignment) {
    const parsed = parsePlan(plan);
    if (!parsed.ok || !validateAssignment(parsed.plan, data.assignment).valid) throw new Error("The proposed schedule did not pass its final checks.");
  }
  return data;
}
