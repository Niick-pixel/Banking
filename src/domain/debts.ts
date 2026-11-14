/**
 * Debt payoff engine. Integer céntimos throughout; interest is computed monthly
 * on the remaining balance (annual rate / 12) and rounded half-to-even. The last
 * payment is only what's left, so interest isn't overstated (the workbook's
 * "months × payment − balance" bug).
 */
import { roundHalfEven } from '../lib/money';
import { cuotaDate } from './installments';
import type { Debt, SelfLoan, Transaction, Category } from './schemas';
import type { ISODate } from '../lib/dates';

export const monthlyInterest = (balance: number, annualRateBps: number) => roundHalfEven((balance * annualRateBps) / 120_000);

export interface AmortRow { n: number; date: ISODate; payment: number; interest: number; principal: number; balance: number }
export interface Amortization { rows: AmortRow[]; months: number; totalInterest: number; totalPaid: number; payoffDate?: ISODate; never: boolean }

export function amortize(balance: number, annualRateBps: number, payment: number, firstPaymentDate: ISODate, maxMonths = 600): Amortization {
  const rows: AmortRow[] = [];
  let bal = balance, totalInterest = 0, totalPaid = 0;
  for (let n = 1; bal > 0 && n <= maxMonths; n++) {
    const interest = monthlyInterest(bal, annualRateBps);
    if (payment <= interest) return { rows, months: Infinity, totalInterest, totalPaid, never: true };
    const pay = Math.min(payment, bal + interest);
    const principal = pay - interest;
    bal -= principal; totalInterest += interest; totalPaid += pay;
    rows.push({ n, date: cuotaDate(firstPaymentDate, n), payment: pay, interest, principal, balance: bal });
  }
  if (bal > 0) return { rows, months: Infinity, totalInterest, totalPaid, never: true };
  return { rows, months: rows.length, totalInterest, totalPaid, payoffDate: rows.at(-1)?.date, never: false };
}

/** Level payment that clears `balance` in `months` (annuity), rounded UP to the whole colón. */
export function paymentForTerm(balance: number, annualRateBps: number, months: number): number {
  if (annualRateBps === 0) return Math.ceil(balance / months / 100) * 100;
  const r = annualRateBps / 120_000;
  const p = (balance * r) / (1 - Math.pow(1 + r, -months));
  return Math.ceil(p / 100) * 100;
}

export type Verdict = 'Comfortable' | 'Aggressive' | 'Too tight';
/** Same thresholds as the workbook: > 25% of income too tight, > 15% aggressive. */
export const verdict = (pctOfIncome: number): Verdict => (pctOfIncome > 0.25 ? 'Too tight' : pctOfIncome > 0.15 ? 'Aggressive' : 'Comfortable');

export interface Scenario { months: number; payment: number; totalRepaid: number; interest: number; pctOfIncome: number; verdict: Verdict; payoffDate?: ISODate }

export function scenarios(balance: number, annualRateBps: number, avgMonthlyIncome: number, firstPaymentDate: ISODate, terms = [3, 4, 6, 9, 12]): Scenario[] {
  return terms.map((months) => {
    const payment = paymentForTerm(balance, annualRateBps, months);
    const a = amortize(balance, annualRateBps, payment, firstPaymentDate);
    const pct = avgMonthlyIncome ? payment / avgMonthlyIncome : 0;
    return { months, payment, totalRepaid: a.totalPaid, interest: a.totalInterest, pctOfIncome: pct, verdict: verdict(pct), payoffDate: a.payoffDate };
  });
}

export interface Acceleration { base: Amortization; faster: Amortization; monthsSaved: number; interestSaved: number }
export function accelerate(balance: number, annualRateBps: number, payment: number, extra: number, firstPaymentDate: ISODate): Acceleration {
  const base = amortize(balance, annualRateBps, payment, firstPaymentDate);
  const faster = amortize(balance, annualRateBps, payment + extra, firstPaymentDate);
  return {
    base, faster,
    monthsSaved: base.never ? Infinity : base.months - faster.months,
    interestSaved: base.never ? Infinity : base.totalInterest - faster.totalInterest,
  };
}

// ── Several debts: avalanche vs snowball ───────────────────────────────────
export interface StrategyDebt { id: string; balance: number; annualRateBps: number; minPayment: number }
export interface StrategyResult { order: string[]; months: number; totalInterest: number; payoffMonth: Record<string, number>; never: boolean }

/**
 * Pay every debt's minimum, then throw everything left of `monthlyBudget` at the
 * target debt. When a debt is cleared, its minimum rolls into the next target.
 */
export function payoffStrategy(debts: StrategyDebt[], monthlyBudget: number, kind: 'avalanche' | 'snowball', maxMonths = 600): StrategyResult {
  const order = [...debts]
    .sort((a, b) => (kind === 'avalanche' ? b.annualRateBps - a.annualRateBps || a.balance - b.balance : a.balance - b.balance || b.annualRateBps - a.annualRateBps))
    .map((d) => d.id);
  const bal = new Map(debts.map((d) => [d.id, d.balance]));
  const payoffMonth: Record<string, number> = {};
  let totalInterest = 0, m = 0;
  const live = () => [...bal.values()].some((b) => b > 0);
  while (live() && m < maxMonths) {
    m++;
    for (const d of debts) {
      const b = bal.get(d.id)!;
      if (b > 0) { const i = monthlyInterest(b, d.annualRateBps); bal.set(d.id, b + i); totalInterest += i; }
    }
    let budget = monthlyBudget;
    for (const d of debts) {
      const b = bal.get(d.id)!;
      if (b <= 0) continue;
      const pay = Math.min(d.minPayment, b, budget);
      bal.set(d.id, b - pay); budget -= pay;
    }
    for (const id of order) {
      if (budget <= 0) break;
      const b = bal.get(id)!;
      if (b <= 0) continue;
      const pay = Math.min(b, budget);
      bal.set(id, b - pay); budget -= pay;
    }
    for (const d of debts) if (bal.get(d.id)! <= 0 && payoffMonth[d.id] === undefined) payoffMonth[d.id] = m;
    if (budget === monthlyBudget) break; // nothing could be paid
  }
  const never = live();
  return { order, months: never ? Infinity : m, totalInterest, payoffMonth, never };
}

// ── Debt service to income ─────────────────────────────────────────────────
export interface DebtServiceRatio { monthlyDebt: number; ratio: number; withRent: number; level: 'ok' | 'warn' | 'high' }
/** Warn above 20% of income; high above 36% including rent (the classic DTI ceiling). */
export function debtServiceRatio(monthlyDebt: number, monthlyRent: number, avgMonthlyIncome: number): DebtServiceRatio {
  const ratio = avgMonthlyIncome ? monthlyDebt / avgMonthlyIncome : 0;
  const withRent = avgMonthlyIncome ? (monthlyDebt + monthlyRent) / avgMonthlyIncome : 0;
  return { monthlyDebt, ratio, withRent, level: withRent > 0.36 ? 'high' : ratio > 0.2 ? 'warn' : 'ok' };
}

// ── Self-loans ─────────────────────────────────────────────────────────────
export interface SelfLoanProgress { loan: SelfLoan; putBack: number; remaining: number; done: boolean }

/**
 * Money put back = savings deposits linked to the loan, plus unlinked deposits
 * in a "Replenish" savings category dated on/after the loan, allocated oldest
 * loan first. Marking a loan "replenished" closes it regardless.
 */
export function selfLoanProgress(loans: SelfLoan[], txs: Transaction[], categories: Category[]): SelfLoanProgress[] {
  const replenishCats = new Set(categories.filter((c) => c.group === 'Savings' && /replenish|reponer/i.test(c.name)).map((c) => c.id));
  const linked = new Map<string, number>();
  const pool: { date: ISODate; amount: number }[] = [];
  for (const t of txs) {
    if (t.kind !== 'savings') continue;
    const sign = t.direction === 'deposit' ? 1 : -1;
    if (t.selfLoanId) linked.set(t.selfLoanId, (linked.get(t.selfLoanId) ?? 0) + sign * t.amount);
    else if (replenishCats.has(t.categoryId) && sign > 0) pool.push({ date: t.date, amount: t.amount });
  }
  pool.sort((a, b) => a.date.localeCompare(b.date));
  const sorted = [...loans].sort((a, b) => (a.borrowedOn ?? '').localeCompare(b.borrowedOn ?? ''));
  const out = new Map<string, SelfLoanProgress>();
  for (const loan of sorted) {
    let putBack = linked.get(loan.id) ?? 0;
    for (const p of pool) {
      if (putBack >= loan.amount) break;
      if (p.amount <= 0 || (loan.borrowedOn && p.date < loan.borrowedOn)) continue;
      const take = Math.min(p.amount, loan.amount - putBack);
      p.amount -= take; putBack += take;
    }
    const done = loan.status === 'replenished' || putBack >= loan.amount;
    out.set(loan.id, { loan, putBack, remaining: done ? 0 : loan.amount - putBack, done });
  }
  return loans.map((l) => out.get(l.id)!);
}

// ── Loan fund (money set aside in a pot to pay a debt) ─────────────────────
export interface FundProgress { owed: number; setAside: number; toSetAside: number; covered: number; payInFullBy?: ISODate; monthlyPlan: number }
export function fundProgress(owed: number, setAside: number, monthlyPlan: number, today: ISODate): FundProgress {
  const toSetAside = Math.max(0, owed - setAside);
  const covered = owed ? Math.min(1, setAside / owed) : 1;
  const months = monthlyPlan > 0 ? Math.ceil(toSetAside / monthlyPlan) : Infinity;
  return { owed, setAside, toSetAside, covered, monthlyPlan, payInFullBy: toSetAside === 0 ? today : Number.isFinite(months) ? cuotaDate(today, months + 1) : undefined };
}

/** Next payment date: the debt's fixed payment day next month, else the same day next month. */
export function nextPaymentDate(debt: Debt, today: ISODate): ISODate {
  const day = String(debt.checklist?.fixedPaymentDay ?? Number(today.slice(8))).padStart(2, '0');
  const anchor = `${today.slice(0, 8)}${day}`; // may be e.g. 02-31; cuotaDate clamps to month end
  const thisMonth = cuotaDate(anchor, 1);
  return thisMonth > today ? thisMonth : cuotaDate(anchor, 2);
}
