/**
 * Ledger derivation. Everything the app shows (balances, monthly flows, debt
 * balances) is computed here from transactions. Nothing is stored, so nothing drifts.
 *
 * Classification rules (the anti-double-count contract):
 *  - income        → Income
 *  - expense       → Expenses (by category / splits)
 *  - debt_payment  → Expenses AND Debt service (it's a subset, counted once)
 *  - savings       → Saved (+ deposit / − withdrawal). Never an expense.
 *  - transfer      → nothing. Moves money between my own places.
 *  - adjustment    → nothing in flows; only fixes balances.
 *  - Any expense or debt payment paid FROM a savings place (a pot, or a savings-type
 *    account) also reduces Saved by the same amount. The money was already
 *    counted as saved when it went in, so free cash is not hit twice.
 */
import type { Account, Debt, Side, Transaction } from './schemas';
import { monthKey, type ISODate, type MonthKey } from '../lib/dates';
import { MoneyError } from '../lib/money';

export interface Posting { accountId: string; potId?: string; amount: number }

export function legs(tx: Transaction): Posting[] {
  const p = (side: Side, amount: number): Posting => ({ accountId: side.accountId, potId: side.potId, amount });
  switch (tx.kind) {
    case 'income': return [p(tx.to, tx.amount)];
    case 'expense': return [p(tx.from, -tx.amount)];
    case 'debt_payment': return [p(tx.from, -tx.amount)];
    case 'transfer': return [p(tx.from, -tx.amount), p(tx.to, tx.toAmount ?? tx.amount)];
    case 'savings': return [p(tx.from, -tx.amount), p(tx.to, tx.amount)];
    case 'adjustment': return [p(tx.side, tx.signedAmount)];
  }
}

export const SAVINGS_ACCOUNT_TYPES: ReadonlySet<Account['type']> = new Set([
  'savings', 'goal_savings', 'association_voluntary', 'association_cesantia', 'loan_fund', 'investment',
]);

export interface AccountBalance {
  accountId: string;
  total: number;
  /** Per pot. Money in the account not assigned to any pot is under `unassigned`. */
  pots: Map<string, number>;
  unassigned: number;
}

/** Balance = opening balance + every posting dated on/after the opening date (and ≤ asOf). */
export function accountBalances(accounts: Account[], txs: Transaction[], asOf?: ISODate): Map<string, AccountBalance> {
  const out = new Map<string, AccountBalance>();
  const opening = new Map<string, ISODate>();
  for (const a of accounts) {
    out.set(a.id, { accountId: a.id, total: a.openingBalance, pots: new Map(), unassigned: a.openingBalance });
    opening.set(a.id, a.openingDate);
  }
  for (const tx of txs) {
    if (asOf && tx.date > asOf) continue;
    for (const leg of legs(tx)) {
      const b = out.get(leg.accountId);
      if (!b) throw new MoneyError(`Transaction ${tx.id} points at unknown account ${leg.accountId}`);
      if (tx.date < opening.get(leg.accountId)!) continue;
      b.total += leg.amount;
      if (leg.potId) b.pots.set(leg.potId, (b.pots.get(leg.potId) ?? 0) + leg.amount);
      else b.unassigned += leg.amount;
      if (!Number.isSafeInteger(b.total)) throw new MoneyError('Balance overflow');
    }
  }
  return out;
}

export interface MonthFlow {
  month: MonthKey;
  income: number;
  /** All outflows that are consumption or debt service (includes debtService). */
  expenses: number;
  debtService: number;
  /** Net saved: deposits − withdrawals − spending paid from savings. */
  saved: number;
  /** Part of `expenses` that was paid from savings/pots (already counted when saved). */
  paidFromSavings: number;
  /** Signed totals by category id (savings withdrawals are negative). */
  byCategory: Map<string, number>;
  net: number;      // income − expenses
  freeCash: number; // net − saved
}

export interface FlowContext {
  accountType: (accountId: string) => Account['type'] | undefined;
  /** Convert a transaction's amount into base-currency minor units. Defaults to identity for CRC. */
  toBase?: (amount: number, tx: Transaction) => number;
}

export function isSavingsPlace(side: Side, ctx: FlowContext): boolean {
  if (side.potId) return true;
  const t = ctx.accountType(side.accountId);
  return t !== undefined && SAVINGS_ACCOUNT_TYPES.has(t);
}

function emptyFlow(month: MonthKey): MonthFlow {
  return { month, income: 0, expenses: 0, debtService: 0, saved: 0, paidFromSavings: 0, byCategory: new Map(), net: 0, freeCash: 0 };
}

export function monthlyFlows(txs: Transaction[], ctx: FlowContext): Map<MonthKey, MonthFlow> {
  const flows = new Map<MonthKey, MonthFlow>();
  const base = (amt: number, tx: Transaction) => {
    if (ctx.toBase) return ctx.toBase(amt, tx);
    if (tx.currency !== 'CRC') throw new MoneyError(`Need an exchange rate for ${tx.currency} transaction ${tx.id}`);
    return amt;
  };
  const addCat = (f: MonthFlow, cat: string | undefined, amt: number) => {
    if (cat) f.byCategory.set(cat, (f.byCategory.get(cat) ?? 0) + amt);
  };
  for (const tx of txs) {
    const m = monthKey(tx.date);
    let f = flows.get(m);
    if (!f) flows.set(m, (f = emptyFlow(m)));
    switch (tx.kind) {
      case 'income': {
        const a = base(tx.amount, tx);
        f.income += a; addCat(f, tx.categoryId, a);
        break;
      }
      case 'expense': {
        const a = base(tx.amount, tx);
        f.expenses += a;
        if (tx.splits?.length) for (const s of tx.splits) addCat(f, s.categoryId, base(s.amount, tx));
        else addCat(f, tx.categoryId, a);
        if (isSavingsPlace(tx.from, ctx)) { f.saved -= a; f.paidFromSavings += a; }
        break;
      }
      case 'debt_payment': {
        const a = base(tx.amount, tx);
        f.expenses += a; f.debtService += a; addCat(f, tx.categoryId, a);
        if (isSavingsPlace(tx.from, ctx)) { f.saved -= a; f.paidFromSavings += a; }
        break;
      }
      case 'savings': {
        const a = base(tx.amount, tx) * (tx.direction === 'deposit' ? 1 : -1);
        f.saved += a; addCat(f, tx.categoryId, a);
        break;
      }
      case 'transfer':
      case 'adjustment':
        break;
    }
  }
  for (const f of flows.values()) {
    f.net = f.income - f.expenses;
    f.freeCash = f.net - f.saved;
  }
  return flows;
}

export interface DebtStatus {
  debtId: string;
  principalPaid: number;
  interestPaid: number;
  balance: number;
  /** Confirmed (statement) balance minus derived balance; 0 when they agree or no confirmation exists. */
  gapVsConfirmed: number;
}

export function debtStatus(debt: Debt, txs: Transaction[]): DebtStatus {
  let principalPaid = 0, interestPaid = 0;
  for (const tx of txs) {
    if (tx.kind !== 'debt_payment' || tx.debtId !== debt.id) continue;
    principalPaid += tx.amount - tx.interestPortion;
    interestPaid += tx.interestPortion;
  }
  const balance = debt.originalAmount - principalPaid;
  let gap = 0;
  if (debt.confirmedBalance) {
    const upTo = txs
      .filter((t) => t.kind === 'debt_payment' && t.debtId === debt.id && t.date <= debt.confirmedBalance!.date)
      .reduce((s, t) => s + (t.kind === 'debt_payment' ? t.amount - t.interestPortion : 0), 0);
    gap = debt.confirmedBalance.amount - (debt.originalAmount - upTo);
  }
  return { debtId: debt.id, principalPaid, interestPaid, balance, gapVsConfirmed: gap };
}
