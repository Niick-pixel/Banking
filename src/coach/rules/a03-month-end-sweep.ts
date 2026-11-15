import { shiftMonth } from '../context';
import { crc, make, rule } from './rule';

/** A3 Month-end sweep (spec §10.5): on the last day (or the first 2 days after), offer leftover free cash to a pot or debt. */
export const A3 = rule({
  id: 'A3', name: 'Month-end sweep', trigger: 'Last day of the month (and 2 days after): leftover free cash > 0',
  defaults: { minLeft: 1_000_000 }, labels: { minLeft: 'Only if at least (céntimos)' },
  evaluate(ctx, p) {
    const mk = ctx.day >= ctx.dim ? ctx.month : ctx.day <= 2 ? shiftMonth(ctx.month, -1) : null;
    const f = mk ? ctx.flows.get(mk) : undefined;
    if (!mk || !f || f.freeCash < p.minLeft) return [];
    const mine = ctx.pots.find((x) => x.owner === 'mine');
    const amount = Math.floor(f.freeCash / 100_000) * 100_000;
    return [make({
      ruleId: 'A3', severity: 'info', title: `${crc(f.freeCash)} left over from ${mk}: sweep it?`,
      body: ctx.say(`Move ${crc(amount)} to savings (or a debt) before it blends into next month.`, `A tidy end to the month: ${crc(amount)} could go to savings now.`),
      why: { formula: 'free cash = income − expenses − saved', inputs: { income: crc(f.income), expenses: crc(f.expenses), saved: crc(f.saved) }, threshold: `≥ ${crc(p.minLeft)}` },
      impactCRC: amount, actWithinDays: 2, confidence: 0.8,
      action: { label: `Sweep ${crc(amount)} to savings`, kind: 'move_money', payload: { amount, toPotId: mine?.id, toAccountId: mine?.accountId } },
      dedupeKey: `A3:${mk}`,
    })];
  },
});
