/**
 * Data-health checks: the workbook's silent bugs, made loud. Every check is a
 * pure function over the ledger; the Dashboard shows a badge, Settings the list.
 */
import type { Account, BalanceSnapshot, Budget, Category, Debt, Pot, SelfLoan, Transaction } from './schemas';
import { accountBalances, debtStatus, monthlyFlows } from './ledger';
import { selfLoanProgress } from './debts';
import { daysBetween, monthKey, type ISODate } from '../lib/dates';
import { formatMoney } from '../lib/money';

export interface HealthIssue { id: string; level: 'error' | 'warn' | 'info'; title: string; detail: string; to: string }
export interface HealthInput {
  accounts: Account[]; pots: Pot[]; categories: Category[]; transactions: Transaction[]; debts: Debt[];
  snapshots: BalanceSnapshot[]; budgets: Budget[]; selfLoans: SelfLoan[];
}
const fmt = (n: number) => formatMoney(n, 'CRC');
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g, ' ').trim();

/** Same kind, account and amount within ±1 day and a similar (or empty) description. */
export function possibleDuplicates(txs: Transaction[]): [Transaction, Transaction][] {
  const out: [Transaction, Transaction][] = [];
  const amountOf = (t: Transaction) => (t.kind === 'adjustment' ? t.signedAmount : t.amount);
  const acc = (t: Transaction) => ('from' in t ? t.from.accountId : 'to' in t ? t.to.accountId : t.side.accountId);
  const groups = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (('installmentPlanId' in t && t.installmentPlanId) || t.tags.includes('migrated-summary')) continue;
    const k = `${t.kind}|${acc(t)}|${amountOf(t)}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      const a = g[i]!, b = g[j]!;
      if (Math.abs(daysBetween(a.date, b.date)) > 1) break;
      const da = norm(a.description), db = norm(b.description);
      if (da === db || !da || !db || da.includes(db) || db.includes(da)) out.push([a, b]);
    }
  }
  return out;
}

export function dataHealth(inp: HealthInput, today: ISODate): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const catIds = new Set(inp.categories.filter((c) => !c.archived).map((c) => c.id));
  const accType = new Map(inp.accounts.map((a) => [a.id, a.type]));

  // 1. Uncategorised / pointing at a deleted category
  const uncat = inp.transactions.filter((t) => {
    if (t.kind === 'transfer' || t.kind === 'adjustment') return false;
    if (t.kind === 'expense' && t.splits?.length) return t.splits.some((s) => !catIds.has(s.categoryId));
    return !('categoryId' in t) || !t.categoryId || !catIds.has(t.categoryId);
  });
  if (uncat.length) issues.push({ id: 'uncategorized', level: 'warn', title: `${uncat.length} movement(s) without a valid category`, detail: 'They don\'t reach the Tracker. Open Transactions → filter → recategorize.', to: '/transactions' });

  // 2. Possible duplicates
  const dups = possibleDuplicates(inp.transactions);
  if (dups.length) issues.push({ id: 'duplicates', level: 'warn', title: `${dups.length} possible duplicate pair(s)`, detail: dups.slice(0, 3).map(([a]) => `${fmt(a.kind === 'adjustment' ? a.signedAmount : a.amount)} "${a.description || '—'}" on ${a.date}`).join(' · '), to: '/transactions' });

  // 3. Negative pots / non-card accounts below zero
  const bal = accountBalances(inp.accounts, inp.transactions);
  for (const p of inp.pots) {
    const b = bal.get(p.accountId)?.pots.get(p.id) ?? 0;
    if (b < 0) issues.push({ id: `pot-${p.id}`, level: 'error', title: `Pot "${p.name}" is negative (${fmt(b)})`, detail: 'More was taken out than was put in. Check the movements into this pot.', to: '/pots' });
  }
  for (const a of inp.accounts) {
    if (a.archived || a.type === 'credit_card') continue;
    const b = bal.get(a.id)?.total ?? 0;
    const hasSnap = inp.snapshots.some((s) => s.accountId === a.id);
    if (b < 0) issues.push({ id: `neg-${a.id}`, level: 'warn', title: `${a.name} is below zero (${fmt(b)})`, detail: hasSnap ? 'Compare with your statement in Accounts.' : 'Probably missing its real opening balance. Accounts → Edit.', to: '/accounts' });
  }

  // 4. Statement vs ledger
  for (const a of inp.accounts) {
    const last = inp.snapshots.filter((s) => s.accountId === a.id && s.date <= today).sort((x, y) => x.date.localeCompare(y.date)).at(-1);
    if (!last) continue;
    const ledger = accountBalances(inp.accounts, inp.transactions, last.date).get(a.id)?.total ?? 0;
    const diff = last.balance - ledger;
    if (diff !== 0) issues.push({ id: `stmt-${a.id}`, level: 'warn', title: `${a.name}: statement and ledger differ by ${fmt(diff)}`, detail: `Statement ${last.date}: ${fmt(last.balance)}, ledger: ${fmt(ledger)}. Movements are missing or an opening balance is off.`, to: '/accounts' });
  }

  // 5. Debts whose derived balance doesn't match the confirmed one
  for (const d of inp.debts) {
    const s = debtStatus(d, inp.transactions);
    if (s.gapVsConfirmed) issues.push({ id: `debt-${d.id}`, level: 'warn', title: `${d.creditor}: ledger and confirmed balance differ by ${fmt(Math.abs(s.gapVsConfirmed))}`, detail: 'Log the missing payment or record a non-cash adjustment.', to: '/debts' });
  }

  // 6. Months with no rent logged (rent has a budget), completed months only
  const rent = inp.categories.find((c) => /rent|alquiler/i.test(c.name) && inp.budgets.some((b) => b.categoryId === c.id && b.amount > 0));
  if (rent && inp.transactions.length) {
    const flows = monthlyFlows(inp.transactions.filter((t) => t.currency === 'CRC'), { accountType: (id) => accType.get(id) });
    const months = [...flows.keys()].sort();
    const current = monthKey(today);
    const missing = months.filter((m) => m < current && (flows.get(m)?.income ?? 0) > 0 && !(flows.get(m)?.byCategory.get(rent.id)));
    if (missing.length) issues.push({ id: 'rent', level: 'warn', title: `No ${rent.name.toLowerCase()} logged in ${missing.join(', ')}`, detail: 'Rent is budgeted every month. Was it paid and not logged?', to: '/transactions' });
  }

  // 7. Self-loans past their planned date
  for (const p of selfLoanProgress(inp.selfLoans, inp.transactions, inp.categories)) {
    if (!p.done && p.loan.plannedDate && p.loan.plannedDate < today) issues.push({ id: `sl-${p.loan.id}`, level: 'info', title: `Self-loan "${p.loan.description}" was planned to be put back by ${p.loan.plannedDate}`, detail: `${fmt(p.remaining)} still to replenish.`, to: '/debts' });
  }

  // 8. Estimated dates (informational)
  const est = inp.transactions.filter((t) => t.dateEstimated).length;
  if (est) issues.push({ id: 'estimated', level: 'info', title: `${est} movement(s) have an estimated date`, detail: 'They came from the workbook without a DATE and sit on the last day of their month. Month totals are still right.', to: '/transactions' });

  const order = { error: 0, warn: 1, info: 2 };
  return issues.sort((a, b) => order[a.level] - order[b.level]);
}
