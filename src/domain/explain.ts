/**
 * "Where does this balance come from?": an account's balance taken apart into its
 * starting balance and every month's movements, side by side with the bank's
 * statement figures, so a gap points at the month (and the movements) to look at.
 */
import type { Account, BalanceSnapshot, Transaction } from './schemas';
import { balancesNow } from './ledger';
import { monthKey, type ISODate } from '../lib/dates';

export interface ExplainMonth {
  month: string;
  /** Money logged into / out of this account that month (céntimos). */
  in: number; out: number;
  /** App balance at the end of the month. */
  appEnd: number;
  /** Bank statement figure for that month, when you have one. */
  statement?: { date: ISODate; balance: number };
  /** statement − app balance on the statement's date. */
  gap?: number;
  /** How much the bank balance changed vs the previous statement, and how much the app logged. */
  bankChange?: number; loggedChange?: number;
}
export interface ExplainResult {
  opening: { date: ISODate; amount: number };
  /** Movements dated before the opening date: shown in reports, not in the balance. */
  beforeOpening: { count: number; net: number };
  months: ExplainMonth[];
  total: number;
  biggest: { tx: Transaction; signed: number }[];
}

/** Signed effect of a movement on this account (0 if it doesn't touch it). */
export function effectOn(t: Transaction, accountId: string): number {
  let v = 0;
  if ('from' in t && t.from.accountId === accountId) v -= t.amount;
  if ('to' in t && t.to.accountId === accountId) v += t.kind === 'transfer' && t.toAmount ? t.toAmount : t.amount;
  if (t.kind === 'adjustment' && t.side.accountId === accountId) v += t.signedAmount;
  return v;
}

export function explainBalance(account: Account, accounts: Account[], txs: Transaction[], snapshots: BalanceSnapshot[], today: ISODate): ExplainResult {
  const mine = txs.filter((t) => effectOn(t, account.id) !== 0);
  const counted = mine.filter((t) => t.date >= account.openingDate);
  const before = mine.filter((t) => t.date < account.openingDate);
  const snaps = snapshots.filter((s) => s.accountId === account.id).sort((a, b) => a.date.localeCompare(b.date));
  const monthsSet = new Set<string>([...counted.map((t) => monthKey(t.date)), ...snaps.filter((s) => s.date >= account.openingDate).map((s) => monthKey(s.date))]);
  const months = [...monthsSet].sort();
  let running = account.openingBalance;
  let prevStmt: number | undefined = snaps.filter((s) => s.date < account.openingDate).at(-1)?.balance;
  const out: ExplainMonth[] = [];
  for (const m of months) {
    const ts = counted.filter((t) => t.date.startsWith(m));
    const inn = ts.reduce((s, t) => s + Math.max(0, effectOn(t, account.id)), 0);
    const outt = ts.reduce((s, t) => s + Math.max(0, -effectOn(t, account.id)), 0);
    running += inn - outt;
    const st = snaps.filter((s) => s.date.startsWith(m)).at(-1);
    const row: ExplainMonth = { month: m, in: inn, out: outt, appEnd: running };
    if (st) {
      const appAt = balancesNow(accounts, txs, st.date).get(account.id)?.total ?? 0;
      row.statement = { date: st.date, balance: st.balance };
      row.gap = st.balance - appAt;
      if (prevStmt !== undefined) { row.bankChange = st.balance - prevStmt; row.loggedChange = inn - outt; }
      prevStmt = st.balance;
    }
    out.push(row);
  }
  const biggest = counted.map((tx) => ({ tx, signed: effectOn(tx, account.id) })).sort((a, b) => Math.abs(b.signed) - Math.abs(a.signed)).slice(0, 10);
  void today;
  return {
    opening: { date: account.openingDate, amount: account.openingBalance },
    beforeOpening: { count: before.length, net: before.reduce((s, t) => s + effectOn(t, account.id), 0) },
    months: out, total: running, biggest,
  };
}
