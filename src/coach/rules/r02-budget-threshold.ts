import { SPEND_GROUPS } from '../context';
import { crc, make, pct, rule } from './rule';

/** R2 Budget threshold: a category passes 80% (heads-up) or 100% (warning) of its budget. */
export const R2 = rule({
  id: 'R2', name: 'Budget threshold', trigger: 'A category passes 80% and 100% of its budget',
  defaults: { warnPct: 0.8 }, labels: { warnPct: 'Heads-up at (share of budget)' },
  evaluate(ctx, p) {
    return ctx.categories.filter((c) => (SPEND_GROUPS as readonly string[]).includes(c.group) && !c.archived).flatMap((c) => {
      const budget = ctx.budget(c.id), spent = ctx.spent.get(c.id) ?? 0;
      if (!budget || spent < budget * p.warnPct) return [];
      const over = spent > budget;
      // Fixed bills are paid in one go: reaching the budget is just the bill being paid.
      if (c.group === 'Fixed' && spent <= budget * 1.02) return [];
      return [make({
        ruleId: 'R2', severity: over ? 'warning' : 'heads_up',
        title: over ? `${c.name} is over budget: ${crc(spent)} of ${crc(budget)}` : `${c.name} is at ${pct(spent / budget)} of its budget`,
        body: over ? ctx.say(ctx.daysLeft ? `${crc(spent - budget)} over, with ${ctx.daysLeft} days to go.` : `Ended ${crc(spent - budget)} over.`, `It's ${crc(spent - budget)} past the budget so far this month.`)
          : ctx.say(`${crc(budget - spent)} left for ${ctx.daysLeft} days.`, `You still have ${crc(budget - spent)} for the rest of the month.`),
        why: { formula: 'spent ÷ budget', inputs: { spent: crc(spent), budget: crc(budget), share: pct(spent / budget) }, threshold: `heads-up ≥ ${pct(p.warnPct)}, warning ≥ 100%` },
        impactCRC: over ? spent - budget : (spent / budget) * budget * 0.1, actWithinDays: ctx.daysLeft, confidence: 1,
        action: { label: `Open ${c.name}`, kind: 'open', payload: { to: `/transactions?month=${ctx.month}&cat=${c.id}`, categoryId: c.id } },
        dedupeKey: `R2:${ctx.month}:${c.id}:${over ? 100 : 80}`,
      })];
    });
  },
});
