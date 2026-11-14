import { describe, expect, it } from 'vitest';
import { commitmentForMonth, cuotaDate, dueCuotaTransactions, planProgress, schedule, splitCuotas } from './installments';
import { TransactionSchema, type InstallmentPlan } from './schemas';
import { crc } from '../test/factories';

const plan = (o: Partial<InstallmentPlan> = {}): InstallmentPlan => ({
  id: 'p1', cardAccountId: 'card', description: 'PC upgrade', merchant: '', categoryId: 'personal', currency: 'CRC',
  total: crc(480_000), months: 6, purchaseDate: '2026-09-10', firstChargeDate: '2026-09-28', status: 'active', notes: '',
  createdAt: 0, updatedAt: 0, ...o,
});

describe('Tasa Cero split', () => {
  it('even split', () => {
    expect(splitCuotas(crc(480_000), 6)).toEqual({ regular: crc(80_000), last: crc(80_000), months: 6 });
  });
  it('last cuota absorbs the remainder, total exact to the céntimo', () => {
    const total = crc(322_412.48);
    for (const months of [3, 6, 10, 12, 18, 24, 36]) {
      const rows = schedule(total, months, '2026-01-31');
      expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(total);
      expect(rows.at(-1)!.remainingAfter).toBe(0);
      expect(rows.slice(0, -1).every((r) => r.amount % 100 === 0)).toBe(true);
    }
    expect(splitCuotas(total, 10)).toEqual({ regular: crc(32_241), last: crc(32_243.48), months: 10 });
  });
  it('dates clamp to month end', () => {
    expect(cuotaDate('2026-01-31', 2)).toBe('2026-02-28');
    expect(cuotaDate('2026-11-30', 3)).toBe('2027-01-30');
    expect(cuotaDate('2026-12-15', 13)).toBe('2027-12-15');
  });
});

describe('posting cuotas', () => {
  it('only due cuotas post, with deterministic ids, as valid card expenses', () => {
    const txs = dueCuotaTransactions(plan(), '2026-11-14', 0);
    expect(txs.map((t) => t.date)).toEqual(['2026-09-28', '2026-10-28']);
    expect(new Set(txs.map((t) => t.id)).size).toBe(2);
    expect(dueCuotaTransactions(plan(), '2026-11-14', 5).map((t) => t.id)).toEqual(txs.map((t) => t.id));
    for (const t of txs) expect(TransactionSchema.safeParse(t).success).toBe(true);
  });
  it('progress', () => {
    const p = planProgress(plan(), '2026-11-14');
    expect(p).toMatchObject({ billed: crc(160_000), billedCount: 2, pending: crc(320_000), nextDate: '2026-11-28', endDate: '2027-02-28' });
  });
  it('cancelled plans post nothing', () => {
    expect(dueCuotaTransactions(plan({ status: 'cancelled' }), '2027-12-01', 0)).toEqual([]);
  });
  it('monthly commitment across plans', () => {
    const plans = [plan(), plan({ id: 'p2', total: crc(30_000), months: 3, firstChargeDate: '2026-11-05' })];
    expect(commitmentForMonth(plans, 2026, 11)).toBe(crc(90_000));
    expect(commitmentForMonth(plans, 2027, 3)).toBe(0);
  });
});
