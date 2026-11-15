import { describe, expect, it } from 'vitest';
import { cumulative, dailySpending, monthWaterfall } from './spending';
import type { Category, Transaction } from './schemas';
import type { MonthFlow } from './ledger';

const tx = (p: Partial<Transaction> & { kind: string; date: string; amount: number }): Transaction => ({
  id: Math.random().toString(36), currency: 'CRC', description: '', tags: [], notes: '', dateEstimated: false, createdAt: 0, updatedAt: 0,
  from: { accountId: 'a' }, to: { accountId: 'b' }, categoryId: 'c', ...p,
} as unknown as Transaction);

describe('daily spending', () => {
  it('sums expenses and debt payments per day, skips estimated dates, transfers and dollars', () => {
    const r = dailySpending([
      tx({ kind: 'expense', date: '2026-11-03', amount: 100 }),
      tx({ kind: 'debt_payment', date: '2026-11-03', amount: 50 }),
      tx({ kind: 'expense', date: '2026-11-30', amount: 999, dateEstimated: true }),
      tx({ kind: 'transfer', date: '2026-11-03', amount: 7 }),
      tx({ kind: 'expense', date: '2026-11-04', amount: 10, currency: 'USD' }),
      tx({ kind: 'expense', date: '2026-10-31', amount: 5 }),
    ], '2026-11-01', '2026-11-30');
    expect(r.byDay.get('2026-11-03')).toBe(150);
    expect(r.byDay.size).toBe(1);
    expect(r.estimated).toBe(1);
  });
  it('builds a running total', () => {
    const m = new Map([['2026-11-01', 10], ['2026-11-03', 5]]);
    expect(cumulative(m, '2026-11', 30, 4)).toEqual([10, 10, 15, 15]);
  });
});

describe('waterfall', () => {
  const cat = new Map<string, Category>([['rent', { group: 'Fixed' } as Category], ['food', { group: 'Living' } as Category], ['sav', { group: 'Savings' } as Category]]);
  it('starts at income and ends exactly at free cash, even when negative', () => {
    const f = { month: '2026-11', income: 1000, expenses: 700, debtService: 0, saved: 500, paidFromSavings: 0, net: 300, freeCash: -200,
      byCategory: new Map([['rent', 400], ['food', 250], ['sav', 500]]) } as unknown as MonthFlow;
    const w = monthWaterfall(f, cat);
    expect(w.map((s) => s.name)).toEqual(['Income', 'Fixed', 'Living', 'Uncategorized', 'Net', 'Saved', 'Free cash']);
    expect(w.find((s) => s.name === 'Uncategorized')!.value).toBe(-50);
    expect(w.find((s) => s.name === 'Net')).toMatchObject({ lo: 0, hi: 300 });
    expect(w.find((s) => s.name === 'Saved')).toMatchObject({ lo: -200, hi: 300 });
    expect(w.at(-1)).toMatchObject({ value: -200, lo: -200, hi: 0 });
  });
});
