import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDraft, saveDraft } from '../src/storage';
import { demoPlan } from '../src/fixtures';
import { planHash, runRepair } from '../src/domain';
import { quickAnswer } from '../src/assistantHelp';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v) });
});
describe('saved approvals', () => {
  it('restores a valid checked approval', () => {
    const plan = demoPlan();
    const result = runRepair(plan, { mode: 'A' });
    saveDraft({ plan, approved: { assignment: result.assignment!, label: 'Fewest changes', version: planHash(plan) } });
    expect(loadDraft()?.approved?.assignment).toEqual(result.assignment);
  });
  it('keeps the event but discards an invalid approval', () => {
    const plan = demoPlan();
    saveDraft({ plan, approved: { assignment: {}, label: 'Fewest changes', version: planHash(plan) } });
    expect(loadDraft()?.plan).toEqual(plan);
    expect(loadDraft()?.approved).toBeNull();
  });
  it('discards an approval tied to older inputs', () => {
    const plan = demoPlan();
    saveDraft({ plan, approved: { assignment: runRepair(plan, { mode: 'A' }).assignment!, label: 'Fewest changes', version: 'old' } });
    expect(loadDraft()?.approved).toBeNull();
  });
});
it('quick help uses actual results and never invents an answer', () => {
  const plan = demoPlan();
  expect(quickAnswer('Which repair moves fewer sessions?', plan, null)).toContain('Calculate alternatives first');
  expect(quickAnswer('What broke?', plan, null)).toContain('AI demo');
  expect(quickAnswer('What is the weather?', plan, null)).toBeNull();
});
