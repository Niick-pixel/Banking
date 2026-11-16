import 'fake-indexeddb/auto';
import { existsSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { AufwindDB } from './db';
import { fixPaydaySavingsRules, mergeCategory, saveBudget, saveCategory, postDueRecurring, saveRecurring, confirmOccurrence, skipOccurrence, commitImport, deleteTransaction, lastAuditId, postDueCuotas, saveInstallmentPlan, saveTransaction, undoAudit, undoImport, UndoBlockedError } from './repo';
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

describe('recurring in the DB', () => {
  it('auto-posts once, never again; reminders confirm with a real amount or skip', async () => {
    await d.accounts.add(account('c', 'checking'));
    const base = { schedule: { type: 'monthly' as const, day: 1 }, startDate: '2026-09-01', skipped: [], informational: false, active: true, createdAt: 0, updatedAt: 0 };
    await saveRecurring({ ...base, id: 'rent', name: 'Rent', mode: 'auto_post', template: { kind: 'expense', from: { accountId: 'c' }, amount: crc(185_000), categoryId: 'r' } }, d);
    expect(await postDueRecurring('2026-11-14', d)).toBe(3);
    expect(await postDueRecurring('2026-11-14', d)).toBe(0);
    await d.transactions.delete('rec:rent:2026-10-01');
    expect(await postDueRecurring('2026-11-30', d)).toBe(0);
    const sal = { ...base, id: 'sal', name: 'Salary', mode: 'remind' as const, schedule: { type: 'quincena' as const }, startDate: '2026-11-01', template: { kind: 'income', to: { accountId: 'c' }, amount: crc(330_000), categoryId: 's' } };
    await saveRecurring(sal, d);
    expect(await postDueRecurring('2026-11-30', d)).toBe(0);
    await confirmOccurrence(sal, '2026-11-15', crc(341_221.04), d);
    expect((await d.transactions.get('rec:sal:2026-11-15'))).toMatchObject({ amount: crc(341_221.04), recurringId: 'sal' });
    await skipOccurrence(sal, '2026-11-30', d);
    expect((await d.recurring.get('sal'))!.skipped).toEqual(['2026-11-30']);
  });
  it('rejects a rule whose template is not a valid movement', async () => {
    await expect(saveRecurring({ id: 'bad', name: 'Bad', mode: 'auto_post', schedule: { type: 'quincena' }, startDate: '2026-11-01', skipped: [], informational: false, active: true, createdAt: 0, updatedAt: 0, template: { kind: 'transfer', from: { accountId: 'c' }, amount: 5 } }, d)).rejects.toThrow();
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

describe('automatic savings (Ahorro Objetivo)', () => {
  it('posts a savings transfer on the 1st and 16th, once each, from the start date on', async () => {
    await d.accounts.add(account('c', 'checking'));
    await d.accounts.add(account('s', 'goal_savings'));
    await saveRecurring({ id: 'ao', name: 'Ahorro Objetivo', mode: 'auto_post', schedule: { type: 'days', days: [1, 16] }, startDate: '2026-11-10', skipped: [], informational: false, active: true, createdAt: 0, updatedAt: 0,
      template: { kind: 'savings', direction: 'deposit', from: { accountId: 'c' }, to: { accountId: 's' }, amount: crc(35_000), categoryId: 'smine', description: 'Ahorro Objetivo', tags: ['auto-savings'] } }, d);
    expect(await postDueRecurring('2026-12-02', d)).toBe(2); // 16 Nov + 1 Dec (1 Nov is before the start)
    expect(await postDueRecurring('2026-12-02', d)).toBe(0);
    const posted = (await d.transactions.toArray()).map((t) => t.date).sort();
    expect(posted).toEqual(['2026-11-16', '2026-12-01']);
  });
});

describe('categories', () => {
  it('merging moves movements and the budget, then archives the old one', async () => {
    await d.accounts.add(account('c', 'checking'));
    const cat = (id: string, name: string) => ({ id, name, group: 'Living' as const, discretionary: false, sortOrder: 0, archived: false, createdAt: 0, updatedAt: 0 });
    await saveCategory(cat('uber', 'Uber'), d);
    await saveCategory(cat('transport', 'Transport'), d);
    await saveBudget('uber', '*', crc(30_000), d);
    await saveTransaction(tx({ kind: 'expense', date: '2026-11-01', from: { accountId: 'c' }, amount: crc(5_000), categoryId: 'uber' }), d);
    await saveTransaction(tx({ kind: 'expense', date: '2026-11-02', from: { accountId: 'c' }, amount: crc(7_000), categoryId: 'transport' }), d);
    expect(await mergeCategory('uber', 'transport', d)).toBe(1);
    expect((await d.transactions.toArray()).every((t) => 'categoryId' in t && t.categoryId === 'transport')).toBe(true);
    expect((await d.budgets.toArray()).map((b) => b.categoryId)).toEqual(['transport']);
    expect((await d.categories.get('uber'))!.archived).toBe(true);
  });
});

describe('payday savings rules', () => {
  it('moves an old "My savings" rule from payday to the 1st and 16th', async () => {
    await d.accounts.add(account('c', 'checking'));
    await d.accounts.add(account('s', 'goal_savings'));
    await saveRecurring({ id: 'r', name: 'My savings', mode: 'auto_post', schedule: { type: 'quincena' }, startDate: '2026-11-17', skipped: [], informational: false, active: true, createdAt: 0, updatedAt: 0,
      template: { kind: 'savings', direction: 'deposit', from: { accountId: 'c' }, to: { accountId: 's' }, amount: crc(35_000), categoryId: 'mine', description: 'Automatic savings' } }, d);
    expect(await fixPaydaySavingsRules(d)).toBe(1);
    const r = (await d.recurring.get('r'))!;
    expect(r.schedule).toEqual({ type: 'days', days: [1, 16] });
    expect(r.name).toBe('Ahorro Objetivo');
    expect(await fixPaydaySavingsRules(d)).toBe(0);
  });
});
