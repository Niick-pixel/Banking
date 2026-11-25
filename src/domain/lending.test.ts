import { describe, expect, it } from 'vitest';
import { byPerson, lendingStatus } from './lending';
import type { Lending, Transaction } from './schemas';

const L = (id: string, person: string, over: Partial<Lending> = {}): Lending => ({ id, person, description: '', currency: 'CRC', lentOn: '2026-11-01', status: 'open', notes: '', createdAt: 0, updatedAt: 0, ...over });
const tr = (id: string, from: string, to: string, amount: number, lendingId: string, date = '2026-11-01'): Transaction => ({ id, kind: 'transfer', date, dateEstimated: false, currency: 'CRC', description: '', tags: [], notes: '', from: { accountId: from }, to: { accountId: to }, amount, lendingId, createdAt: 0, updatedAt: 0 });

describe('money I lent', () => {
  const txs = [tr('a', 'chk', 'rec', 5_000_000, 'l1'), tr('b', 'rec', 'chk', 2_000_000, 'l1', '2026-11-10'), tr('c', 'chk', 'rec', 1_000_000, 'l2')];
  it('owed = lent − paid back', () => {
    const s = lendingStatus(L('l1', 'Ana', { dueDate: '2026-11-15' }), txs, 'rec', '2026-11-20');
    expect([s.lent, s.repaid, s.owed, s.lastRepaid, s.overdue]).toEqual([5_000_000, 2_000_000, 3_000_000, '2026-11-10', true]);
  });
  it('groups open lendings by person', () => {
    const rows = [lendingStatus(L('l1', 'Ana'), txs, 'rec', '2026-11-20'), lendingStatus(L('l2', ' ana '), txs, 'rec', '2026-11-20')];
    expect(byPerson(rows)).toEqual([{ person: 'Ana', owed: 4_000_000, count: 2 }]);
  });
});
