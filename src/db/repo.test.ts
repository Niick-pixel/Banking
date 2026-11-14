import 'fake-indexeddb/auto';
import { existsSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { AufwindDB } from './db';
import { commitImport, deleteTransaction, lastAuditId, postDueCuotas, saveInstallmentPlan, saveTransaction, undoAudit, undoImport, UndoBlockedError } from './repo';
import { parseWorkbook } from '../import/workbook';
import { gridFromXlsx } from '../import/grid';
import { account, crc, tx } from '../test/factories';

let d: AufwindDB;
let n = 0;
beforeEach(async () => { d = new AufwindDB(`test-${++n}`); await d.open(); });

describe('repo', () => {
  it('rejects invalid transactions and audits valid ones; undo restores', async () => {
    await d.accounts.add(account('c', 'checking'));
    await expect(saveTransaction({ ...tx({ kind: 'expense', date: '2026-11-01', from: { accountId: 'c' }, amount: -1, categoryId: 'x' }) }, d)).rejects.toThrow();
    const t = await saveTransaction(tx({ kind: 'expense', date: '2026-11-01', from: { accountId: 'c' }, amount: crc(100), categoryId: 'x' }), d);
    await deleteTransaction(t.id, d);
    expect(await d.transactions.count()).toBe(0);
    await undoAudit((await lastAuditId(d))!, d);
    expect(await d.transactions.get(t.id)).toBeTruthy();
  });

  it('Tasa Cero cuotas post once, however many times catch-up runs', async () => {
    await d.accounts.add(account('card', 'credit_card'));
    await saveInstallmentPlan({ id: 'p', cardAccountId: 'card', description: 'TV', merchant: '', categoryId: 'personal', currency: 'CRC',
      total: crc(300_000), months: 3, purchaseDate: '2026-01-05', firstChargeDate: '2026-01-20', status: 'active', notes: '', createdAt: 0, updatedAt: 0 }, d);
    const before = await d.transactions.count();
    await postDueCuotas('2030-01-01', d);
    await postDueCuotas('2030-01-01', d);
    expect(await d.transactions.count()).toBe(3);
    expect(before).toBeLessThanOrEqual(3);
  });
});

const REAL = 'private/Financial_Tracker.xlsx';
describe.runIf(existsSync(REAL))('real workbook into the DB (local only)', () => {
  it('commits as one batch and undoes cleanly', async () => {
    const buf = readFileSync(REAL);
    const grid = await gridFromXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    let i = 0;
    const plan = parseWorkbook(grid, { fileName: 'real', today: '2026-11-14', now: 0, newId: () => `r${++i}` });
    const batch = await commitImport(plan, d);
    expect(await d.transactions.count()).toBe(plan.transactions.length);
    // A movement logged after the import blocks undo until it's moved.
    const later = await saveTransaction(tx({ kind: 'expense', date: '2026-11-14', from: { accountId: plan.defaults.spendingAccountId }, amount: crc(1), categoryId: plan.categories[0]!.id }), d);
    await expect(undoImport(batch.id, d)).rejects.toBeInstanceOf(UndoBlockedError);
    await deleteTransaction(later.id, d);
    await undoImport(batch.id, d);
    expect(await d.transactions.count()).toBe(0);
    expect(await d.accounts.count()).toBe(0);
    expect((await d.importBatches.get(batch.id))!.status).toBe('undone');
  });
});
