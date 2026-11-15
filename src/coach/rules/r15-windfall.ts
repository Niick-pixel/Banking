import { addDays, shiftMonth, WINDFALL_RE } from '../context';
import { median } from '../stats';
import { splitWindfall } from '../windfall';
import { crc, ddmm, make, rule } from './rule';

/** R15 Windfall: income > 1.5× normal non-salary income (aguinaldo, quinquenio, sales) → splitter. */
export const R15 = rule({
  id: 'R15', name: 'Windfall', trigger: 'Income > 1.5× your normal non-salary income (aguinaldo, quinquenio, item sales)',
  defaults: { multiple: 1.5, lookbackDays: 21 }, labels: { multiple: '× normal extra income', lookbackDays: 'Look back (days)' },
  evaluate(ctx, p) {
    const prior = [1, 2, 3, 4, 5, 6].map((k) => shiftMonth(ctx.month, -k));
    const extraByMonth = prior.map((mk) => ctx.past.filter((t) => t.kind === 'income' && t.date.startsWith(mk) && !ctx.isSalaryCategory(ctx.cat.get(t.categoryId))).reduce((s, t) => s + (t.kind === 'income' ? t.amount : 0), 0)).filter((x) => x > 0);
    const normal = median(extraByMonth);
    const from = addDays(ctx.today, -p.lookbackDays);
    return ctx.past.filter((t) => t.kind === 'income' && t.date > from && !t.tags.includes('migrated-summary') && !ctx.isSalaryCategory(ctx.cat.get(t.categoryId))).flatMap((t) => {
      if (t.kind !== 'income') return [];
      const named = WINDFALL_RE.test(`${ctx.cat.get(t.categoryId)?.name} ${t.description}`);
      if (!named && t.amount <= normal * p.multiple) return [];
      const split = splitWindfall(ctx, t.amount);
      return [make({
        ruleId: 'R15', severity: 'info', title: `Windfall: ${crc(t.amount)}${t.description ? ` (${t.description})` : ''} on ${ddmm(t.date)}`,
        body: ctx.say(`Give it a job before it melts: ${split.filter((l) => l.amount > 0).map((l) => `${l.label} ${crc(l.amount)}`).join(' · ')}.`,
          `Nice one. A plan for it: ${split.filter((l) => l.amount > 0).map((l) => `${l.label} ${crc(l.amount)}`).join(', ')}.`),
        why: { formula: 'income not from salary > 1.5 × median monthly extra income (last 6 months), or named aguinaldo/bonus/quinquenio', inputs: { amount: crc(t.amount), normalExtra: crc(normal), months: extraByMonth.length }, threshold: `> ${p.multiple} × normal` },
        impactCRC: t.amount, actWithinDays: 7, confidence: 1,
        action: { label: 'Split it', kind: 'split_windfall', payload: { transactionId: t.id, amount: t.amount, split } },
        dedupeKey: `R15:${t.id}`,
      })];
    });
  },
});
