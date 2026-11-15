import { SPEND_GROUPS, shiftMonth } from '../context';
import { crc, make, pct, rule } from './rule';

/** R14 Lifestyle creep: 3-month average expenses growing faster than 3-month average income, 2+ months running. */
export const R14 = rule({
  id: 'R14', name: 'Lifestyle creep', trigger: '3-month avg expenses grow faster than 3-month avg income for 2+ months',
  defaults: { months: 2 }, labels: { months: 'Months in a row' },
  evaluate(ctx, p) {
    const complete = (k: number) => shiftMonth(ctx.month, -k);
    const avg3 = (end: number, f: 'income' | 'expenses') => { const ms = [end, end + 1, end + 2].map(complete).map((mk) => ctx.flows.get(mk)); return ms.every(Boolean) ? ms.reduce((s, x) => s + x![f], 0) / 3 : null; };
    let streak = 0;
    for (let k = 1; k <= p.months; k++) {
      const e1 = avg3(k, 'expenses'), e0 = avg3(k + 1, 'expenses'), i1 = avg3(k, 'income'), i0 = avg3(k + 1, 'income');
      if (e1 === null || e0 === null || i1 === null || i0 === null || !e0 || !i0) return [];
      if (e1 / e0 > i1 / i0) streak++;
    }
    if (streak < p.months) return [];
    const now = [1, 2, 3].map(complete), before = [4, 5, 6].map(complete);
    const g = (ms: string[], grp: string) => ms.reduce((s, mk) => s + [...(ctx.flows.get(mk)?.byCategory ?? [])].filter(([id]) => ctx.cat.get(id)?.group === grp).reduce((a, [, v]) => a + Math.max(0, v), 0), 0) / 3;
    const grew = SPEND_GROUPS.map((grp) => ({ grp, d: g(now, grp) - g(before, grp) })).filter((x) => x.d > 0).sort((a, b) => b.d - a.d);
    const e1 = avg3(1, 'expenses')!, e0 = avg3(2, 'expenses')!, i1 = avg3(1, 'income')!, i0 = avg3(2, 'income')!;
    return [make({
      ruleId: 'R14', severity: 'heads_up', title: 'Spending is growing faster than income',
      body: ctx.say(`3-month average spending ${pct(e1 / e0 - 1)} vs income ${pct(i1 / i0 - 1)}. Grew most: ${grew.slice(0, 2).map((x) => `${x.grp} +${crc(x.d)}/month`).join(', ') || '—'}.`, `Spending has crept up a little faster than income lately, mostly in ${grew[0]?.grp ?? 'a few areas'}.`),
      why: { formula: 'change in 3-month average expenses vs 3-month average income, month over month', inputs: { expensesNow: crc(e1), expensesBefore: crc(e0), incomeNow: crc(i1), incomeBefore: crc(i0) }, threshold: `${p.months} months in a row` },
      impactCRC: Math.max(0, grew.reduce((s, x) => s + x.d, 0)), actWithinDays: 30, confidence: 0.7,
      action: { label: 'See which groups grew', kind: 'open', payload: { to: '/reports' } },
      dedupeKey: `R14:${ctx.month}`,
    })];
  },
});
