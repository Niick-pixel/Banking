import { addDays } from '../context';
import { crc, ddmm, make, rule } from './rule';
import type { Transaction } from '../../domain/schemas';

/**
 * R10 Withdrawal from a pot that holds someone else's money. Critical, and it asks for a reason.
 * Paying her debt from her fund is what the fund is for, so that never fires.
 */
export const R10 = rule({
  id: 'R10', name: 'Withdrawal from her fund', trigger: 'Any withdrawal from a fund owned by someone else',
  defaults: { lookbackDays: 30 }, labels: { lookbackDays: 'Look back (days)' },
  evaluate(ctx, p) {
    const hers = new Map(ctx.pots.filter((x) => x.owner === 'hers').map((x) => [x.id, x]));
    if (!hers.size) return [];
    const family = ctx.debts.filter((d) => d.kind === 'family').map((d) => d.id);
    const from = addDays(ctx.today, -p.lookbackDays);
    const takes = (t: Transaction) => {
      if (t.date <= from) return null;
      if (t.kind === 'debt_payment' && family.includes(t.debtId)) return null;
      if (t.kind === 'savings' && t.direction === 'withdrawal' && t.from.potId && hers.has(t.from.potId)) return t.from.potId;
      if ((t.kind === 'expense' || t.kind === 'transfer' || t.kind === 'debt_payment') && t.from.potId && hers.has(t.from.potId)) return t.from.potId;
      return null;
    };
    const monthlyPlan = ctx.categories.filter((c) => c.group === 'Savings' && /hers|her|ella/i.test(c.name)).reduce((s, c) => s + ctx.budget(c.id), 0);
    return ctx.past.flatMap((t) => {
      const potId = takes(t);
      if (!potId || !('amount' in t)) return [];
      const pot = hers.get(potId)!;
      const bal = ctx.balances.get(pot.accountId)?.pots.get(potId) ?? 0;
      const months = monthlyPlan ? Math.ceil(t.amount / monthlyPlan) : 0;
      const reason = ctx.state.reasons[`R10:${t.id}`];
      return [make({
        ruleId: 'R10', severity: 'critical', requiresReason: !reason,
        title: `${crc(t.amount)} taken from ${pot.name} on ${ddmm(t.date)}`,
        body: reason ? `Reason given: “${reason}”. ${pot.name} now holds ${crc(bal)}.`
          : ctx.say(`That's her money. Say why, and it's logged as borrowing. ${pot.name} now holds ${crc(bal)}${months ? `; at ${crc(monthlyPlan)}/month it takes ${months} more month${months > 1 ? 's' : ''} to refill` : ''}.`,
            `This money is set aside for her. Add a short reason so it's tracked as a loan from her fund${months ? `; it will take about ${months} month${months > 1 ? 's' : ''} to put back` : ''}.`),
        why: { formula: 'withdrawal from a fund with owner = hers (paying her debt from it excluded)', inputs: { pot: pot.name, amount: crc(t.amount), balanceNow: crc(bal), monthlyPlan: crc(monthlyPlan) }, threshold: 'any amount' },
        impactCRC: t.amount, actWithinDays: 1, confidence: 1,
        action: { label: reason ? 'Open her fund' : 'Give a reason (log as borrowing)', kind: reason ? 'open' : 'log_reason', payload: { transactionId: t.id, to: '/funds', amount: t.amount } },
        dedupeKey: `R10:${t.id}`,
      })];
    });
  },
});
