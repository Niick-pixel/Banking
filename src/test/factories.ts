import type { Account, Debt, Transaction } from '../domain/schemas';
import { fromMajor } from '../lib/money';

let n = 0;
const now = 0;
export const crc = (colones: number) => fromMajor(colones, 'CRC');

export function account(id: string, type: Account['type'], opening = 0, extra: Partial<Account> = {}): Account {
  return { id, name: id, institution: 'BAC', type, currency: 'CRC', openingBalance: opening, openingDate: '2026-01-01', isLiquid: true, archived: false, createdAt: now, updatedAt: now, ...extra };
}

type Dist<T> = T extends unknown ? Omit<T, 'id' | 'createdAt' | 'updatedAt' | 'currency' | 'tags' | 'notes' | 'description' | 'dateEstimated'> & Partial<Pick<Transaction, 'id' | 'description'>> : never;
export function tx(t: Dist<Transaction>): Transaction {
  return { id: `t${++n}`, currency: 'CRC', tags: [], notes: '', description: '', dateEstimated: false, createdAt: now, updatedAt: now, ...t } as Transaction;
}

export function debt(id: string, original: number, extra: Partial<Debt> = {}): Debt {
  return { id, creditor: id, kind: 'family', currency: 'CRC', originalAmount: original, annualRateBps: 0, startDate: '2026-01-01', status: 'active', checklist: {}, notes: '', adjustments: [], createdAt: now, updatedAt: now, ...extra };
}
