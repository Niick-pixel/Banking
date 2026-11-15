import { debtServiceRatio } from '../../domain/debts';
import { shiftMonth } from '../context';
import { crc, make, pct, rule } from './rule';

/** R12 Debt-service ratio: debt payments > 20% of income, or > 36% including rent (3-month averages). */
export const R12 = rule({
  id: 'R12', name: 'Debt-service ratio', trigger: 'Debt payments ÷ income > 20% (or > 36% incl. rent)',
  defaults: { ratio: 0.2, withRent: 0.36 }, labels: { ratio: 'Debt only', withRent: 'Including rent' },
  evaluate(ctx, p) {
    const ms = [0, 1, 2].map((k) => shiftMonth(ctx.month, -k)).filter((mk) => ctx.flows.has(mk) && (mk < ctx.month || ctx.day >= ctx.dim));
    if (!ms.length) return [];
    const avg = (f: (mk: string) => number) => ms.reduce((s, mk) => s + f(mk), 0) / ms.length;
    // Debt Service group: loan payments and card payments you log as expenses.
    const debtCats = ctx.categories.filter((c) => c.group === 'Debt Service').map((c) => c.id);
    const debt = avg((mk) => debtCats.reduce((s, id) => s + Math.max(0, ctx.flows.get(mk)!.byCategory.get(id) ?? 0), 0));
    const rentCats = ctx.categories.filter((c) => c.group === 'Fixed' && /rent|alquiler/i.test(c.name)).map((c) => c.id);
    const rent = avg((mk) => rentCats.reduce((s, id) => s + Math.max(0, ctx.flows.get(mk)!.byCategory.get(id) ?? 0), 0));
    const income = avg((mk) => ctx.flows.get(mk)!.income);
    const r = debtServiceRatio(debt, rent, income);
    if (r.ratio <= p.ratio && r.withRent <= p.withRent) return [];
    return [make({
      ruleId: 'R12', severity: 'warning', title: `Debt payments take ${pct(r.ratio)} of your income`,
      body: ctx.say(`${crc(debt)}/month on debt (incl. card payments) vs ${crc(income)} income; ${pct(r.withRent)} with rent. Healthy: under ${pct(p.ratio)} and ${pct(p.withRent)}.`,
        `Debt is taking a big share right now (${pct(r.ratio)}). Once it's paid down, that money comes back to you.`),
      why: { formula: 'average debt service ÷ average income, last 3 months (with and without rent)', inputs: { debt: crc(debt), rent: crc(rent), income: crc(income), months: ms.join(', ') }, threshold: `> ${pct(p.ratio)} or > ${pct(p.withRent)} with rent` },
      impactCRC: debt - income * p.ratio, actWithinDays: 30, confidence: ms.length / 3,
      action: { label: 'Open debt scenarios', kind: 'open', payload: { to: '/debts' } },
      dedupeKey: `R12:${ctx.month}`,
    })];
  },
});
