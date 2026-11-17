import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useSyncExternalStore } from 'react';
import { db } from '../db/db';
import { balancesNow, monthlyFlows, type AccountBalance, type MonthFlow } from '../domain/ledger';
import type { Account, Budget, SelfLoan, Goal, RecurringRule, Category, Debt, InstallmentPlan, Pot, Transaction, BalanceSnapshot, ImportBatch } from '../domain/schemas';

export interface Ledger {
  ready: boolean;
  accounts: Account[]; pots: Pot[]; categories: Category[]; transactions: Transaction[];
  debts: Debt[]; installments: InstallmentPlan[]; snapshots: BalanceSnapshot[]; batches: ImportBatch[]; budgets: Budget[]; selfLoans: SelfLoan[]; goals: Goal[]; recurring: RecurringRule[];
  account: Map<string, Account>; pot: Map<string, Pot>; category: Map<string, Category>;
  balances: Map<string, AccountBalance>;
  flows: Map<string, MonthFlow>;
}

type Raw = Pick<Ledger, 'accounts' | 'pots' | 'categories' | 'transactions' | 'debts' | 'installments' | 'snapshots' | 'batches' | 'budgets' | 'selfLoans' | 'goals' | 'recurring'>;
/** Last loaded data, so forms that mount later start filled instead of empty for a frame. */
let lastRaw: Raw | undefined;

// One shared clock: every screen that reads the ledger refreshes each minute (and when the window
// comes back into focus), so "today", due dates and month totals stay current while the app is open.
// Changes you make (here or synced from another PC) already show up instantly through the live database query.
let minute = 0;
const listeners = new Set<() => void>();
const bump = () => { minute++; for (const f of listeners) f(); };
if (typeof window !== 'undefined') {
  setInterval(bump, 60_000);
  window.addEventListener('focus', bump);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) bump(); });
}
const subscribeMinute = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const useMinute = () => useSyncExternalStore(subscribeMinute, () => minute, () => 0);

export function useLedger(): Ledger {
  const tick = useMinute();
  const raw = useLiveQuery(async (): Promise<Raw> => ({
    accounts: await db.accounts.toArray(),
    pots: await db.pots.toArray(),
    categories: await db.categories.orderBy('group').toArray(),
    transactions: await db.transactions.orderBy('date').reverse().toArray(),
    debts: await db.debts.toArray(),
    installments: await db.installments.toArray(),
    snapshots: await db.snapshots.orderBy('date').toArray(),
    batches: await db.importBatches.orderBy('importedAt').reverse().toArray(),
    budgets: await db.budgets.toArray(),
    selfLoans: await db.selfLoans.toArray(),
    goals: await db.goals.toArray(),
    recurring: await db.recurring.toArray(),
  }), [], lastRaw);
  if (raw) lastRaw = raw;
  return useMemo(() => {
    const r = raw ?? { accounts: [], pots: [], categories: [], transactions: [], debts: [], installments: [], snapshots: [], batches: [], budgets: [], selfLoans: [], goals: [], recurring: [] };
    const account = new Map(r.accounts.map((a) => [a.id, a]));
    let balances = new Map<string, AccountBalance>();
    let flows = new Map<string, MonthFlow>();
    try {
      balances = balancesNow(r.accounts, r.transactions, todayISO());
      flows = monthlyFlows(r.transactions.filter((t) => t.currency === 'CRC'), { accountType: (id) => account.get(id)?.type });
    } catch (e) { console.error(e); }
    r.transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));
    r.categories.sort((a, b) => a.group.localeCompare(b.group) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    return {
      ready: !!raw, ...r, account, balances, flows,
      pot: new Map(r.pots.map((p) => [p.id, p])),
      category: new Map(r.categories.map((c) => [c.id, c])),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, tick]);
}

/** Learned suggestions: most-used category for words in the description, then overall frequency. */
export function suggestCategories(txs: Transaction[], description: string, kind: Transaction['kind']): string[] {
  const words = description.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const score = new Map<string, number>();
  for (const t of txs.slice(0, 2000)) {
    if (t.kind !== kind || !('categoryId' in t) || !t.categoryId) continue;
    const d = t.description.toLowerCase();
    const hit = words.filter((w) => d.includes(w)).length;
    score.set(t.categoryId, (score.get(t.categoryId) ?? 0) + 1 + hit * 25);
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

import { dataHealth } from '../domain/health';
import { todayISO } from '../lib/dates';

export function useHealth() {
  const l = useLedger();
  return useMemo(() => {
    try { return dataHealth({ accounts: l.accounts, pots: l.pots, categories: l.categories, transactions: l.transactions, debts: l.debts, snapshots: l.snapshots, budgets: l.budgets, selfLoans: l.selfLoans }, todayISO()); }
    catch (e) { console.error(e); return []; }
  }, [l]);
}
