/**
 * Monthly balance sheet. Each account's month-end figure is the statement you
 * entered for that month (snapshot) if there is one, otherwise the ledger balance.
 * Liabilities: debts (derived), credit-card balances, and Tasa Cero cuotas not
 * yet billed. Self-loans are NOT liabilities: the savings balance already shows
 * the money is gone.
 */
import type { Account, BalanceSnapshot, Debt, InstallmentPlan, Pot, Transaction } from './schemas';
import { accountBalances, debtStatus } from './ledger';
import { planProgress } from './installments';
import { lastDayOfMonth, type ISODate } from '../lib/dates';

export interface AccountMonth { accountId: string; balance: number; source: 'statement' | 'ledger' }
export interface BalanceSheet {
  month: string; date: ISODate;
  accounts: AccountMonth[];
  assets: number;
  debts: { debtId: string; balance: number }[];
  creditCards: number;
  tasaCeroPending: number;
  liabilities: number;
  netWorth: number;
  change?: number;
}

export interface NetWorthInput { accounts: Account[]; snapshots: BalanceSnapshot[]; transactions: Transaction[]; debts: Debt[]; installments: InstallmentPlan[] }

export function balanceSheet(inp: NetWorthInput, year: number, month: number, today: ISODate): BalanceSheet | null {
  const monthEnd = lastDayOfMonth(year, month);
  const mk = monthEnd.slice(0, 7);
  const asOf = monthEnd < today ? monthEnd : today;
  const live = inp.accounts.filter((a) => a.openingDate <= monthEnd);
  if (!live.length) return null;
  const ledger = accountBalances(inp.accounts, inp.transactions.filter((t) => t.date <= asOf), asOf);
  const accounts: AccountMonth[] = live.map((a) => {
    const snap = inp.snapshots.filter((s) => s.accountId === a.id && s.date.startsWith(mk)).sort((x, y) => x.date.localeCompare(y.date)).at(-1);
    return snap ? { accountId: a.id, balance: snap.balance, source: 'statement' } : { accountId: a.id, balance: ledger.get(a.id)?.total ?? 0, source: 'ledger' };
  });
  const isCard = new Set(live.filter((a) => a.type === 'credit_card').map((a) => a.id));
  const assets = accounts.filter((a) => !isCard.has(a.accountId)).reduce((s, a) => s + a.balance, 0);
  const creditCards = -accounts.filter((a) => isCard.has(a.accountId)).reduce((s, a) => s + a.balance, 0);
  const txUpTo = inp.transactions.filter((t) => t.date <= asOf);
  const debts = inp.debts
    .filter((d) => d.startDate <= monthEnd)
    .map((d) => {
      const st = debtStatus({ ...d, adjustments: (d.adjustments ?? []).filter((x) => x.date <= asOf) }, txUpTo);
      return { debtId: d.id, balance: Math.max(0, st.balance) };
    })
    .filter((d) => d.balance > 0);
  const tasaCeroPending = inp.installments.filter((p) => p.purchaseDate <= asOf).reduce((s, p) => s + planProgress(p, asOf).pending, 0);
  const liabilities = debts.reduce((s, d) => s + d.balance, 0) + Math.max(0, creditCards) + tasaCeroPending;
  return { month: mk, date: monthEnd, accounts, assets, debts, creditCards, tasaCeroPending, liabilities, netWorth: assets - liabilities };
}

/** Balance sheets for every month of `year` up to `today`, with month-over-month change. */
export function netWorthSeries(inp: NetWorthInput, year: number, today: ISODate): BalanceSheet[] {
  const lastMonth = Number(today.slice(0, 4)) === year ? Number(today.slice(5, 7)) : Number(today.slice(0, 4)) > year ? 12 : 0;
  // Start at the first month that has real data (a movement, a statement, or a non-zero opening balance).
  const firsts = [
    ...inp.transactions.map((t) => t.date), ...inp.snapshots.map((s) => s.date),
    ...inp.accounts.filter((a) => a.openingBalance !== 0).map((a) => a.openingDate),
  ].sort();
  const first = firsts[0];
  const startMonth = !first ? lastMonth + 1 : Number(first.slice(0, 4)) < year ? 1 : Number(first.slice(0, 4)) > year ? 13 : Number(first.slice(5, 7));
  const out: BalanceSheet[] = [];
  for (let m = startMonth; m <= lastMonth; m++) {
    const b = balanceSheet(inp, year, m, today);
    if (!b) continue;
    const prev = out.at(-1);
    if (prev) b.change = b.netWorth - prev.netWorth;
    out.push(b);
  }
  return out;
}

export interface EmergencyFund { liquid: number; cesantia: number; monthlyEssentials: number; liquidMonths: number; totalMonths: number; earmarkedExcluded: number }

/**
 * Liquid money (liquid accounts, minus money set aside for someone else, e.g. her
 * loan fund) ÷ average monthly essential costs (Fixed + Living). "Total" also counts
 * the cesantía reserve, which you only get when the job ends.
 */
export function emergencyFund(sheet: BalanceSheet, accounts: Account[], pots: Pot[], potBalances: Map<string, number>, monthlyEssentials: number): EmergencyFund {
  const acc = new Map(accounts.map((a) => [a.id, a]));
  let liquid = 0, cesantia = 0;
  for (const a of sheet.accounts) {
    const x = acc.get(a.accountId);
    if (!x || x.type === 'credit_card') continue;
    if (x.type === 'association_cesantia') cesantia += a.balance;
    else if (x.isLiquid) liquid += a.balance;
  }
  const earmarked = pots.filter((p) => p.owner === 'hers' && acc.get(p.accountId)?.isLiquid).reduce((s, p) => s + Math.max(0, potBalances.get(p.id) ?? 0), 0);
  liquid -= earmarked;
  const months = (x: number) => (monthlyEssentials > 0 ? x / monthlyEssentials : 0);
  return { liquid, cesantia, monthlyEssentials, liquidMonths: months(liquid), totalMonths: months(liquid + cesantia), earmarkedExcluded: earmarked };
}
