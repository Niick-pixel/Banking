import { describe, expect, it } from 'vitest';
import { accelerate, amortize, debtServiceRatio, fundProgress, monthlyInterest, nextPaymentDate, payoffStrategy, paymentForTerm, scenarios, selfLoanProgress, verdict } from './debts';
import { crc, debt, tx } from '../test/factories';
import type { Category, SelfLoan } from './schemas';

describe('amortization', () => {
  it('0% loan: exact months, partial last payment, no interest', () => {
    const a = amortize(crc(447_000), 0, crc(90_000), '2026-12-15');
    expect(a.months).toBe(5);
    expect(a.rows.at(-1)!.payment).toBe(crc(87_000));
    expect(a.totalInterest).toBe(0);
    expect(a.totalPaid).toBe(crc(447_000));
    expect(a.payoffDate).toBe('2027-04-15');
  });
  it('8% loan: interest only on remaining balance (fixes the workbook overstatement)', () => {
    const a = amortize(crc(447_000), 800, crc(90_000), '2026-12-15');
    expect(a.months).toBe(6);
    // Workbook: 6×90,000 − 447,000 = ₡93,000 "interest". Real interest is about ₡10k.
    expect(a.totalInterest).toBeGreaterThan(crc(9_000));
    expect(a.totalInterest).toBeLessThan(crc(11_000));
    expect(a.totalPaid - a.totalInterest).toBe(crc(447_000));
  });
  it('payment below interest never pays off', () => {
    expect(amortize(crc(1_000_000), 2400, crc(1_000), '2026-12-01').never).toBe(true);
    expect(monthlyInterest(crc(1_000_000), 2400)).toBe(crc(20_000));
  });
});

describe('scenarios (matches the workbook PMT within a colón)', () => {
  it('8% on ₡447,000', () => {
    const s = scenarios(crc(447_000), 800, crc(830_710.68), '2026-12-15');
    // Workbook: 3m → 150,991.07 · 6m → 76,247.96 · 12m → 38,883.83
    expect(s.map((x) => x.payment)).toEqual([crc(150_992), crc(113_619), crc(76_248), crc(51_337), crc(38_884)]);
    expect(s[0]!.verdict).toBe('Aggressive');
    expect(s[2]!.verdict).toBe('Comfortable');
    for (const x of s) expect(x.totalRepaid - x.interest).toBe(crc(447_000));
  });
  it('0% splits evenly', () => {
    expect(paymentForTerm(crc(447_000), 0, 6)).toBe(crc(74_500));
  });
  it('verdict thresholds', () => {
    expect([verdict(0.1), verdict(0.2), verdict(0.3)]).toEqual(['Comfortable', 'Aggressive', 'Too tight']);
  });
});

describe('accelerator', () => {
  it('extra ₡30k/month saves months and interest', () => {
    const a = accelerate(crc(447_000), 800, crc(60_000), crc(30_000), '2026-12-15');
    expect(a.monthsSaved).toBeGreaterThan(0);
    expect(a.interestSaved).toBeGreaterThan(0);
  });
});

describe('avalanche vs snowball', () => {
  const debts = [
    { id: 'card', balance: crc(300_000), annualRateBps: 4800, minPayment: crc(15_000) },
    { id: 'family', balance: crc(100_000), annualRateBps: 0, minPayment: crc(10_000) },
  ];
  it('avalanche targets the highest rate and never costs more interest', () => {
    const av = payoffStrategy(debts, crc(100_000), 'avalanche');
    const sb = payoffStrategy(debts, crc(100_000), 'snowball');
    expect(av.order[0]).toBe('card');
    expect(sb.order[0]).toBe('family');
    expect(av.totalInterest).toBeLessThanOrEqual(sb.totalInterest);
    expect(sb.payoffMonth.family!).toBeLessThan(av.payoffMonth.family!);
  });
  it('budget below minimum interest → never', () => {
    expect(payoffStrategy([{ id: 'x', balance: crc(1_000_000), annualRateBps: 6000, minPayment: crc(1_000) }], crc(1_000), 'avalanche').never).toBe(true);
  });
});

describe('ratios, funds, self-loans', () => {
  it('debt service ratio warns above 20%, high above 36% with rent', () => {
    expect(debtServiceRatio(crc(90_000), crc(185_000), crc(830_000)).level).toBe('ok');
    expect(debtServiceRatio(crc(200_000), crc(0), crc(830_000)).level).toBe('warn');
    expect(debtServiceRatio(crc(150_000), crc(185_000), crc(830_000)).level).toBe('high');
  });
  it('loan fund: covered share and pay-in-full date', () => {
    const f = fundProgress(crc(447_000), crc(50_000), crc(90_000), '2026-11-14');
    expect(f.toSetAside).toBe(crc(397_000));
    expect(f.payInFullBy).toBe('2027-04-14'); // 5 more set-asides
  });
  it('self-loan: linked deposits plus FIFO replenish-category deposits', () => {
    const cats: Category[] = [{ id: 'rep', name: 'Savings - Replenish', group: 'Savings', discretionary: false, sortOrder: 0, archived: false, createdAt: 0, updatedAt: 0 }];
    const loan = (id: string, amount: number, borrowedOn: string): SelfLoan => ({ id, description: id, currency: 'CRC', amount, borrowedOn, plannedSource: '', status: 'open', notes: '', createdAt: 0, updatedAt: 0 });
    const loans = [loan('a', crc(100_000), '2026-09-01'), loan('b', crc(50_000), '2026-10-01')];
    const dep = (amount: number, date: string, selfLoanId?: string) => tx({ kind: 'savings', direction: 'deposit', date, from: { accountId: 'c' }, to: { accountId: 's' }, amount, categoryId: 'rep', selfLoanId });
    const p = selfLoanProgress(loans, [dep(crc(120_000), '2026-11-01'), dep(crc(10_000), '2026-11-02', 'b')], cats);
    expect(p[0]).toMatchObject({ putBack: crc(100_000), remaining: 0, done: true });
    expect(p[1]).toMatchObject({ putBack: crc(30_000), remaining: crc(20_000), done: false });
  });
  it('next payment date uses the fixed day', () => {
    expect(nextPaymentDate(debt('d', 1, { checklist: { fixedPaymentDay: 15 } }), '2026-11-14')).toBe('2026-11-15');
    expect(nextPaymentDate(debt('d', 1, { checklist: { fixedPaymentDay: 15 } }), '2026-11-15')).toBe('2026-12-15');
    expect(nextPaymentDate(debt('d', 1, { checklist: { fixedPaymentDay: 31 } }), '2027-02-01')).toBe('2027-02-28');
  });
});
