import { describe, expect, it } from 'vitest';
import { buildContext } from './context';
import { monthReport, weeklyCheckIn } from './reports';
import { ex, history, input } from './fixtures';

describe('reports', () => {
  const H = ['2026-08', '2026-09', '2026-10'];
  it('month report: totals match flows; worst categories vs budget', () => {
    const ctx = buildContext(input([...history(H), ex('2026-10-20', 'food', 60_000, 'Dinner'), ex('2026-10-21', 'unn', 20_000, 'Gadget')], '2026-11-05'));
    const r = monthReport(ctx, '2026-10')!;
    const f = ctx.flows.get('2026-10')!;
    expect([r.income, r.expenses, r.saved, r.freeCash]).toEqual([f.income, f.expenses, f.saved, f.freeCash]);
    expect(r.worst[0]).toMatchObject({ name: 'Food / Dining out' });
    expect(r.avoidable).toBe(2_000_000);
    expect(r.verdict.length).toBeGreaterThan(10);
  });
  it('weekly check-in counts only the last 7 days of dated spending', () => {
    const ctx = buildContext(input([...history(H), ex('2026-11-10', 'food', 10_000), ex('2026-11-01', 'food', 99_000)], '2026-11-12'));
    expect(weeklyCheckIn(ctx, []).spent).toBe(1_000_000);
  });
});
