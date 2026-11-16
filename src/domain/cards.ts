/**
 * Credit cards as debt. A card is an account whose balance is negative while you
 * owe money; here it's turned around into "owed", with due dates, how much of the
 * limit is used, and a payoff estimate at its interest rate.
 */
import type { Account, BalanceSnapshot } from './schemas';
import type { AccountBalance } from './ledger';
import { daysInMonth, type ISODate } from '../lib/dates';

export interface CardStatus {
  account: Account;
  owed: number;                 // ≥ 0, in the card's currency
  limit?: number;
  utilization?: number;         // owed / limit
  nextDue?: ISODate;
  daysToDue?: number;
  lastCheckIn?: ISODate;
}
export interface CardsSummary { cards: CardStatus[]; totalOwed: number; totalLimit: number; utilization?: number; nextDue?: CardStatus }

/** Next date that is day `day` of a month (31 = last day), on or after `today`. */
export function nextDayOfMonth(day: number, today: ISODate): ISODate {
  let [y, m] = today.split('-').map(Number) as [number, number];
  for (let i = 0; i < 2; i++) {
    const d = Math.min(day, daysInMonth(y, m));
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (iso >= today) return iso;
    m++; if (m > 12) { m = 1; y++; }
  }
  return today;
}

export function cardsSummary(accounts: Account[], balances: Map<string, AccountBalance>, snapshots: BalanceSnapshot[], today: ISODate): CardsSummary {
  const cards = accounts.filter((a) => a.type === 'credit_card' && !a.archived).map((account): CardStatus => {
    const owed = Math.max(0, -(balances.get(account.id)?.total ?? 0));
    const nextDue = account.cardDueDay ? nextDayOfMonth(account.cardDueDay, today) : undefined;
    const last = snapshots.filter((s) => s.accountId === account.id && s.date <= today).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
    return {
      account, owed, limit: account.cardLimit, utilization: account.cardLimit ? owed / account.cardLimit : undefined,
      nextDue, daysToDue: nextDue ? Math.round((Date.parse(nextDue) - Date.parse(today)) / 86_400_000) : undefined, lastCheckIn: last?.date,
    };
  }).sort((a, b) => b.owed - a.owed);
  const totalOwed = cards.reduce((s, c) => s + (c.account.currency === 'CRC' ? c.owed : 0), 0);
  const totalLimit = cards.reduce((s, c) => s + (c.account.currency === 'CRC' ? c.limit ?? 0 : 0), 0);
  const nextDue = cards.filter((c) => c.nextDue && c.owed > 0).sort((a, b) => a.nextDue!.localeCompare(b.nextDue!))[0];
  return { cards, totalOwed, totalLimit, utilization: totalLimit ? totalOwed / totalLimit : undefined, nextDue };
}
