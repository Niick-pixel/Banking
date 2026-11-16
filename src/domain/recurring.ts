/**
 * Recurring items: schedules, what's due, idempotent posting, history-based
 * suggestions, and one unified list of calendar events (recurring, Tasa Cero
 * cuotas, debt payments, card due dates, self-loan plans).
 */
import type { Account, Category, Debt, InstallmentPlan, RecurringRule, SelfLoan, Transaction } from './schemas';
import { TransactionSchema } from './schemas';
import { cuotaDate, schedule as cuotaSchedule } from './installments';
import { amortize, nextPaymentDate, selfLoanProgress } from './debts';
import { accountBalances, debtStatus } from './ledger';
import type { Payroll } from './prefs';
import { daysInMonth, lastDayOfMonth, parseISO, toISO, type ISODate } from '../lib/dates';

export type Schedule = RecurringRule['schedule'];
export type RecurringTemplate = Record<string, unknown> & { kind: Transaction['kind'] };

const addDays = (d: ISODate, n: number): ISODate => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const weekday = (d: ISODate) => new Date(`${d}T00:00:00Z`).getUTCDay();

/** All dates of a schedule inside [from, to], never before `start`. */
export function occurrences(s: Schedule, start: ISODate, from: ISODate, to: ISODate): ISODate[] {
  const lo = from > start ? from : start;
  if (lo > to) return [];
  const out: ISODate[] = [];
  const { year: y0, month: m0 } = parseISO(lo);
  const { year: y1, month: m1 } = parseISO(to);
  const months: [number, number][] = [];
  for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? (y++, (m = 1)) : m++) months.push([y, m]);
  switch (s.type) {
    case 'quincena': for (const [y, m] of months) out.push(toISO(y, m, 15), lastDayOfMonth(y, m)); break;
    case 'monthly': for (const [y, m] of months) out.push(toISO(y, m, Math.min(s.day, daysInMonth(y, m)))); break;
    case 'days': for (const [y, m] of months) for (const d of new Set(s.days.map((x) => Math.min(x, daysInMonth(y, m))))) out.push(toISO(y, m, d)); break;
    case 'yearly': for (let y = y0; y <= y1; y++) out.push(toISO(y, s.month, Math.min(s.day, daysInMonth(y, s.month)))); break;
    case 'weekly': for (let d = lo; d <= to; d = addDays(d, 1)) if (weekday(d) === s.weekday) out.push(d); break;
  }
  return out.filter((d) => d >= lo && d <= to).sort();
}

export const recurringTxId = (ruleId: string, date: ISODate) => `rec:${ruleId}:${date}`;

/**
 * Occurrences that need action today.
 *  - auto_post: everything after lastHandledDate (so a posting you deleted is never recreated)
 *  - remind: everything not yet posted and not skipped (looks back at most 120 days)
 */
export function dueOccurrences(rule: RecurringRule, today: ISODate, postedIds: Set<string>): ISODate[] {
  if (!rule.active) return [];
  const to = rule.endDate && rule.endDate < today ? rule.endDate : today;
  const from = rule.mode === 'auto_post' && rule.lastHandledDate ? addDays(rule.lastHandledDate, 1) : rule.mode === 'remind' ? addDays(today, -120) : rule.startDate;
  return occurrences(rule.schedule, rule.startDate, from, to)
    .filter((d) => !postedIds.has(recurringTxId(rule.id, d)) && !(rule.skipped ?? []).includes(d));
}

export function templateAmount(rule: RecurringRule): number {
  const t = rule.template as { amount?: number; signedAmount?: number };
  return Math.abs(t.amount ?? t.signedAmount ?? 0);
}

/** Build the transaction for one occurrence (optionally with a confirmed amount). */
export function buildOccurrence(rule: RecurringRule, date: ISODate, now: number, amount?: number): Transaction {
  const t = rule.template as RecurringTemplate & { tags?: string[]; signedAmount?: number; description?: string };
  const base: Record<string, unknown> = {
    currency: 'CRC', notes: '', ...t,
    id: recurringTxId(rule.id, date), date, dateEstimated: false, recurringId: rule.id,
    description: t.description || rule.name, tags: [...new Set([...(t.tags ?? []), 'recurring'])], createdAt: now, updatedAt: now,
  };
  if (amount !== undefined) {
    if (t.kind === 'adjustment') base.signedAmount = Math.sign(t.signedAmount ?? 1) * amount;
    else base.amount = amount;
  }
  return TransactionSchema.parse(base);
}

// ── Calendar ────────────────────────────────────────────────────────────────
export type EventTone = 'income' | 'expense' | 'savings' | 'debt' | 'card' | 'info';
export interface CalendarEvent {
  date: ISODate; title: string; amount?: number; tone: EventTone;
  source: 'recurring' | 'tasa_cero' | 'debt' | 'card' | 'self_loan';
  status: 'posted' | 'pending' | 'upcoming' | 'skipped';
  ruleId?: string; to: string;
}

export interface CalendarInput {
  rules: RecurringRule[]; transactions: Transaction[]; installments: InstallmentPlan[];
  debts: Debt[]; accounts: Account[]; selfLoans: SelfLoan[]; categories: Category[];
}

const toneOf = (t: RecurringTemplate, informational: boolean): EventTone =>
  informational || t.kind === 'adjustment' ? 'info' : t.kind === 'income' ? 'income' : t.kind === 'savings' ? 'savings' : t.kind === 'debt_payment' ? 'debt' : 'expense';

export function calendarEvents(inp: CalendarInput, from: ISODate, to: ISODate, today: ISODate): CalendarEvent[] {
  const ev: CalendarEvent[] = [];
  const posted = new Set(inp.transactions.map((t) => t.id));
  const debtsWithRule = new Set(inp.rules.filter((r) => r.active && (r.template as { debtId?: string }).debtId).map((r) => (r.template as { debtId?: string }).debtId));
  for (const r of inp.rules.filter((x) => x.active)) {
    const end = r.endDate && r.endDate < to ? r.endDate : to;
    for (const d of occurrences(r.schedule, r.startDate, from, end)) {
      const id = recurringTxId(r.id, d);
      const status = posted.has(id) ? 'posted' : (r.skipped ?? []).includes(d) ? 'skipped' : d <= today && r.mode === 'remind' ? 'pending' : 'upcoming';
      ev.push({ date: d, title: r.name, amount: templateAmount(r), tone: toneOf(r.template as RecurringTemplate, r.informational), source: 'recurring', status, ruleId: r.id, to: '/bills' });
    }
  }
  for (const p of inp.installments.filter((x) => x.status === 'active')) {
    cuotaSchedule(p.total, p.months, p.firstChargeDate).forEach((row) => {
      if (row.date >= from && row.date <= to) ev.push({ date: row.date, title: `${p.description} · cuota ${row.n}/${p.months}`, amount: row.amount, tone: 'card', source: 'tasa_cero', status: row.date <= today ? 'posted' : 'upcoming', to: '/tasa-cero' });
    });
  }
  for (const d of inp.debts.filter((x) => x.status !== 'paid' && x.plannedMonthlyPayment && !debtsWithRule.has(x.id))) {
    const st = debtStatus(d, inp.transactions);
    if (st.balance <= 0) continue;
    const a = amortize(st.balance, d.annualRateBps, d.plannedMonthlyPayment!, nextPaymentDate(d, today));
    for (const row of a.rows) if (row.date >= from && row.date <= to) ev.push({ date: row.date, title: `Pay ${d.creditor}`, amount: row.payment, tone: 'debt', source: 'debt', status: 'upcoming', to: '/debts' });
  }
  const bal = accountBalances(inp.accounts, inp.transactions, today);
  for (const a of inp.accounts.filter((x) => x.type === 'credit_card' && x.cardDueDay && !x.archived)) {
    const owed = Math.max(0, -(bal.get(a.id)?.total ?? 0));
    let first = true;
    for (const d of occurrences({ type: 'monthly', day: a.cardDueDay! }, from, from, to)) {
      if (d < a.openingDate) continue; // the card wasn't tracked yet
      const isNext = d >= today && first;
      if (isNext) first = false;
      ev.push({ date: d, title: `${a.name} payment due`, amount: isNext && owed ? owed : undefined, tone: 'card', source: 'card', status: d < today ? 'posted' : 'upcoming', to: '/accounts' });
    }
  }
  for (const p of selfLoanProgress(inp.selfLoans, inp.transactions, inp.categories)) {
    if (!p.done && p.loan.plannedDate && p.loan.plannedDate >= from && p.loan.plannedDate <= to) ev.push({ date: p.loan.plannedDate, title: `Replenish: ${p.loan.description}`, amount: p.remaining, tone: 'savings', source: 'self_loan', status: 'upcoming', to: '/debts' });
  }
  return ev.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

// ── Suggestions from history and payroll settings ──────────────────────────
export interface Suggestion { key: string; name: string; reason: string; needsAmount?: boolean; rule: Omit<RecurringRule, 'id' | 'createdAt' | 'updatedAt'> }

// (prevMonths(x, 1) gives the month before x; used above to get "next month" from a date in it)
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2]! : Math.round((s[n / 2 - 1]! + s[n / 2]!) / 2)) : 0; };
const prevMonths = (today: ISODate, n: number) => Array.from({ length: n }, (_, i) => { const { year, month } = parseISO(today); const idx = year * 12 + month - 2 - i; return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`; });

export function suggestRecurring(txs: Transaction[], categories: Category[], accounts: Account[], payroll: Payroll, today: ISODate, existing: RecurringRule[]): Suggestion[] {
  const out: Suggestion[] = [];
  const start = addDays(today, 1);
  const spending = accounts.find((a) => a.type === 'checking' && !a.archived) ?? accounts[0];
  if (!spending) return out;
  const covered = new Set(existing.map((r) => `${(r.template as { kind: string }).kind}|${(r.template as { categoryId?: string }).categoryId ?? ''}|${(r.template as { to?: { accountId: string }; side?: { accountId: string } }).side?.accountId ?? ''}`));
  const base = { mode: 'remind' as const, startDate: start, skipped: [], informational: false, active: true };
  const months = prevMonths(today, 4); // last 4 completed months
  const cats = new Map(categories.map((c) => [c.id, c]));
  // Already logged this month → start next month, so this month isn't counted twice.
  const thisMonth = today.slice(0, 7);
  const nextMonthStart = `${prevMonths(addDays(lastDayOfMonth(Number(thisMonth.slice(0, 4)), Number(thisMonth.slice(5))), 32), 1)[0]}-01`;
  const loggedThisMonth = new Set(txs.filter((t) => t.date.startsWith(thisMonth) && 'categoryId' in t && t.categoryId).map((t) => (t as { categoryId: string }).categoryId));
  const startFor = (categoryId?: string) => (categoryId && loggedThisMonth.has(categoryId) ? nextMonthStart : start);

  // Monthly totals per category over completed months, plus the days they happened on.
  const perCat = new Map<string, { byMonth: Map<string, number>; days: number[]; kind: Transaction['kind']; desc: string }>();
  for (const t of txs) {
    if (!(t.kind === 'income' || t.kind === 'expense') || !t.categoryId || !months.includes(t.date.slice(0, 7))) continue;
    const e = perCat.get(t.categoryId) ?? { byMonth: new Map<string, number>(), days: [] as number[], kind: t.kind as Transaction["kind"], desc: t.description };
    e.byMonth.set(t.date.slice(0, 7), (e.byMonth.get(t.date.slice(0, 7)) ?? 0) + t.amount);
    // Migrated monthly summaries sit on month end: their day says nothing about when it's paid.
    if (!t.dateEstimated && !t.tags.includes('migrated-summary')) e.days.push(Number(t.date.slice(8)));
    perCat.set(t.categoryId, e);
  }
  for (const [catId, e] of perCat) {
    const c = cats.get(catId);
    if (!c || covered.has(`${e.kind}|${catId}|`)) continue;
    const vals = [...e.byMonth.values()];
    if (vals.length < 3) continue;
    const med = median(vals);
    const steady = vals.every((v) => Math.abs(v - med) <= med * 0.15);
    const isSalary = c.group === 'Income' && /salar|quincena|sueldo|pay/i.test(c.name);
    // Salary varies (overtime, deductions) but always comes: suggest it as a reminder whatever the spread.
    if ((!steady && !isSalary) || (c.group === 'Income' && !isSalary) || ['Discretionary', 'Savings'].includes(c.group)) continue;
    const second = /2nd|second|segunda/i.test(c.name);
    const day = isSalary ? (second ? 31 : /1st|first|primera/i.test(c.name) ? 15 : 31) : e.days.length ? median(e.days) : 1;
    const identical = !isSalary && vals.every((v) => v === vals[0]);
    out.push({
      key: `cat-${catId}`, name: c.name,
      reason: isSalary ? `Arrives every month (₡${Math.round(Math.min(...vals) / 100).toLocaleString('en')}–₡${Math.round(Math.max(...vals) / 100).toLocaleString('en')}), so it asks you to confirm the real amount.` : `${vals.length} of the last 4 months, about ₡${Math.round(med / 100).toLocaleString('en')} each${identical ? ', always the same amount' : ''}.`,
      rule: { ...base, startDate: startFor(catId), name: c.name, mode: identical ? 'auto_post' : 'remind', schedule: { type: 'monthly', day }, template: e.kind === 'income' ? { kind: 'income', to: { accountId: spending.id }, amount: med, categoryId: catId, description: c.name } : { kind: 'expense', from: { accountId: spending.id }, amount: med, categoryId: catId, description: c.name } },
    });
  }

  // Payroll: savings, association plan, cesantía contributions.
  const savingsAcc = accounts.find((a) => (a.type === 'goal_savings' || a.type === 'savings') && !a.archived);
  const savCat = categories.find((c) => c.group === 'Savings' && /mine|mío|mia/i.test(c.name)) ?? categories.find((c) => c.group === 'Savings');
  if (payroll.mySavingsPerQuincena > 0 && savingsAcc && savCat && !covered.has(`savings|${savCat.id}|`)) {
    out.push({ key: 'payroll-savings', name: 'My savings (each quincena)', reason: 'From your payroll settings.', rule: { ...base, startDate: startFor(savCat.id), mode: 'auto_post', name: 'My savings', schedule: { type: 'quincena' }, template: { kind: 'savings', direction: 'deposit', from: { accountId: spending.id }, to: { accountId: savingsAcc.id }, amount: payroll.mySavingsPerQuincena, categoryId: savCat.id, description: 'Automatic savings' } } });
  }
  const assoc = accounts.find((a) => a.type === 'association_voluntary' && !a.archived);
  if (payroll.associationPerQuincena > 0 && assoc && !covered.has(`adjustment||${assoc.id}`)) {
    out.push({ key: 'payroll-assoc', name: 'Association savings plan (payroll)', reason: 'Deducted from your pay before it reaches checking, so it only adds to the association balance.', rule: { ...base, mode: 'auto_post', informational: true, name: 'Association savings plan', schedule: { type: 'quincena' }, template: { kind: 'adjustment', side: { accountId: assoc.id }, signedAmount: payroll.associationPerQuincena, reason: 'Payroll contribution', description: 'Association plan (payroll)' } } });
  }
  const ces = accounts.find((a) => a.type === 'association_cesantia' && !a.archived);
  const cesMonthly = payroll.aporteObreroMonthly + payroll.aportePatronalMonthly;
  if (cesMonthly > 0 && ces && !covered.has(`adjustment||${ces.id}`)) {
    out.push({ key: 'payroll-cesantia', name: 'Cesantía (aporte obrero + patronal)', reason: 'Your contribution plus your employer\'s, added to the cesantía reserve each month.', rule: { ...base, mode: 'auto_post', informational: true, name: 'Cesantía contributions', schedule: { type: 'monthly', day: 31 }, template: { kind: 'adjustment', side: { accountId: ces.id }, signedAmount: cesMonthly, reason: 'Payroll contribution (obrero + patronal)', description: 'Cesantía (payroll)' } } });
  }

  // Yearly: aguinaldo (≈ one month of salary) and marchamo (amount unknown).
  const salaryCats = categories.filter((c) => c.group === 'Income' && /salar|quincena|sueldo/i.test(c.name)).map((c) => c.id);
  const monthlySalary = median(months.map((m) => txs.filter((t) => t.kind === 'income' && salaryCats.includes(t.categoryId) && t.date.startsWith(m)).reduce((s, t) => s + (t.kind === 'income' ? t.amount : 0), 0)).filter((v) => v > 0));
  const bonusCat = categories.find((c) => c.group === 'Income' && /aguinaldo|bonus/i.test(c.name));
  if (bonusCat && monthlySalary > 0 && !covered.has(`income|${bonusCat.id}|`)) {
    out.push({ key: 'aguinaldo', name: 'Aguinaldo', reason: 'Paid in December; roughly one month of salary (1/12 of the year). The estimate uses your recent net salary; confirm the real amount when it arrives.', rule: { ...base, name: 'Aguinaldo', schedule: { type: 'yearly', month: 12, day: 15 }, template: { kind: 'income', to: { accountId: spending.id }, amount: monthlySalary, categoryId: bonusCat.id, description: 'Aguinaldo' } } });
  }
  const carCat = categories.find((c) => /marchamo|vehic|car\b|transport/i.test(c.name) && c.group !== 'Income' && c.group !== 'Savings') ?? categories.find((c) => c.group === 'Fixed');
  if (carCat && !existing.some((r) => /marchamo/i.test(r.name))) {
    out.push({ key: 'marchamo', name: 'Marchamo (if you own a vehicle)', reason: 'Due every December. Put the amount from last year; the calendar will remind you, and you can set aside 1/12 a month as a goal.', needsAmount: true, rule: { ...base, name: 'Marchamo', schedule: { type: 'yearly', month: 12, day: 1 }, template: { kind: 'expense', from: { accountId: spending.id }, amount: 1, categoryId: carCat.id, description: 'Marchamo' } } });
  }
  return out;
}

export const ordinal = (d: number) => (d === 31 ? 'last day' : `${d}${d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th'}`);

export function describeSchedule(s: Schedule): string {
  const MS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DW = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
  switch (s.type) {
    case 'quincena': return 'Every quincena (15th and last day)';
    case 'monthly': return s.day >= 28 ? (s.day === 31 ? 'Monthly, last day' : `Monthly on the ${s.day}th (or last day)`) : `Monthly on day ${s.day}`;
    case 'weekly': return `Weekly on ${DW[s.weekday]}`;
    case 'yearly': return `Every year on ${s.day} ${MS[s.month - 1]}`;
    case 'days': return `Every month on the ${[...s.days].sort((a, b) => a - b).map(ordinal).join(' and ').replace(/ and (?=.* and )/g, ', ')}`;
  }
}

export { cuotaDate };
