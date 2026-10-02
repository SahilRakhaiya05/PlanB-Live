import { describe, expect, it } from "vitest";
import { planFacts } from "../src/assistantFacts";
import { demoPlan } from "../src/fixtures";

describe("plan facts for the assistant", () => {
  it("describes the demo closure and includes no secret", () => {
    const facts = planFacts(demoPlan(), null, null);
    const text = JSON.stringify(facts);
    expect(text).not.toMatch(/GEMINI|API_KEY|AQ\./);
    expect(facts.calculated).toBe(false);
    expect(facts.roomsClosed.join(" ")).toMatch(/Main Hall/);
    expect(facts.fewestChanges).toBeNull();
  });
});
