import { amortize, paymentForTerm } from '../../domain/debts';
import { debtStatus } from '../../domain/ledger';
import { addDays, shiftMonth } from '../context';
import { crc, make, rule } from './rule';
import type { Debt } from '../../domain/schemas';
import type { Ctx } from '../context';

const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

/** Projected payoff at your recent pace (avg of the last 3 months' payments, or the planned payment). */
export function projectedPayoff(ctx: Ctx, d: Debt): { date?: string; payment: number; balance: number } {
  const balance = debtStatus(d, ctx.past).balance;
  const last3 = [1, 2, 3].map((k) => shiftMonth(ctx.month, -k));
  const paid = ctx.past.filter((t) => t.kind === 'debt_payment' && t.debtId === d.id && last3.some((mk) => t.date.startsWith(mk))).reduce((s, t) => s + (t.kind === 'debt_payment' ? t.amount : 0), 0) / 3;
  const payment = Math.round(Math.max(paid, d.plannedMonthlyPayment ?? 0));
  if (balance <= 0) return { date: ctx.today, payment, balance };
  if (!payment) return { payment, balance };
  const a = amortize(balance, d.annualRateBps, payment, addDays(ctx.today, 30));
  return { date: a.never ? undefined : a.payoffDate, payment, balance };
}

/** R11 Loan payoff slipping: the projected payoff date moved ≥ 1 month later than last month's projection. */
export const R11 = rule({
  id: 'R11', name: 'Loan payoff slipping', trigger: 'Projected payoff date moves ≥ 1 month later vs. last month',
  defaults: { slipMonths: 1 }, labels: { slipMonths: 'Months of slip' },
  evaluate(ctx, p) {
    return ctx.debts.filter((d) => d.status === 'active').flatMap((d) => {
      const prev = ctx.state.payoff[d.id];
      const now = projectedPayoff(ctx, d);
      if (!prev || prev.month >= ctx.month || !now.date) return [];
      const slip = monthsBetween(prev.date, now.date);
      if (slip < p.slipMonths) return [];
      const keepMonths = Math.max(1, monthsBetween(ctx.today, prev.date));
      const needed = paymentForTerm(now.balance, d.annualRateBps, keepMonths);
      const extra = Math.max(0, needed - now.payment);
      return [make({
        ruleId: 'R11', severity: 'warning', title: `${d.creditor}: payoff slipped ${slip} month${slip > 1 ? 's' : ''} to ${now.date.slice(0, 7)}`,
        body: ctx.say(`Last month it pointed to ${prev.date.slice(0, 7)}. Add ${crc(extra)}/month to keep that date.`, `To stay on the original date (${prev.date.slice(0, 7)}), about ${crc(extra)} more per month would do it.`),
        why: { formula: 'amortize(balance, rate, average payment of the last 3 months)', inputs: { balance: crc(now.balance), payment: crc(now.payment), before: prev.date, now: now.date }, threshold: `≥ ${p.slipMonths} month later` },
        impactCRC: extra * keepMonths, actWithinDays: 14, confidence: 0.8,
        action: { label: `Add ${crc(extra)}/month`, kind: 'open', payload: { to: '/debts', debtId: d.id, extra } },
        dedupeKey: `R11:${d.id}:${ctx.month}`,
      })];
    });
  },
});
