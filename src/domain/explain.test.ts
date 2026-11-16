import { describe, expect, it } from 'vitest';
import { explainBalance } from './explain';
import type { Account, BalanceSnapshot, Transaction } from './schemas';

const sav: Account = { id: 's', name: 'BAC Ahorro Objetivo', institution: '', type: 'goal_savings', currency: 'CRC', openingBalance: 41_434_900, openingDate: '2026-09-01', isLiquid: true, archived: false, createdAt: 0, updatedAt: 0 };
const chk: Account = { ...sav, id: 'c', name: 'Checking', type: 'checking', openingBalance: 0 };
const dep = (id: string, date: string, amount: number): Transaction => ({ id, kind: 'savings', direction: 'deposit', date, dateEstimated: true, currency: 'CRC', description: '', tags: [], notes: '', from: { accountId: 'c' }, to: { accountId: 's', potId: 'mine' }, amount, categoryId: 'mine', createdAt: 0, updatedAt: 0 });
const snap = (date: string, balance: number): BalanceSnapshot => ({ id: date, accountId: 's', date, balance, source: 'import', createdAt: 0, updatedAt: 0 });

describe('where a balance comes from', () => {
  it('splits it into the starting balance and each month, and shows the gap with the bank', () => {
    const txs = [dep('a', '2026-10-31', 7_000_000), dep('b', '2026-10-31', 14_316_608), dep('c', '2026-11-30', 39_184_800), dep('x', '2026-08-15', 100)];
    const r = explainBalance(sav, [sav, chk], txs, [snap('2026-08-31', 41_434_900), snap('2026-10-31', 57_401_457)], '2026-11-16');
    expect(r.opening.amount).toBe(41_434_900);
    expect(r.beforeOpening).toEqual({ count: 1, net: 100 });
    const oct = r.months.find((m) => m.month === '2026-10')!;
    expect(oct.in).toBe(21_316_608);
    expect(oct.gap).toBe(57_401_457 - (41_434_900 + 21_316_608)); // −₡53,500.51: logged more than the bank shows
    expect(oct.bankChange).toBe(57_401_457 - 41_434_900);
    expect(r.total).toBe(41_434_900 + 21_316_608 + 39_184_800);
    expect(r.biggest[0]!.tx.id).toBe('c');
  });
});
