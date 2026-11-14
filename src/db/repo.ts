/**
 * The only way the UI writes data. Every write is validated with Zod, recorded
 * in the audit log (so it can be undone), and goes through one place, where the
 * folder-vault persistence (desktop plan D1) will hook in.
 */
import { db, type ColonDB } from './db';
import {
  AccountSchema, CategorySchema, InstallmentPlanSchema, PotSchema, TransactionSchema, DebtSchema,
  type Account, type Category, type InstallmentPlan, type Pot, type Transaction, type Debt, type ImportBatch,
} from '../domain/schemas';
import type { ImportPlan } from '../import/workbook';
import { dueCuotaTransactions } from '../domain/installments';
import { todayISO } from '../lib/dates';

export const newId = () => crypto.randomUUID();

type Table = 'transactions' | 'accounts' | 'pots' | 'categories' | 'installments' | 'debts';
const schemas = {
  transactions: TransactionSchema, accounts: AccountSchema, pots: PotSchema, categories: CategorySchema,
  installments: InstallmentPlanSchema, debts: DebtSchema,
} as const;

async function audited<T extends { id: string }>(d: ColonDB, table: Table, record: T): Promise<T> {
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
