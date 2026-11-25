/**
 * Money I lent. Lending moves money from one of my accounts into the "Money I lent"
 * account (a transfer, so it's never spending); a repayment moves it back. What a
 * person still owes = everything lent to them − everything they paid back.
 */
import { legs } from './ledger';
import type { Account, Lending, Transaction } from './schemas';

export const LENT_ACCOUNT_NAME = 'Money I lent';
export const lentAccount = (accounts: Account[]) => accounts.find((a) => a.type === 'receivable' && !a.archived);

export interface LendingStatus { lending: Lending; lent: number; repaid: number; owed: number; movements: Transaction[]; lastRepaid?: string; overdue: boolean }

export function lendingStatus(l: Lending, txs: Transaction[], receivableId: string | undefined, today: string): LendingStatus {
  const movements = txs.filter((t) => t.lendingId === l.id).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  let lent = 0, repaid = 0;
  let lastRepaid: string | undefined;
  for (const t of movements) for (const g of legs(t)) {
    if (g.accountId !== receivableId) continue;
    if (g.amount > 0) lent += g.amount; else { repaid -= g.amount; lastRepaid = t.date; }
  }
  const owed = Math.max(0, lent - repaid);
  return { lending: l, lent, repaid, owed, movements, lastRepaid, overdue: l.status === 'open' && owed > 0 && !!l.dueDate && l.dueDate < today };
}

/** Per person: totals across all their open lendings. */
export function byPerson(rows: LendingStatus[]): { person: string; owed: number; count: number }[] {
  const m = new Map<string, { person: string; owed: number; count: number }>();
  for (const r of rows) {
    if (r.lending.status !== 'open') continue;
    const k = r.lending.person.trim().toLowerCase();
    const x = m.get(k) ?? { person: r.lending.person.trim(), owed: 0, count: 0 };
    x.owed += r.owed; x.count++;
    m.set(k, x);
  }
  return [...m.values()].sort((a, b) => b.owed - a.owed);
}
