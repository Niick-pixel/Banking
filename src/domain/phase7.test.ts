import { describe, expect, it } from 'vitest';
import { dataHealth, possibleDuplicates } from './health';
import { monthSummary } from './insights';
import { monthlyFlows } from './ledger';
import { account, crc, debt, tx } from '../test/factories';
import type { Budget, Category, Pot } from './schemas';

const cat = (id: string, name: string, group: Category['group'], discretionary = false): Category => ({ id, name, group, discretionary, sortOrder: 0, archived: false, createdAt: 0, updatedAt: 0 });
const cats = [cat('sal', 'Salary', 'Income'), cat('rent', 'House rent', 'Fixed'), cat('food', 'Groceries', 'Living'), cat('fun', 'Unnecessary', 'Discretionary', true), cat('sav', 'Savings - Mine', 'Savings')];
const budget = (categoryId: string, amount: number): Budget => ({ id: categoryId, categoryId, month: '*', amount, currency: 'CRC', rollover: false, createdAt: 0, updatedAt: 0 });
const accounts = [account('c', 'checking', crc(1_000_000)), account('s', 'goal_savings')];
const C = { accountId: 'c' };

describe('data health', () => {
  const base = { accounts, pots: [] as Pot[], categories: cats, debts: [], snapshots: [], budgets: [budget('rent', crc(185_000))], selfLoans: [] };
  it('possible duplicates: same amount/account ±1 day, similar description', () => {
    const a = tx({ kind: 'expense', date: '2026-11-01', from: C, amount: crc(5_000), categoryId: 'food', description: 'Walmart' });
    const b = tx({ kind: 'expense', date: '2026-11-02', from: C, amount: crc(5_000), categoryId: 'food', description: 'walmart run' });
    const far = tx({ kind: 'expense', date: '2026-11-09', from: C, amount: crc(5_000), categoryId: 'food', description: 'Walmart' });
    const other = tx({ kind: 'expense', date: '2026-11-01', from: C, amount: crc(5_000), categoryId: 'food', description: 'Uber' });
    expect(possibleDuplicates([a, b, far, other])).toHaveLength(1);
  });
  it('flags missing rent months, negative pots, debt gaps, bad categories', () => {
    const txs = [
      tx({ kind: 'income', date: '2026-09-15', to: C, amount: crc(600_000), categoryId: 'sal' }),
      tx({ kind: 'expense', date: '2026-09-01', from: C, amount: crc(185_000), categoryId: 'rent' }),
      tx({ kind: 'income', date: '2026-10-15', to: C, amount: crc(600_000), categoryId: 'sal' }),
      tx({ kind: 'expense', date: '2026-10-02', from: C, amount: crc(1_000), categoryId: 'deleted' }),
      tx({ kind: 'expense', date: '2026-10-03', from: { accountId: 's', potId: 'h' }, amount: crc(1_000), categoryId: 'food' }),
    ];
    const pots: Pot[] = [{ id: 'h', accountId: 's', name: 'Hers', owner: 'hers', purpose: '', archived: false, createdAt: 0, updatedAt: 0 }];
    const d = debt('gf', crc(100_000), { confirmedBalance: { date: '2026-11-01', amount: crc(90_000) } });
    const ids = dataHealth({ ...base, pots, transactions: txs, debts: [d] }, '2026-11-14').map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['rent', 'pot-h', 'debt-gf', 'uncategorized', 'neg-s']));
    expect(dataHealth({ ...base, pots, transactions: txs, debts: [d] }, '2026-11-14')[0]!.level).toBe('error');
  });
  it('a clean ledger is healthy', () => {
    const txs = [tx({ kind: 'income', date: '2026-10-15', to: C, amount: crc(600_000), categoryId: 'sal' }), tx({ kind: 'expense', date: '2026-10-01', from: C, amount: crc(185_000), categoryId: 'rent' })];
    expect(dataHealth({ ...base, transactions: txs }, '2026-11-14')).toEqual([]);
  });
});

describe('monthly insights', () => {
  const ctx = { accountType: (id: string) => accounts.find((a) => a.id === id)?.type };
  const txs = [
    tx({ kind: 'income', date: '2026-10-15', to: C, amount: crc(600_000), categoryId: 'sal' }),
    tx({ kind: 'expense', date: '2026-10-05', from: C, amount: crc(100_000), categoryId: 'food' }),
    tx({ kind: 'income', date: '2026-11-15', to: C, amount: crc(600_000), categoryId: 'sal' }),
    tx({ kind: 'expense', date: '2026-11-05', from: C, amount: crc(150_000), categoryId: 'food' }),
    tx({ kind: 'expense', date: '2026-11-06', from: C, amount: crc(50_000), categoryId: 'fun' }),
    tx({ kind: 'savings', direction: 'deposit', date: '2026-11-15', from: C, to: { accountId: 's' }, amount: crc(140_000), categoryId: 'sav' }),
  ];
  const f = monthlyFlows(txs, ctx);
  const s = monthSummary(f.get('2026-11'), f.get('2026-10'), cats, [budget('food', crc(120_000))], 0.2);
  it('numbers', () => {
    expect(s.savingsRate).toBeCloseTo(140 / 600);
    expect(s.top[0]).toMatchObject({ amount: crc(150_000), share: 0.75 });
    expect(s.avoidable).toBe(crc(50_000));
    expect(s.expenseChange).toBeCloseTo(1);
    expect(s.overBudget[0]!.category.id).toBe('food');
  });
  it('plain sentences', () => {
    const text = s.insights.map((i) => i.text).join(' | ');
    expect(text).toContain('Saved 23% of income (target 20%), up from 0% last month.');
    expect(text).toContain('Spending rose 100% vs last month, mostly Groceries (+₡50,000)');
    expect(text).toContain('Over budget: Groceries by ₡30,000');
  });
});
