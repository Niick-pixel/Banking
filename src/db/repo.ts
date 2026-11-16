/**
 * The only way the UI writes data. Every write is validated with Zod, recorded
 * in the audit log (so it can be undone), and goes through one place, where the
 * folder-vault persistence (desktop plan D1) will hook in.
 */
import { db, type AufwindDB } from './db';
import {
  AccountSchema, CategorySchema, SelfLoanSchema, GoalSchema, BalanceSnapshotSchema, RecurringRuleSchema, InstallmentPlanSchema, PotSchema, TransactionSchema, DebtSchema,
  type Account, type Category, type SelfLoan, type Goal, type BalanceSnapshot, type RecurringRule, type InstallmentPlan, type Pot, type Transaction, type Debt, type ImportBatch,
} from '../domain/schemas';
import type { ImportPlan } from '../import/workbook';
import { dueCuotaTransactions } from '../domain/installments';
import { buildOccurrence, dueOccurrences } from '../domain/recurring';
import { todayISO } from '../lib/dates';

export const newId = () => crypto.randomUUID();

type Table = 'transactions' | 'accounts' | 'pots' | 'categories' | 'installments' | 'debts' | 'selfLoans' | 'goals' | 'snapshots' | 'recurring';
const schemas = {
  transactions: TransactionSchema, accounts: AccountSchema, pots: PotSchema, categories: CategorySchema,
  installments: InstallmentPlanSchema, debts: DebtSchema, selfLoans: SelfLoanSchema, goals: GoalSchema, snapshots: BalanceSnapshotSchema, recurring: RecurringRuleSchema,
} as const;

async function audited<T extends { id: string }>(d: AufwindDB, table: Table, record: T): Promise<T> {
  const parsed = schemas[table].parse(record) as unknown as T;
  const before = await (d[table] as unknown as { get(id: string): Promise<T | undefined> }).get(parsed.id);
  await (d[table] as unknown as { put(v: T): Promise<unknown> }).put(parsed);
  await d.audit.add({ at: Date.now(), table, recordId: parsed.id, action: before ? 'update' : 'create', before, after: parsed });
  return parsed;
}

export async function saveTransaction(tx: Transaction, d = db) {
  return d.transaction('rw', d.transactions, d.audit, () => audited(d, 'transactions', { ...tx, updatedAt: Date.now() }));
}
export async function saveAccount(a: Account, d = db) {
  return d.transaction('rw', d.accounts, d.audit, () => audited(d, 'accounts', { ...a, updatedAt: Date.now() }));
}
export async function savePot(p: Pot, d = db) {
  return d.transaction('rw', d.pots, d.audit, () => audited(d, 'pots', { ...p, updatedAt: Date.now() }));
}
export async function saveCategory(c: Category, d = db) {
  return d.transaction('rw', d.categories, d.audit, () => audited(d, 'categories', { ...c, updatedAt: Date.now() }));
}
export async function saveSelfLoan(x: SelfLoan, d = db) {
  return d.transaction('rw', d.selfLoans, d.audit, () => audited(d, 'selfLoans', { ...x, updatedAt: Date.now() }));
}
export async function saveGoal(x: Goal, d = db) {
  return d.transaction('rw', d.goals, d.audit, () => audited(d, 'goals', { ...x, updatedAt: Date.now() }));
}
/** One statement balance per account per date (re-entering replaces it). */
export async function saveSnapshot(accountId: string, date: string, balance: number, d = db) {
  return d.transaction('rw', d.snapshots, d.audit, async () => {
    const existing = await d.snapshots.where('[accountId+date]').equals([accountId, date]).first();
    const now = Date.now();
    const rec: BalanceSnapshot = existing ? { ...existing, balance, source: 'statement', updatedAt: now } : { id: newId(), accountId, date, balance, source: 'statement', createdAt: now, updatedAt: now };
    return audited(d, 'snapshots', rec);
  });
}
export async function saveBudget(categoryId: string, month: string, amount: number, d = db) {
  return d.transaction('rw', d.budgets, async () => {
    const existing = await d.budgets.where('[categoryId+month]').equals([categoryId, month]).first();
    const now = Date.now();
    if (existing) { await d.budgets.put({ ...existing, amount, updatedAt: now }); return; }
    await d.budgets.add({ id: newId(), categoryId, month, amount, currency: 'CRC', rollover: false, createdAt: now, updatedAt: now });
  });
}
export async function saveDebt(x: Debt, d = db) {
  return d.transaction('rw', d.debts, d.audit, () => audited(d, 'debts', { ...x, updatedAt: Date.now() }));
}

/** Create/update a Tasa Cero plan and post any cuotas already due. */
export async function saveInstallmentPlan(plan: InstallmentPlan, d = db) {
  return d.transaction('rw', d.installments, d.transactions, d.audit, async () => {
    const saved = await audited(d, 'installments', { ...plan, updatedAt: Date.now() });
    // Re-derive this plan's cuotas: remove ones beyond the (possibly edited) schedule, then post due ones.
    await d.transactions.where('installmentPlanId').equals(saved.id).delete();
    await d.transactions.bulkPut(dueCuotaTransactions(saved, todayISO(), Date.now()));
    return saved;
  });
}

/** Idempotent: run on app start. Deterministic ids mean a cuota can't be posted twice. */
export async function postDueCuotas(today = todayISO(), d = db) {
  const plans = await d.installments.where('status').equals('active').toArray();
  const due = plans.flatMap((p) => dueCuotaTransactions(p, today, Date.now()));
  const existing = new Set((await d.transactions.bulkGet(due.map((t) => t.id))).filter(Boolean).map((t) => t!.id));
  const missing = due.filter((t) => !existing.has(t.id));
  if (missing.length) await d.transactions.bulkAdd(missing);
  return missing.length;
}

export async function deleteTransaction(id: string, d = db) {
  return d.transaction('rw', d.transactions, d.audit, async () => {
    const before = await d.transactions.get(id);
    if (!before) return;
    await d.transactions.delete(id);
    await d.audit.add({ at: Date.now(), table: 'transactions', recordId: id, action: 'delete', before });
  });
}

/** Revert one audit entry (restores the previous version, or removes a created record). */
export async function undoAudit(entryId: number, d = db) {
  const e = await d.audit.get(entryId);
  if (!e) return;
  const t = d.table(e.table);
  await d.transaction('rw', t, d.audit, async () => {
    if (e.action === 'create') await t.delete(e.recordId);
    else await t.put(e.before);
    await d.audit.delete(entryId);
  });
}

export async function lastAuditId(d = db) {
  return (await d.audit.orderBy('at').last())?.id;
}

// ── Import batches ────────────────────────────────────────────────────────
export async function commitImport(plan: ImportPlan, d = db): Promise<ImportBatch> {
  const batchId = newId();
  const now = Date.now();
  const tagged = plan.transactions.map((t) => ({ ...t, importBatchId: batchId }));
  const snaps = plan.snapshots.map((s) => ({ ...s, importBatchId: batchId }));
  const existingAcc = new Set((await d.accounts.toArray()).map((a) => a.id));
  const existingCat = new Set((await d.categories.toArray()).map((c) => c.id));
  const newAccounts = plan.accounts.filter((a) => !existingAcc.has(a.id));
  const newCats = plan.categories.filter((c) => !existingCat.has(c.id));
  const created = {
    transactions: tagged.map((t) => t.id), accounts: newAccounts.map((a) => a.id), pots: plan.pots.map((p) => p.id),
    categories: newCats.map((c) => c.id), budgets: plan.budgets.map((b) => b.id), debts: plan.debts.map((x) => x.id),
    selfLoans: plan.selfLoans.map((x) => x.id), snapshots: snaps.map((s) => s.id),
  };
  const batch: ImportBatch = {
    id: batchId, fileName: plan.fileName, kind: 'workbook', importedAt: now, status: 'committed', created,
    counts: Object.fromEntries(Object.entries(created).map(([k, v]) => [k, v.length])), createdAt: now, updatedAt: now,
  };
  await d.transaction('rw', [d.transactions, d.accounts, d.pots, d.categories, d.budgets, d.debts, d.selfLoans, d.snapshots, d.importBatches], async () => {
    for (const t of tagged) TransactionSchema.parse(t);
    await d.accounts.bulkAdd(newAccounts);
    await d.pots.bulkAdd(plan.pots);
    await d.categories.bulkAdd(newCats);
    await d.budgets.bulkAdd(plan.budgets);
    await d.debts.bulkAdd(plan.debts);
    await d.selfLoans.bulkAdd(plan.selfLoans);
    await d.snapshots.bulkAdd(snaps);
    await d.transactions.bulkAdd(tagged);
    await d.importBatches.add(batch);
  });
  return batch;
}

export class UndoBlockedError extends Error {}

export async function undoImport(batchId: string, d = db) {
  const batch = await d.importBatches.get(batchId);
  if (!batch || batch.status === 'undone') return;
  const c = batch.created;
  await d.transaction('rw', [d.transactions, d.accounts, d.pots, d.categories, d.budgets, d.debts, d.selfLoans, d.snapshots, d.importBatches], async () => {
    // Refuse if movements you logged later depend on accounts/categories this batch created.
    const createdTx = new Set(c.transactions ?? []);
    const accs = new Set(c.accounts ?? []);
    const cats = new Set(c.categories ?? []);
    const dependents = (await d.transactions.toArray()).filter((t) => !createdTx.has(t.id) && (
      ('from' in t && accs.has(t.from.accountId)) || ('to' in t && accs.has(t.to.accountId)) ||
      ('categoryId' in t && t.categoryId && cats.has(t.categoryId))));
    if (dependents.length) throw new UndoBlockedError(`${dependents.length} movement(s) you added later use accounts or categories from this import. Move or delete them first.`);
    await d.transactions.bulkDelete(c.transactions ?? []);
    await d.snapshots.bulkDelete(c.snapshots ?? []);
    await d.selfLoans.bulkDelete(c.selfLoans ?? []);
    await d.debts.bulkDelete(c.debts ?? []);
    await d.budgets.bulkDelete(c.budgets ?? []);
    await d.categories.bulkDelete(c.categories ?? []);
    await d.pots.bulkDelete(c.pots ?? []);
    await d.accounts.bulkDelete(c.accounts ?? []);
    await d.importBatches.update(batchId, { status: 'undone', updatedAt: Date.now() });
  });
}

// ── Recurring ─────────────────────────────────────────────────────────────
export async function saveRecurring(r: RecurringRule, d = db) {
  // Validate the template by building a sample occurrence before saving.
  buildOccurrence(r, r.startDate, Date.now());
  return d.transaction('rw', d.recurring, d.audit, () => audited(d, 'recurring', { ...r, updatedAt: Date.now() }));
}

/** Post every auto-post occurrence that's due. Idempotent: ids are deterministic and lastHandledDate moves forward. */
export async function postDueRecurring(today = todayISO(), d = db): Promise<number> {
  const rules = (await d.recurring.toArray()).filter((r) => r.active && r.mode === 'auto_post');
  if (!rules.length) return 0;
  const posted = new Set((await d.transactions.where('recurringId').anyOf(rules.map((r) => r.id)).primaryKeys()).map(String));
  let n = 0;
  for (const r of rules) {
    const due = dueOccurrences(r, today, posted);
    if (!due.length) continue;
    const now = Date.now();
    await d.transaction('rw', d.transactions, d.recurring, async () => {
      await d.transactions.bulkPut(due.map((date) => buildOccurrence(r, date, now)));
      await d.recurring.put({ ...r, lastHandledDate: due.at(-1), updatedAt: now });
    });
    n += due.length;
  }
  return n;
}

/** Reminder confirmed (optionally with the real amount): post it. */
export async function confirmOccurrence(r: RecurringRule, date: string, amount?: number, d = db) {
  return saveTransaction(buildOccurrence(r, date, Date.now(), amount), d);
}

export async function skipOccurrence(r: RecurringRule, date: string, d = db) {
  return saveRecurring({ ...r, skipped: [...new Set([...(r.skipped ?? []), date])] }, d);
}

/**
 * Merge one category into another: every movement (and split, recurring rule and
 * debt) that used `fromId` now uses `toId`; its budget moves over if `toId` has none;
 * `fromId` is archived. Each movement change is audited, so it can be undone.
 */
export async function mergeCategory(fromId: string, toId: string, d = db) {
  if (fromId === toId) return 0;
  const now = Date.now();
  let moved = 0;
  const txs = await d.transactions.toArray();
  for (const t of txs) {
    const uses = ('categoryId' in t && t.categoryId === fromId) || (t.kind === 'expense' && t.splits?.some((s) => s.categoryId === fromId));
    if (!uses) continue;
    const next = { ...t, ...('categoryId' in t && t.categoryId === fromId ? { categoryId: toId } : {}) } as Transaction;
    if (next.kind === 'expense' && next.splits) next.splits = next.splits.map((s) => (s.categoryId === fromId ? { ...s, categoryId: toId } : s));
    await saveTransaction(next, d);
    moved++;
  }
  for (const r of await d.recurring.toArray()) {
    const tpl = r.template as { categoryId?: string };
    if (tpl.categoryId === fromId) await d.recurring.put({ ...r, template: { ...r.template, categoryId: toId } as typeof r.template, updatedAt: now });
  }
  for (const x of await d.debts.toArray()) if (x.categoryId === fromId) await d.debts.put({ ...x, categoryId: toId, updatedAt: now });
  const budgets = await d.budgets.where('categoryId').equals(fromId).toArray();
  const targetMonths = new Set((await d.budgets.where('categoryId').equals(toId).toArray()).map((b) => b.month));
  for (const b of budgets) {
    if (!targetMonths.has(b.month)) await d.budgets.put({ ...b, categoryId: toId, updatedAt: now });
    else await d.budgets.delete(b.id);
  }
  const from = await d.categories.get(fromId);
  if (from) await saveCategory({ ...from, archived: true }, d);
  return moved;
}
