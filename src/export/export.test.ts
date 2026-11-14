import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildWorkbook } from './xlsx';
import { transactionsCsv } from './csv';
import { gridFromXlsx } from '../import/grid';
import { parseWorkbook } from '../import/workbook';
import { netWorthSeries } from '../domain/networth';
import { computeTracker } from '../domain/tracker';
import { account, crc, tx } from '../test/factories';
import type { Category } from '../domain/schemas';

let i = 0;
const newId = () => `x${++i}`;
const cat = (id: string, name: string, group: Category['group']): Category => ({ id, name, group, discretionary: false, sortOrder: 0, archived: false, createdAt: 0, updatedAt: 0 });

describe('CSV', () => {
  it('quotes, BOM, CRLF', () => {
    const csv = transactionsCsv([tx({ kind: 'expense', date: '2026-11-01', from: { accountId: 'c' }, amount: crc(1234.5), categoryId: 'g', description: 'Walmart, "big" run' })], [account('c', 'checking', 0, { name: 'BAC' })], [], [cat('g', 'Groceries', 'Living')]);
    expect(csv.startsWith('﻿date,')).toBe(true);
    expect(csv).toContain('"Walmart, ""big"" run",1234.50');
    expect(csv.split('\r\n')).toHaveLength(3);
  });
});

async function roundTrip(input: Parameters<typeof buildWorkbook>[0]) {
  const buf = await buildWorkbook(input);
  const grid = await gridFromXlsx(buf);
  return { grid, plan: parseWorkbook(grid, { fileName: 'export.xlsx', today: '2026-11-14', now: 0, newId }) };
}

describe('Excel export round-trips through the importer', () => {
  it('synthetic ledger: same totals after export → import', async () => {
    const accounts = [account('c', 'checking', 0, { name: 'BAC Colones (checking)' }), account('s', 'goal_savings', 0, { name: 'BAC Ahorro Objetivo (savings)' })];
    const categories = [cat('sal', 'Salary', 'Income'), cat('food', 'Groceries', 'Living'), cat('rent', 'House rent', 'Fixed'), cat('sm', 'Savings - Mine', 'Savings')];
    const transactions = [
      tx({ kind: 'income', date: '2026-10-15', to: { accountId: 'c' }, amount: crc(600_000.5), categoryId: 'sal' }),
      tx({ kind: 'expense', date: '2026-10-03', from: { accountId: 'c' }, amount: crc(45_000), categoryId: 'food', description: 'Market' }),
      tx({ kind: 'expense', date: '2026-10-05', from: { accountId: 'c' }, amount: crc(185_000), splits: [{ categoryId: 'rent', amount: crc(180_000) }, { categoryId: 'food', amount: crc(5_000) }] }),
      tx({ kind: 'savings', direction: 'deposit', date: '2026-10-16', from: { accountId: 'c' }, to: { accountId: 's' }, amount: crc(70_000), categoryId: 'sm' }),
      tx({ kind: 'savings', direction: 'withdrawal', date: '2026-11-02', from: { accountId: 's' }, to: { accountId: 'c' }, amount: crc(10_000), categoryId: 'sm' }),
      tx({ kind: 'transfer', date: '2026-11-03', from: { accountId: 'c' }, to: { accountId: 's' }, amount: crc(1) }),
    ];
    const input = { year: 2026, accounts, pots: [], categories, transactions, budgets: [], debts: [], netWorth: netWorthSeries({ accounts, snapshots: [], transactions, debts: [], installments: [] }, 2026, '2026-11-14') };
    const { plan, grid } = await roundTrip(input);
    expect(plan.issues.filter((x) => x.level === 'error')).toEqual([]);
    for (const r of plan.reconciliation) expect(r.imported).toEqual(r.tracker);
    const oct = plan.reconciliation.find((r) => r.month === '2026-10')!;
    expect(oct.imported).toEqual({ income: crc(600_000.5), expenses: crc(230_000), saved: crc(70_000) });
    expect(grid.sheets.map((s) => s.name)).toEqual(['Setup', 'Transactions', '2026 Tracker', 'Net Worth', 'Debts', 'All movements']);
    const all = grid.sheets.find((s) => s.name === 'All movements')!;
    expect(all.rows.filter((r) => r.some((v) => v !== null)).length).toBe(1 + transactions.length);
  });
});

const REAL = 'private/Financial_Tracker.xlsx';
describe.runIf(existsSync(REAL))('real workbook: import → export → import (local only)', () => {
  it('the exported workbook reconciles exactly and its Tracker matches', async () => {
    const buf = readFileSync(REAL);
    const g1 = await gridFromXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const p1 = parseWorkbook(g1, { fileName: 'a', today: '2026-11-14', now: 0, newId });
    const types = new Map(p1.accounts.map((a) => [a.id, a.type]));
    const input = { year: 2026, accounts: p1.accounts, pots: p1.pots, categories: p1.categories, transactions: p1.transactions, budgets: p1.budgets, debts: p1.debts, netWorth: netWorthSeries({ accounts: p1.accounts, snapshots: p1.snapshots, transactions: p1.transactions, debts: p1.debts, installments: [] }, 2026, '2026-11-14') };
    const { plan: p2 } = await roundTrip(input);
    expect(p2.transactions).toHaveLength(p1.transactions.length);
    for (const r of p2.reconciliation) expect({ m: r.month, ...r.imported }).toEqual({ m: r.month, ...r.tracker });
    const t1 = computeTracker(2026, p1.transactions, p1.categories, p1.budgets, { accountType: (id) => types.get(id) });
    expect(p2.reconciliation.map((r) => r.imported.income)).toEqual(t1.income.filter((_, m) => p2.reconciliation.some((r) => Number(r.month.slice(5)) === m + 1)));
  });
});
