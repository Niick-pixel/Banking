/** Spec §10.6: weekly check-in and month-end report card. Every number comes from the ledger. */
import { debtStatus } from '../domain/ledger';
import { addDays, shiftMonth, spendOf, VARIABLE_GROUPS, type Ctx } from './context';
import { recurringEvents, safeToSpend, type CashEvent } from './forecast';
import type { Insight } from './types';

export interface WeeklyCheckIn {
  from: string; to: string;
  spent: number; pace: number;
  safeWeek: number | null; perDay: number | null;
  top: Insight[]; bills: CashEvent[];
  line: string;
}

export function weeklyCheckIn(ctx: Ctx, ranked: Insight[]): WeeklyCheckIn {
  const from = addDays(ctx.today, -6);
  const spent = ctx.past.filter((t) => !t.dateEstimated && t.date >= from && VARIABLE_GROUPS.includes(ctx.cat.get(spendOf(t)?.categoryId ?? '')?.group as never)).reduce((s, t) => s + (spendOf(t)?.amount ?? 0), 0);
  const budget = ctx.categories.filter((c) => VARIABLE_GROUPS.includes(c.group as never)).reduce((s, c) => s + ctx.budget(c.id), 0);
  const pace = Math.round((budget * 7) / ctx.dim);
  const s = safeToSpend(ctx);
  const bills = recurringEvents(ctx, ctx.today, addDays(ctx.today, 7)).filter((e) => e.kind !== 'income');
  const over = spent - pace;
  return {
    from, to: ctx.today, spent, pace, safeWeek: s.known ? Math.max(0, s.perDay * 7) : null, perDay: s.known ? s.perDay : null,
    top: ranked.filter((i) => i.severity !== 'win').slice(0, 2), bills,
    line: !budget ? 'No day-to-day budgets yet.' : over > 0 ? `Day-to-day spending ran ${Math.round((over / pace) * 100)}% over a weekly pace.` : `Day-to-day spending was within pace (${Math.round((spent / (pace || 1)) * 100)}%).`,
  };
}

export interface MonthReport {
  month: string;
  income: number; expenses: number; saved: number; freeCash: number;
  savingsRate: number; target: number;
  worst: { name: string; spent: number; budget: number; over: number; pct: number }[];
  avoidable: number; avoidableItems: { name: string; amount: number }[];
  debts: { name: string; paid: number; balance: number }[];
  verdict: string;
}

export function monthReport(ctx: Ctx, month: string): MonthReport | null {
  const f = ctx.flows.get(month);
  if (!f) return null;
  const worst = ctx.categories
    .filter((c) => ['Fixed', 'Living', 'Discretionary'].includes(c.group))
    .map((c) => { const spent = Math.max(0, f.byCategory.get(c.id) ?? 0), budget = ctx.budget(c.id, month); return { name: c.name, spent, budget, over: spent - budget, pct: budget ? spent / budget : 0 }; })
    .filter((x) => x.budget > 0 && x.over > 0).sort((a, b) => b.over - a.over).slice(0, 3);
  const avoidCats = ctx.categories.filter((c) => c.group === 'Discretionary' || c.discretionary);
  const avoidableItems = avoidCats.map((c) => ({ name: c.name, amount: Math.max(0, f.byCategory.get(c.id) ?? 0) })).filter((x) => x.amount > 0);
  const avoidable = avoidableItems.reduce((s, x) => s + x.amount, 0);
  const upTo = ctx.transactions.filter((t) => t.date.slice(0, 7) <= month);
  const debts = ctx.debts.map((d) => ({
    name: d.creditor,
    paid: ctx.transactions.filter((t) => t.kind === 'debt_payment' && t.debtId === d.id && t.date.startsWith(month)).reduce((s, t) => s + (t.kind === 'debt_payment' ? t.amount : 0), 0),
    balance: Math.max(0, debtStatus(d, upTo).balance),
  })).filter((d) => d.paid || d.balance);
  const rate = f.income ? f.saved / f.income : 0;
  const target = ctx.savingsRateTarget;
  const prev = ctx.flows.get(shiftMonth(month, -1));
  const verdict = !f.income ? 'No income logged this month.'
    : rate >= target && f.freeCash >= 0 ? `Strong month: saved ${Math.round(rate * 100)}% and stayed in the black.`
    : rate >= target ? `Saved ${Math.round(rate * 100)}%, but spent ${Math.round(-f.freeCash / 100).toLocaleString('en-US')} colones more than was left. That came from savings or credit.`
    : worst[0] ? `Missed the savings target by ${Math.round((target - rate) * 100)} points; ${worst[0].name} cost the most over budget.`
    : `Saved ${Math.round(rate * 100)}% vs a ${Math.round(target * 100)}% target${prev ? `, ${rate > (prev.income ? prev.saved / prev.income : 0) ? 'better' : 'worse'} than last month` : ''}.`;
  return { month, income: f.income, expenses: f.expenses, saved: f.saved, freeCash: f.freeCash, savingsRate: rate, target, worst, avoidable, avoidableItems, debts, verdict };
}
