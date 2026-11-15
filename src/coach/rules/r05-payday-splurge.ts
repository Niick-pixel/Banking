import { addDays, diffDays, spendOf } from '../context';
import { crc, ddmm, make, pct, rule } from './rule';

/** R5 Payday splurge: in the 72 h after a quincena, day-to-day spending > 25% of that quincena. */
export const R5 = rule({
  id: 'R5', name: 'Payday splurge', trigger: 'Spending in the 72 h after payday > 25% of that quincena (excluding bills and savings)',
  defaults: { hours: 72, share: 0.25 }, labels: { hours: 'Window after payday (hours)', share: 'Share of the quincena' },
  evaluate(ctx, p) {
    const P = ctx.lastPayday, end = addDays(P, Math.ceil(p.hours / 24));
    if (ctx.today < P || diffDays(P, ctx.today) > Math.ceil(p.hours / 24) + 2) return [];
    const pay = ctx.past.filter((t) => t.kind === 'income' && !t.dateEstimated && Math.abs(diffDays(t.date, P)) <= 2 && ctx.isSalaryCategory(ctx.cat.get(t.categoryId))).reduce((s, t) => s + (t.kind === 'income' ? t.amount : 0), 0) || ctx.avgSalaryPerQuincena;
    if (!pay) return [];
    const spentTx = ctx.past.filter((t) => !t.dateEstimated && !t.tags.includes('migrated-summary') && t.date >= P && t.date < end && ['Living', 'Discretionary'].includes(ctx.cat.get(spendOf(t)?.categoryId ?? '')?.group ?? ''));
    const spent = spentTx.reduce((s, t) => s + (spendOf(t)?.amount ?? 0), 0);
    if (spent <= pay * p.share) return [];
    const leftDays = Math.max(1, diffDays(ctx.today, ctx.nextPayday));
    return [make({
      ruleId: 'R5', severity: 'warning', title: `${pct(spent / pay)} of your quincena spent since payday`,
      body: ctx.say(`${crc(spent)} since ${ddmm(P)}. ${crc(Math.max(0, pay - spent))} of this pay has to last ${leftDays} more days.`, `Payday spending is at ${crc(spent)}. There are ${leftDays} days until the next pay, so go easy for a bit.`),
      why: { formula: `day-to-day spending from payday for ${p.hours} h ÷ quincena pay`, inputs: { payday: P, pay: crc(pay), spent: crc(spent), purchases: spentTx.length }, threshold: `> ${pct(p.share)}` },
      impactCRC: spent - pay * p.share, actWithinDays: 2, confidence: 0.9,
      action: { label: 'See safe-to-spend', kind: 'open', payload: { to: '/coach' } },
      dedupeKey: `R5:${P}`,
    })];
  },
});
