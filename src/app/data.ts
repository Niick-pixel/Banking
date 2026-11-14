import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '../db/db';
import { accountBalances, monthlyFlows, type AccountBalance, type MonthFlow } from '../domain/ledger';
import type { Account, Budget, Category, Debt, InstallmentPlan, Pot, Transaction, BalanceSnapshot, ImportBatch } from '../domain/schemas';

export interface Ledger {
  ready: boolean;
  accounts: Account[]; pots: Pot[]; categories: Category[]; transactions: Transaction[];
  debts: Debt[]; installments: InstallmentPlan[]; snapshots: BalanceSnapshot[]; batches: ImportBatch[]; budgets: Budget[];
  account: Map<string, Account>; pot: Map<string, Pot>; category: Map<string, Category>;
  balances: Map<string, AccountBalance>;
  flows: Map<string, MonthFlow>;
}

export function useLedger(): Ledger {
  const raw = useLiveQuery(async () => ({
    accounts: await db.accounts.toArray(),
    pots: await db.pots.toArray(),
    categories: await db.categories.orderBy('group').toArray(),
    transactions: await db.transactions.orderBy('date').reverse().toArray(),
    debts: await db.debts.toArray(),
    installments: await db.installments.toArray(),
    snapshots: await db.snapshots.orderBy('date').toArray(),
    batches: await db.importBatches.orderBy('importedAt').reverse().toArray(),
    budgets: await db.budgets.toArray(),
  }), []);
  return useMemo(() => {
    const r = raw ?? { accounts: [], pots: [], categories: [], transactions: [], debts: [], installments: [], snapshots: [], batches: [], budgets: [] };
    const account = new Map(r.accounts.map((a) => [a.id, a]));
    let balances = new Map<string, AccountBalance>();
    let flows = new Map<string, MonthFlow>();
    try {
      balances = accountBalances(r.accounts, r.transactions);
      flows = monthlyFlows(r.transactions.filter((t) => t.currency === 'CRC'), { accountType: (id) => account.get(id)?.type });
    } catch (e) { console.error(e); }
    r.transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));
    r.categories.sort((a, b) => a.group.localeCompare(b.group) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    return {
      ready: !!raw, ...r, account, balances, flows,
      pot: new Map(r.pots.map((p) => [p.id, p])),
      category: new Map(r.categories.map((c) => [c.id, c])),
    };
  }, [raw]);
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
