import { expect, it } from "vitest";
import { applyPatches, runRepair } from "../src/domain";
import { demoPlan } from "./helpers";

it("impossible case: every suggested fix (single or paired) is verified solvable", () => {
  const p = demoPlan(); p.outages = [{ roomId: "A", startMinute: 600, endMinute: 690 }];
  const r = runRepair(p, { mode: "A" });
  expect(r.status).toBe("INFEASIBLE");
  expect(r.fixes!.length).toBeGreaterThan(1);
  for (const f of r.fixes!) {
    const again = runRepair(applyPatches(p, f.patches), { mode: "A" });
    expect(["OPTIMAL", "FEASIBLE"]).toContain(again.status);
    expect(again.report!.valid).toBe(true);
  }
});
