/**
 * "What would the Coach have told me?" Run it at the end of each past month (and today for
 * this month), as if it were that day: only movements up to then, payoff history carried forward.
 */
import { monthlyFlows } from '../domain/ledger';
import { lastDayOfMonth } from '../lib/dates';
import { evaluateRules, runCoach } from './engine';
import { buildContext } from './context';
import { score } from './score';
import type { CoachInput, Insight } from './types';

export interface ReplayMonth { month: string; asOf: string; insights: Insight[] }

export function replay(input: CoachInput): ReplayMonth[] {
  const months = [...new Set(input.transactions.map((t) => t.date.slice(0, 7)))].filter((m) => m <= input.today.slice(0, 7)).sort();
  const acc = new Map(input.accounts.map((a) => [a.id, a]));
  let payoff = {} as CoachInput['state']['payoff'];
  return months.map((month) => {
    const end = lastDayOfMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)));
    const asOf = end < input.today ? end : input.today;
    const txs = input.transactions.filter((t) => t.date <= asOf || (t.dateEstimated && t.date.startsWith(month)));
    const inp: CoachInput = {
      ...input, today: asOf, transactions: txs,
      flows: monthlyFlows(txs.filter((t) => t.currency === 'CRC'), { accountType: (id) => acc.get(id)?.type }),
      // Replay shows everything the rules found: nothing dismissed, no pushes.
      state: { ...input.state, dismissed: {}, snoozed: {}, payoff },
    };
    const ctx = buildContext(inp);
    const insights = evaluateRules(ctx).insights;
    for (const i of insights) i.priority = score(i, ctx.avgMonthlyIncome, inp.state);
    insights.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    payoff = { ...payoff, ...runCoach(inp, { iso: `${asOf}T12:00:00Z`, hour: 12 }).statePatch.payoff };
    return { month, asOf, insights };
  });
}
