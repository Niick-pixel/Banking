import { addDays, spendOf } from '../context';
import { crc, ddmm, make, rule } from './rule';

/** R3 Unusual transaction: far above what's normal for its category, or > 10% of monthly income. */
export const R3 = rule({
  id: 'R3', name: 'Unusual transaction', trigger: 'Amount > typical + 3×MAD for the category, or > 10% of monthly income',
  defaults: { mads: 3, incomeShare: 0.1, lookbackDays: 7, minHistory: 5 },
  labels: { mads: 'MADs above typical', incomeShare: 'Or share of monthly income', lookbackDays: 'Look back (days)', minHistory: 'Min. past transactions' },
  evaluate(ctx, p) {
    const from = addDays(ctx.today, -p.lookbackDays);
    return ctx.past.filter((t) => t.date > from && t.kind === 'expense' && !t.tags.includes('migrated-summary')).flatMap((t) => {
      const s = spendOf(t);
      const c = s?.categoryId ? ctx.cat.get(s.categoryId) : undefined;
      if (!s || !c || !['Living', 'Discretionary'].includes(c.group)) return [];
      const b = ctx.baselines.get(c.id)!;
      const statLimit = b.txCount >= p.minHistory ? b.txMedian + p.mads * Math.max(b.txMad, b.txMedian * 0.1) : Infinity;
      const incomeLimit = ctx.avgMonthlyIncome * p.incomeShare;
      if (s.amount <= Math.min(statLimit, incomeLimit || Infinity)) return [];
      return [make({
        ruleId: 'R3', severity: 'heads_up',
        title: `Unusual ${c.name} purchase: ${crc(s.amount)}${t.description ? ` (${t.description})` : ''}`,
        body: ctx.say(`${ddmm(t.date)}: ${b.txCount >= p.minHistory ? `your typical ${c.name} purchase is ${crc(b.txMedian)}` : `that's ${Math.round((s.amount / (ctx.avgMonthlyIncome || 1)) * 100)}% of a month's income`}. Right category? Expected?`,
          `A bigger one than usual on ${ddmm(t.date)}. Just checking it's in the right category.`),
        why: { formula: 'amount > median + 3 × MAD (per transaction, this category) OR amount > 10% × average monthly income',
          inputs: { amount: crc(s.amount), typical: b.txCount ? crc(b.txMedian) : '—', MAD: b.txCount ? crc(b.txMad) : '—', pastTransactions: b.txCount, monthlyIncome: crc(ctx.avgMonthlyIncome) },
          threshold: `${p.mads} MADs above typical (with ≥ ${p.minHistory} past purchases) or ${Math.round(p.incomeShare * 100)}% of income` },
        impactCRC: s.amount - (b.txMedian || 0), actWithinDays: 7, confidence: b.txCount >= p.minHistory ? 0.9 : 0.6,
        action: { label: 'Check it / recategorize', kind: 'recategorize', payload: { transactionId: t.id } },
        dedupeKey: `R3:${t.id}`,
      })];
    });
  },
});
