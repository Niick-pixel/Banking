/**
 * Everything the rules need, computed once per run (spec §10.3 A): month position,
 * spending by category, robust baselines with day-of-month curves, paydays, balances.
 */
import type { Account, Category, Transaction } from '../domain/schemas';
import { accountBalances, legs, type AccountBalance } from '../domain/ledger';
import { budgetFor } from '../domain/tracker';
import { daysInMonth, lastDayOfMonth, toISO } from '../lib/dates';
import { recurringTxId } from '../domain/recurring';
import { mad, median } from './stats';
import type { CoachInput, CoachTone } from './types';

export const addDays = (d: string, n: number) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
export const diffDays = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
export const shiftMonth = (mk: string, d: number) => { const [y, m] = mk.split('-').map(Number) as [number, number]; const i = y * 12 + m - 1 + d; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; };

/** Groups whose spend is day-to-day and can be paced (fixed bills are lumpy by nature). */
export const VARIABLE_GROUPS = ['Living', 'Discretionary'] as const;
export const SPEND_GROUPS = ['Fixed', 'Living', 'Discretionary', 'Debt Service'] as const;
const SALARY_RE = /salary|salario|quincena|payroll|planilla/i;
export const WINDFALL_RE = /aguinaldo|bonus|bono|quinquenio|escolar/i;

export interface Baseline {
  /** Complete months used (with any spending in this category). */
  months: number;
  /** Median monthly total and robust spread (MAD × 1.4826). */
  median: number;
  spread: number;
  /** curve[d] = typical share of the month's spend done by the end of day d (1-based; 0 at index 0). Null without enough dated history. */
  curve: number[] | null;
  /** Per-transaction median and MAD, for "unusual transaction". */
  txMedian: number;
  txMad: number;
  txCount: number;
}

export interface Ctx extends CoachInput {
  cat: Map<string, Category>;
  acc: Map<string, Account>;
  month: string;
  day: number;
  dim: number;
  daysLeft: number;
  /** Transactions dated on/before today. */
  past: Transaction[];
  /** This month so far. */
  monthTxs: Transaction[];
  /** Spending (expenses + debt payments, CRC) by category, this month so far. */
  spent: Map<string, number>;
  budget: (categoryId: string, month?: string) => number;
  /** Complete months before this one that have any data, newest first (max 6). */
  history: string[];
  baselines: Map<string, Baseline>;
  avgMonthlyIncome: number;
  avgSalaryPerQuincena: number;
  balances: Map<string, AccountBalance>;
  /** Spending accounts (checking/cash) with no statement yet: safe-to-spend can't be trusted. */
  unknownBalance: Account[];
  /** Oldest latest-statement date among spending accounts. */
  balanceAsOf?: string;
  /** Best known balance per account (statement-anchored). */
  known: Map<string, number>;
  /** Checking + cash, minus money set aside for someone else: what you can actually spend from. */
  spendable: number;
  lastPayday: string;
  nextPayday: string;
  daysToPayday: number;
  isSalaryCategory: (c?: Category) => boolean;
  postedIds: Set<string>;
  say: (direct: string, gentle: string) => string;
  /** Rule thresholds: rule defaults merged with your Settings. */
  param: <T extends Record<string, number | boolean>>(ruleId: string, defaults: T) => T & { on: boolean };
}

/** The spending amount of a transaction for category totals (CRC only; dollars entered with a rate are CRC already). */
export function spendOf(t: Transaction): { categoryId?: string; amount: number } | null {
  if (t.currency !== 'CRC') return null;
  if (t.kind === 'expense') return { categoryId: t.categoryId, amount: t.amount };
  if (t.kind === 'debt_payment') return { categoryId: t.categoryId, amount: t.amount };
  return null;
}

/** Quincena paydays (15th and the last day). */
export function paydaysAround(today: string): { last: string; next: string } {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)), d = Number(today.slice(8, 10));
  const mid = toISO(y, m, 15), end = lastDayOfMonth(y, m);
  const prevEnd = m === 1 ? lastDayOfMonth(y - 1, 12) : lastDayOfMonth(y, m - 1);
  const nextMid = m === 12 ? toISO(y + 1, 1, 15) : toISO(y, m + 1, 15);
  if (d < 15) return { last: prevEnd, next: mid };
  if (today < end) return { last: mid, next: end };
  return { last: end, next: nextMid };
}

export function buildContext(input: CoachInput): Ctx {
  const { today, transactions, categories, accounts } = input;
  const cat = new Map(categories.map((c) => [c.id, c]));
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const month = today.slice(0, 7);
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const day = Number(today.slice(8, 10));
  const dim = daysInMonth(y, m);
  // Undated workbook rows sit on the month's last day but were already logged: they count as happened.
  const happened = (t: Transaction) => t.date <= today || (t.dateEstimated && t.date.slice(0, 7) === today.slice(0, 7));
  const past = transactions.filter(happened);
  const monthTxs = past.filter((t) => t.date.startsWith(month));

  const spent = new Map<string, number>();
  for (const t of monthTxs) { const s = spendOf(t); if (s?.categoryId) spent.set(s.categoryId, (spent.get(s.categoryId) ?? 0) + s.amount); }

  // History: complete months before this one with data, newest first, max 6.
  const months = [...new Set(past.map((t) => t.date.slice(0, 7)))].filter((mk) => mk < month).sort().reverse().slice(0, 6);

  // Baselines per category from complete months.
  const baselines = new Map<string, Baseline>();
  const perCatMonth = new Map<string, Map<string, number>>();
  const perCatTx = new Map<string, number[]>();
  const perCatDated = new Map<string, Map<string, number[]>>(); // cat → month → [amount by day 1..31]
  for (const t of past) {
    const mk = t.date.slice(0, 7);
    if (!months.includes(mk)) continue;
    const s = spendOf(t);
    if (!s?.categoryId) continue;
    const pm = perCatMonth.get(s.categoryId) ?? new Map<string, number>();
    pm.set(mk, (pm.get(mk) ?? 0) + s.amount); perCatMonth.set(s.categoryId, pm);
    if (!t.tags.includes('migrated-summary')) (perCatTx.get(s.categoryId) ?? perCatTx.set(s.categoryId, []).get(s.categoryId)!).push(s.amount);
    // Undated rows and old monthly-total rows sit on the last day: they'd teach a false "all spending on day 30" curve.
    if (!t.dateEstimated && !t.tags.includes('migrated-summary')) {
      const dm = perCatDated.get(s.categoryId) ?? new Map<string, number[]>();
      const arr = dm.get(mk) ?? Array<number>(32).fill(0);
      arr[Number(t.date.slice(8, 10))]! += s.amount; dm.set(mk, arr); perCatDated.set(s.categoryId, dm);
    }
  }
  for (const c of categories) {
    const pm = perCatMonth.get(c.id);
    const totals = months.map((mk) => pm?.get(mk) ?? 0);
    const used = totals.filter((x) => x > 0);
    // Day curve only from months whose spending in this category was fully dated.
    const dm = perCatDated.get(c.id);
    let curve: number[] | null = null;
    const good = [...(dm?.entries() ?? [])].filter(([mk, arr]) => arr.reduce((s, x) => s + x, 0) >= (pm?.get(mk) ?? 0) * 0.9 && (pm?.get(mk) ?? 0) > 0);
    if (good.length >= 3) {
      curve = Array<number>(32).fill(0);
      for (const [mk, arr] of good) {
        const tot = pm!.get(mk)!;
        let run = 0;
        for (let d = 1; d <= 31; d++) { run += arr[d]!; curve[d]! += run / tot / good.length; }
      }
    }
    const txs = perCatTx.get(c.id) ?? [];
    baselines.set(c.id, { months: used.length, median: median(totals), spread: mad(totals) * 1.4826, curve, txMedian: median(txs), txMad: mad(txs), txCount: txs.length });
  }

  const isSalaryCategory = (c?: Category) => !!c && c.group === 'Income' && SALARY_RE.test(c.name);
  const incomeMonths = months.slice(0, 3);
  const incomeOf = (mk: string) => input.flows.get(mk)?.income ?? 0;
  const avgMonthlyIncome = incomeMonths.length ? incomeMonths.reduce((s, mk) => s + incomeOf(mk), 0) / incomeMonths.length : incomeOf(month);
  const salaryMonths = incomeMonths.map((mk) => past.filter((t) => t.kind === 'income' && t.date.startsWith(mk) && isSalaryCategory(cat.get(t.categoryId))).reduce((s, t) => s + (t.kind === 'income' ? t.amount : 0), 0)).filter((x) => x > 0);
  const avgSalaryPerQuincena = salaryMonths.length ? median(salaryMonths) / 2 : 0;

  const balances = accountBalances(accounts, past);
  // Best known balance: the latest statement on/before today plus movements after it; else the ledger.
  const known = new Map<string, number>();
  for (const a of accounts) {
    const snap = (input.snapshots ?? []).filter((s) => s.accountId === a.id && s.date <= today).sort((x, y) => x.date.localeCompare(y.date)).at(-1);
    if (!snap) { known.set(a.id, balances.get(a.id)?.total ?? 0); continue; }
    let v = snap.balance;
    // A balance you typed already includes everything logged before it, including undated rows of that month.
    for (const t of past) if (t.date > snap.date && !(t.dateEstimated && t.date.slice(0, 7) <= snap.date.slice(0, 7))) for (const l of legs(t)) if (l.accountId === a.id) v += l.amount;
    known.set(a.id, v);
  }
  // Spending accounts with activity but no statement: their balance is a guess, so balance-based rules stay quiet.
  const used = new Set(past.flatMap((t) => legs(t).map((l) => l.accountId)));
  const spendingAccounts = accounts.filter((a) => !a.archived && a.currency === 'CRC' && ['checking', 'cash'].includes(a.type) && (used.has(a.id) || a.openingBalance));
  const stmt = (id: string) => (input.snapshots ?? []).filter((s) => s.accountId === id && s.date <= today).map((s) => s.date).sort().at(-1);
  const unknownBalance = spendingAccounts.filter((a) => !stmt(a.id));
  const balanceAsOf = spendingAccounts.map((a) => stmt(a.id)).filter(Boolean).sort()[0];
  let spendable = 0;
  for (const a of accounts) {
    if (a.archived || a.currency !== 'CRC' || !['checking', 'cash'].includes(a.type)) continue;
    const b = balances.get(a.id);
    const hers = [...(b?.pots.entries() ?? [])].filter(([pid]) => input.pots.find((p) => p.id === pid)?.owner === 'hers').reduce((s, [, v]) => s + Math.max(0, v), 0);
    spendable += (known.get(a.id) ?? 0) - hers;
  }

  const { last, next } = paydaysAround(today);
  const ruleCfg = input.prefs.rules ?? {};
  return {
    ...input, cat, acc, month, day, dim, daysLeft: dim - day, past, monthTxs, spent,
    budget: (id, mk = month) => budgetFor(input.budgets, id, mk),
    history: months, baselines, avgMonthlyIncome, avgSalaryPerQuincena, balances, known, spendable, unknownBalance, balanceAsOf,
    lastPayday: last, nextPayday: next, daysToPayday: diffDays(today, next), isSalaryCategory,
    postedIds: new Set(transactions.map((t) => t.id)),
    say: (direct, gentle) => (input.prefs.tone === 'gentle' as CoachTone ? gentle : direct),
    param: (ruleId, defaults) => ({ on: true, ...defaults, ...(ruleCfg[ruleId] ?? {}) }) as never,
  };
}

/** Recurring occurrences already posted (auto/confirmed) or logged by hand that month in the same category. */
export function occurrencePosted(ctx: Ctx, ruleId: string, date: string, categoryId?: string, amount?: number): boolean {
  if (ctx.postedIds.has(recurringTxId(ruleId, date))) return true;
  if (!categoryId) return false;
  const mk = date.slice(0, 7);
  return ctx.past.some((t) => t.date.startsWith(mk) && 'categoryId' in t && t.categoryId === categoryId && (!amount || ('amount' in t && Math.abs(t.amount - amount) <= amount * 0.1)));
}
