import { describe, expect, it } from 'vitest';
import { cardsSummary, nextDayOfMonth } from './cards';
import type { Account } from './schemas';

const card = (id: string, extra: Partial<Account> = {}): Account => ({ id, name: id, institution: '', type: 'credit_card', currency: 'CRC', openingBalance: 0, openingDate: '2026-11-16', isLiquid: false, archived: false, createdAt: 0, updatedAt: 0, ...extra });
const bal = (n: number) => ({ accountId: '', total: n, pots: new Map(), unassigned: n });

describe('credit cards as debt', () => {
  it('next due date rolls into next month and handles short months', () => {
    expect(nextDayOfMonth(5, '2026-11-16')).toBe('2026-12-05');
    expect(nextDayOfMonth(20, '2026-11-16')).toBe('2026-11-20');
    expect(nextDayOfMonth(31, '2027-02-10')).toBe('2027-02-28');
  });
  it('adds all cards together, biggest first, with utilization', () => {
    const s = cardsSummary([card('visa', { cardLimit: 50_000_000, cardDueDay: 5 }), card('amex', { cardDueDay: 20 }), { ...card('chk'), type: 'checking' }],
      new Map([['visa', bal(-23_722_495)], ['amex', bal(-159_440)], ['chk', bal(100)]]), [], '2026-11-16');
    expect(s.cards.map((c) => c.account.id)).toEqual(['visa', 'amex']);
    expect(s.totalOwed).toBe(23_881_935);
    expect(s.cards[0]!.utilization).toBeCloseTo(0.474, 3);
    expect(s.nextDue?.account.id).toBe('amex'); // the 20th comes before the 5th of next month
  });
});
