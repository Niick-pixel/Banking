import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { budgetAlerts, computeTracker } from './tracker';
import type { Budget, Category } from './schemas';
import { account, crc, tx } from '../test/factories';
import { gridFromXlsx } from '../import/grid';
import { parseWorkbook } from '../import/workbook';

const cat = (id: string, group: Category['group']): Category => ({ id, name: id, group, discretionary: false, sortOrder: 0, archived: false, createdAt: 0, updatedAt: 0 });
const budget = (categoryId: string, amount: number): Budget => ({ id: categoryId, categoryId, month: '*', amount, currency: 'CRC', rollover: false, createdAt: 0, updatedAt: 0 });
const accs = [account('c', 'checking'), account('s', 'goal_savings')];
const ctx = { accountType: (id: string) => accs.find((a) => a.id === id)?.type };

describe('tracker', () => {
  const cats = [cat('sal', 'Income'), cat('rent', 'Fixed'), cat('food', 'Living'), cat('save', 'Savings')];
  const txs = [
    tx({ kind: 'income', date: '2026-10-15', to: { accountId: 'c' }, amount: crc(600_000), categoryId: 'sal' }),
    tx({ kind: 'income', date: '2026-11-15', to: { accountId: 'c' }, amount: crc(600_000), categoryId: 'sal' }),
    tx({ kind: 'expense', date: '2026-10-01', from: { accountId: 'c' }, amount: crc(185_000), categoryId: 'rent' }),
    tx({ kind: 'expense', date: '2026-11-05', from: { accountId: 'c' }, amount: crc(50_000), categoryId: 'food' }),
    tx({ kind: 'savings', direction: 'deposit', date: '2026-11-15', from: { accountId: 'c' }, to: { accountId: 's' }, amount: crc(100_000), categoryId: 'save' }),
    tx({ kind: 'expense', date: '2025-12-05', from: { accountId: 'c' }, amount: crc(999), categoryId: 'food' }),
  ];
  const t = computeTracker(2026, txs, cats, [budget('food', crc(40_000)), budget('save', crc(140_000))], ctx);
  it('bottom lines', () => {
    expect(t.income[10]).toBe(crc(600_000));
    expect(t.net[10]).toBe(crc(550_000));
    expect(t.freeCash[10]).toBe(crc(450_000));
    expect(t.ytd.expenses).toBe(crc(235_000)); // the 2025 row is excluded
  });
  it('averages only over months with data', () => {
    expect(t.monthsWithData).toBe(2);
    const rent = t.sections.find((s) => s.group === 'Fixed')!.rows[0]!;
    expect(rent.avg).toBe(crc(92_500));
  });
  it('over-budget flags: spending above, saving below', () => {
    const food = t.sections.find((s) => s.group === 'Living')!.rows[0]!;
    expect(food.over[10]).toBe(true);
    const save = t.sections.find((s) => s.group === 'Savings')!.rows[0]!;
    expect(save.over[10]).toBe(true);
  });
  it('pace projection and alerts', () => {
    const a = budgetAlerts(t, '2026-11-10');
    expect(a[0]).toMatchObject({ level: 'over', projected: crc(150_000) });
  });
});

const REAL = 'private/Financial_Tracker.xlsx';
describe.runIf(existsSync(REAL))('tracker vs the real workbook (local only)', () => {
  it('every category, every month matches the workbook Tracker', async () => {
    const buf = readFileSync(REAL);
    const grid = await gridFromXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    let i = 0;
    const plan = parseWorkbook(grid, { fileName: 'x', today: '2026-11-14', now: 0, newId: () => `i${++i}` });
    const types = new Map(plan.accounts.map((a) => [a.id, a.type]));
    const t = computeTracker(2026, plan.transactions, plan.categories, plan.budgets, { accountType: (id) => types.get(id) });
    const sheet = grid.sheets.find((s) => /tracker/i.test(s.name))!;
    let compared = 0;
    for (const s of t.sections) for (const r of s.rows) {
      const row = sheet.rows.find((x) => String(x[0] ?? '').trim() === r.category.name);
      if (!row) continue;
      const wb = Array.from({ length: 12 }, (_, m) => Math.round(Number(row[2 + m] ?? 0) * 100));
      expect({ c: r.category.name, m: r.months }).toEqual({ c: r.category.name, m: wb });
      compared++;
    }
    expect(compared).toBe(22);
    expect(t.monthsWithData).toBe(6);
  });
});
