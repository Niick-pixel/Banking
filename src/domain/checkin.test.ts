import { describe, expect, it } from 'vitest';
import { checkInStatus, quincenaStart, statementBalance } from './checkin';
import type { Account } from './schemas';

const acc = (id: string, type: Account['type']): Account => ({ id, name: id, institution: '', type, currency: 'CRC', openingBalance: 0, openingDate: '2026-01-01', isLiquid: true, archived: false, createdAt: 0, updatedAt: 0 });

describe('balance check-in', () => {
  it('quincena starts on the 1st and the 16th', () => {
    expect(quincenaStart('2026-11-15')).toBe('2026-11-01');
    expect(quincenaStart('2026-11-16')).toBe('2026-11-16');
    expect(quincenaStart('2026-11-30')).toBe('2026-11-16');
  });
  it('is due until checked in this quincena; cards first', () => {
    const s = checkInStatus([acc('chk', 'checking'), acc('visa', 'credit_card')], [
      { id: 's1', accountId: 'visa', date: '2026-11-16', balance: -1, source: 'statement', createdAt: 0, updatedAt: 0 },
      { id: 's2', accountId: 'chk', date: '2026-11-02', balance: 1, source: 'statement', createdAt: 0, updatedAt: 0 },
    ], '2026-11-16');
    expect(s.map((x) => [x.account.id, x.due])).toEqual([['visa', false], ['chk', true]]);
  });
  it('a card with ₡98,198.45 and $275.30 at ₡505 owes ₡237,224.95', () => {
    expect(statementBalance(acc('v', 'credit_card'), 9_819_845, 27_530, 50_500)).toBe(-(9_819_845 + 13_902_650));
    expect(statementBalance(acc('c', 'checking'), 22_141_184, 0, null)).toBe(22_141_184);
  });
});
