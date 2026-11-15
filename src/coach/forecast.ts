/**
 * Spec §10.3 B–E: pace projection, safe-to-spend, the 60-day cash-flow forecast,
 * and the hours-of-work cost of a purchase.
 */
import { occurrences, templateAmount } from '../domain/recurring';
import type { RecurringRule } from '../domain/schemas';
import { addDays, diffDays, occurrencePosted, paydaysAround, VARIABLE_GROUPS, type Ctx } from './context';

// ── B. Pace ───────────────────────────────────────────────────────────────
export interface Pace { spent: number; budget: number; expectedShare: number; projected: number; ratio: number; curve: 'history' | 'linear' }

/** projected = spent / max(expectedShareToday, 0.15); ratio = projected / budget. */
export function pace(ctx: Ctx, categoryIds: string[], budget: number): Pace {
  const spent = categoryIds.reduce((s, id) => s + (ctx.spent.get(id) ?? 0), 0);
  // Weighted day curve across the categories (weights = their baseline medians).
  let share = 0, wsum = 0, fromHistory = true;
  for (const id of categoryIds) {
    const b = ctx.baselines.get(id);
    const w = Math.max(1, b?.median ?? 0);
    const s = b?.curve ? b.curve[Math.min(ctx.day, 31)]! : (fromHistory = false, ctx.day / ctx.dim);
    share += s * w; wsum += w;
  }
  const expectedShare = ctx.day >= ctx.dim ? 1 : wsum ? share / wsum : ctx.day / ctx.dim;
  const projected = Math.round(spent / Math.max(expectedShare, 0.15));
  return { spent, budget, expectedShare, projected, ratio: budget > 0 ? projected / budget : 0, curve: fromHistory ? 'history' : 'linear' };
}

// ── Recurring cash events ────────────────────────────────────────────────
export interface CashEvent { date: string; amount: number; kind: 'income' | 'bill' | 'savings'; label: string; ruleId?: string }

const SPEND_TYPES = ['checking', 'cash'];

/** Unposted recurring events in [from, to] that move money in or out of spending accounts. */
export function recurringEvents(ctx: Ctx, from: string, to: string): CashEvent[] {
  const out: CashEvent[] = [];
  const touches = (side?: { accountId: string }) => !!side && SPEND_TYPES.includes(ctx.acc.get(side.accountId)?.type ?? '');
  for (const r of ctx.recurring as RecurringRule[]) {
    if (!r.active || r.informational) continue;
    const t = r.template as { kind: string; from?: { accountId: string }; to?: { accountId: string }; direction?: string; categoryId?: string };
    const amount = templateAmount(r);
    if (!amount) continue;
    for (const d of occurrences(r.schedule, r.startDate, from, r.endDate && r.endDate < to ? r.endDate : to)) {
      if ((r.skipped ?? []).includes(d) || occurrencePosted(ctx, r.id, d, t.categoryId, amount)) continue;
      if (t.kind === 'income' && touches(t.to)) out.push({ date: d, amount, kind: 'income', label: r.name, ruleId: r.id });
      else if ((t.kind === 'expense' || t.kind === 'debt_payment') && touches(t.from)) out.push({ date: d, amount: -amount, kind: 'bill', label: r.name, ruleId: r.id });
      else if (t.kind === 'transfer' && touches(t.from) && !touches(t.to)) out.push({ date: d, amount: -amount, kind: ctx.acc.get(t.to?.accountId ?? '')?.type === 'credit_card' ? 'bill' : 'savings', label: r.name, ruleId: r.id });
      else if (t.kind === 'savings' && t.direction !== 'withdrawal' && touches(t.from)) out.push({ date: d, amount: -amount, kind: 'savings', label: r.name, ruleId: r.id });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Salary on paydays, unless you have a recurring rule for income already. */
function salaryEvents(ctx: Ctx, from: string, to: string, events: CashEvent[]): CashEvent[] {
  if (events.some((e) => e.kind === 'income') || !ctx.avgSalaryPerQuincena) return [];
  const out: CashEvent[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const { last } = paydaysAround(d);
    if (last !== d) continue;
    const already = ctx.past.some((t) => t.kind === 'income' && Math.abs(diffDays(t.date, d)) <= 2 && !t.dateEstimated && ctx.isSalaryCategory(ctx.cat.get(t.categoryId)));
    if (!already) out.push({ date: d, amount: Math.round(ctx.avgSalaryPerQuincena), kind: 'income', label: 'Salary (estimated from history)' });
  }
  return out;
}

// ── C. Safe-to-spend ─────────────────────────────────────────────────────
export interface SafeToSpend {
  value: number; perDay: number; until: string; days: number;
  balance: number; income: number; bills: number; savings: number; buffer: number;
  typicalDaily: number; tone: 'good' | 'tight' | 'negative';
  /** False when a spending account has no statement yet (balance unknown). */
  known: boolean;
  items: CashEvent[];
}

/**
 * balance + income before the next payday − bills and savings due through it − buffer.
 * Payday income is not counted: it pays for the next period, not this one.
 */
export function safeToSpend(ctx: Ctx): SafeToSpend {
  const until = ctx.nextPayday;
  const events = recurringEvents(ctx, ctx.today, until);
  const income = events.filter((e) => e.kind === 'income' && e.date < until).reduce((s, e) => s + e.amount, 0);
  const bills = Math.abs(events.filter((e) => e.kind === 'bill').reduce((s, e) => s + e.amount, 0));
  const savings = Math.abs(events.filter((e) => e.kind === 'savings').reduce((s, e) => s + e.amount, 0));
  const value = ctx.spendable + income - bills - savings - ctx.prefs.buffer;
  const days = Math.max(1, diffDays(ctx.today, until));
  const perDay = Math.round(value / days);
  const typicalDaily = Math.round(VARIABLE_GROUPS.flatMap((g) => ctx.categories.filter((c) => c.group === g)).reduce((s, c) => s + (ctx.baselines.get(c.id)?.median ?? 0), 0) / 30);
  return { value, perDay, until, days, balance: ctx.spendable, income, bills, savings, buffer: ctx.prefs.buffer, typicalDaily, tone: value < 0 ? 'negative' : perDay >= typicalDaily ? 'good' : 'tight', items: events, known: ctx.unknownBalance.length === 0 };
}

// ── D. Forecast ──────────────────────────────────────────────────────────
export interface ForecastDay { date: string; balance: number; events: CashEvent[]; variable: number }
export interface Forecast { days: ForecastDay[]; dailyVariable: number; firstBelowBuffer?: ForecastDay; min: ForecastDay }

/** Spending balance day by day: recurring events plus your baseline day-to-day spend. */
export function forecast(ctx: Ctx, horizon = 60): Forecast {
  const to = addDays(ctx.today, horizon);
  const rec = recurringEvents(ctx, addDays(ctx.today, 1), to);
  const events = [...rec, ...salaryEvents(ctx, addDays(ctx.today, 1), to, rec)];
  const dailyVariable = Math.round(VARIABLE_GROUPS.flatMap((g) => ctx.categories.filter((c) => c.group === g)).reduce((s, c) => s + (ctx.baselines.get(c.id)?.median ?? 0), 0) / 30);
  const days: ForecastDay[] = [];
  let bal = ctx.spendable;
  for (let i = 1; i <= horizon; i++) {
    const d = addDays(ctx.today, i);
    const ev = events.filter((e) => e.date === d);
    bal += ev.reduce((s, e) => s + e.amount, 0) - dailyVariable;
    days.push({ date: d, balance: bal, events: ev, variable: dailyVariable });
  }
  const min = days.reduce((a, b) => (b.balance < a.balance ? b : a), days[0]!);
  return { days, dailyVariable, firstBelowBuffer: days.find((d) => d.balance < ctx.prefs.buffer), min };
}

// ── E. Hours of work ─────────────────────────────────────────────────────
export function hoursOfWork(ctx: Ctx, amount: number): number {
  const net = ctx.avgSalaryPerQuincena * 2 || ctx.avgMonthlyIncome;
  if (!net) return 0;
  return amount / (net / ctx.prefs.workHoursPerMonth);
}
