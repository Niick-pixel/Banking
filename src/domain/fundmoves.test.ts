import { describe, expect, it } from 'vitest';
import { asSavings, uncountedFundMoves } from './fundmoves';
import { computeTracker } from './tracker';
import type { Category, Pot, Transaction } from './schemas';

const now = 0;
const cat = (id: string, name: string, group: Category['group']): Category => ({ id, name, group, discretionary: false, sortOrder: 0, archived: false, createdAt: now, updatedAt: now });
const cats = [cat('mine', 'Savings - Mine', 'Savings'), cat('hers', 'Savings - Hers (loan fund)', 'Savings')];
const pots: Pot[] = [{ id: 'p-hers', accountId: 'chk', name: 'Hers (loan fund)', owner: 'hers', purpose: '', archived: false, createdAt: now, updatedAt: now } as Pot];
const ctx = { accountType: (id: string) => (id === 'chk' ? 'checking' as const : id === 'sav' ? 'savings' as const : undefined) };
const tr = (id: string, from: { accountId: string; potId?: string }, to: { accountId: string; potId?: string }, amount: number): Transaction =>
  ({ id, kind: 'transfer', date: '2026-11-10', dateEstimated: false, currency: 'CRC', description: '', tags: [], notes: '', from, to, amount, createdAt: now, updatedAt: now });

describe('transfers into funds', () => {
  const into = tr('a', { accountId: 'chk' }, { accountId: 'chk', potId: 'p-hers' }, 4_000_000);
  const between = tr('b', { accountId: 'chk' }, { accountId: 'chk', potId: 'p-hers' }, 1);
  const plain = tr('c', { accountId: 'sav' }, { accountId: 'sav', potId: 'p-x' }, 100);

  it('finds spending → fund transfers and leaves savings → savings alone', () => {
    expect(uncountedFundMoves([into, plain], ctx).map((t) => t.id)).toEqual(['a']);
    expect(uncountedFundMoves([between], ctx)).toHaveLength(1);
  });

  it('turns ₡40,000 into her fund into Savings - Hers, and the budget sees it', () => {
    const fixed = asSavings(into as Extract<Transaction, { kind: 'transfer' }>, ctx, cats, pots)!;
    expect(fixed).toMatchObject({ kind: 'savings', direction: 'deposit', categoryId: 'hers', amount: 4_000_000, id: 'a' });
    const before = computeTracker(2026, [into], cats, [], ctx);
    const after = computeTracker(2026, [fixed], cats, [], ctx);
    expect(before.saved[10]).toBe(0);
    expect(after.saved[10]).toBe(4_000_000);
    expect(after.sections.find((s) => s.group === 'Savings')!.rows.find((r) => r.category.id === 'hers')!.months[10]).toBe(4_000_000);
  });

  it('a move out of the fund becomes a withdrawal', () => {
    const out = tr('d', { accountId: 'chk', potId: 'p-hers' }, { accountId: 'chk' }, 500);
    expect(asSavings(out as Extract<Transaction, { kind: 'transfer' }>, ctx, cats, pots)).toMatchObject({ direction: 'withdrawal', categoryId: 'hers' });
  });
});

import { intoFund, unfundedSavings } from './fundmoves';
describe('savings that missed their fund', () => {
  it('a ₡70,000 "Savings - Mine" deposit into the account (not the fund) is found and put into Mine', () => {
    const mine = { id: 'p-mine', accountId: 'sav', name: 'Mine', owner: 'mine', purpose: '', archived: false, createdAt: 0, updatedAt: 0 } as Pot;
    const t = { id: 's1', kind: 'savings', direction: 'deposit', date: '2026-11-17', dateEstimated: false, currency: 'CRC', description: '', tags: [], notes: '', from: { accountId: 'chk' }, to: { accountId: 'sav' }, amount: 7_000_000, categoryId: 'mine', createdAt: 0, updatedAt: 0 } as Transaction;
    const found = unfundedSavings([t], [mine], cats);
    expect(found).toHaveLength(1);
    expect(intoFund(found[0]!.tx, found[0]!.pot).to).toEqual({ accountId: 'sav', potId: 'p-mine' });
  });
});

import { fundActivity } from './fundmoves';
import { accountBalances } from './ledger';

describe('fund activity', () => {
  const sv = (id: string, date: string, dir: 'deposit' | 'withdrawal', amount: number): Transaction =>
    ({ id, kind: 'savings', direction: dir, date, dateEstimated: false, currency: 'CRC', description: '', tags: [], notes: '', categoryId: 'hers',
      from: dir === 'deposit' ? { accountId: 'chk' } : { accountId: 'chk', potId: 'p-hers' }, to: dir === 'deposit' ? { accountId: 'chk', potId: 'p-hers' } : { accountId: 'chk' }, amount, createdAt: now, updatedAt: now });
  const txs = [sv('1', '2026-10-01', 'deposit', 7_000_000), sv('2', '2026-11-01', 'withdrawal', 2_000_000), sv('3', '2026-11-16', 'deposit', 4_000_000), sv('0', '2025-01-01', 'deposit', 999)];
  const act = fundActivity('p-hers', txs, '2026-01-01');

  it('lists newest first with signed amounts and the running balance, skipping pre-opening rows', () => {
    expect(act.map((e) => [e.tx.id, e.amount, e.after])).toEqual([['3', 4_000_000, 9_000_000], ['2', -2_000_000, 5_000_000], ['1', 7_000_000, 7_000_000]]);
    expect(act[0]!.other).toEqual({ accountId: 'chk' });
  });

  it('ends at the same balance the ledger shows', () => {
    const acc = { id: 'chk', name: 'C', type: 'checking', currency: 'CRC', openingBalance: 0, openingDate: '2026-01-01', archived: false, createdAt: now, updatedAt: now } as never;
    expect(accountBalances([acc], txs.slice(0, 3)).get('chk')!.pots.get('p-hers')).toBe(act[0]!.after);
  });
});


import { duplicateCluster } from '../routes/DuplicateReview';
describe('duplicate cluster', () => {
  const s = (id: string, date: string, amount = 7_000_000): Transaction => ({ id, kind: 'savings', direction: 'deposit', date, dateEstimated: false, currency: 'CRC', description: '', tags: [], notes: '', categoryId: 'mine', from: { accountId: 'chk' }, to: { accountId: 'sav' }, amount, createdAt: 0, updatedAt: 0 });
  it('pulls in every same-amount entry within a day of the pair', () => {
    const txs = [s('a', '2026-11-16'), s('b', '2026-11-16'), s('c', '2026-11-17'), s('d', '2026-11-20'), s('e', '2026-11-17', 5)];
    expect(duplicateCluster(['a', 'c'], txs).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });
});

