/**
 * Balance check-in: once per quincena you type what the bank shows for each card
 * and account; the app records it and helps make the ledger match.
 */
import type { Account, BalanceSnapshot } from './schemas';
import type { ISODate } from '../lib/dates';

/** Start of the current quincena: the 16th from the 16th on, else the 1st. */
export function quincenaStart(today: ISODate): ISODate {
  return `${today.slice(0, 8)}${Number(today.slice(8, 10)) >= 16 ? '16' : '01'}`;
}

export interface CheckInStatus { account: Account; last?: BalanceSnapshot; due: boolean }

/** Every open account, cards first; due when nothing was checked in this quincena. */
export function checkInStatus(accounts: Account[], snapshots: BalanceSnapshot[], today: ISODate): CheckInStatus[] {
  const start = quincenaStart(today);
  const rank = (a: Account) => (a.type === 'credit_card' ? 0 : a.type === 'checking' || a.type === 'cash' ? 1 : 2);
  return accounts.filter((a) => !a.archived)
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .map((account) => {
      const last = snapshots.filter((s) => s.accountId === account.id && s.date <= today).sort((x, y) => x.date.localeCompare(y.date)).at(-1);
      return { account, last, due: !last || last.date < start };
    });
}

/**
 * What the bank says, as a signed ledger balance. Cards: an amount owed is negative.
 * A BAC card shows a colón part and a dollar part; the dollar part is converted at `rate` (céntimos per USD).
 */
export function statementBalance(account: Account, main: number, usdPart: number, rate: number | null): number {
  const usd = usdPart && rate ? Math.round((usdPart * rate) / 100) : 0;
  const total = main + usd;
  return account.type === 'credit_card' ? -Math.abs(total) : total;
}
