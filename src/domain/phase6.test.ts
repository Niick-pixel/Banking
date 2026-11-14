import { describe, expect, it } from 'vitest';
import { balanceSheet, emergencyFund, netWorthSeries } from './networth';
import { goalProgress } from './goals';
import { cdp, futureValue, monthsToTarget, programmedSavings } from './calculators';
import { account, crc, debt, tx } from '../test/factories';
import type { BalanceSnapshot, Goal, InstallmentPlan, Pot } from './schemas';

const snap = (accountId: string, date: string, colones: number): BalanceSnapshot => ({ id: `${accountId}${date}`, accountId, date, balance: crc(colones), source: 'statement', createdAt: 0, updatedAt: 0 });

describe('net worth', () => {
  const accounts = [
    account('chk', 'checking', crc(200_000), { openingDate: '2026-09-01' }),
    account('sav', 'goal_savings', crc(400_000), { openingDate: '2026-09-01' }),
    account('ces', 'association_cesantia', crc(2_000_000), { openingDate: '2026-09-01', isLiquid: false }),
    account('card', 'credit_card', 0, { openingDate: '2026-09-01', isLiquid: false }),
  ];
  const gf = debt('gf', crc(527_000), { startDate: '2026-01-01' });
  const txs = [
    tx({ kind: 'expense', date: '2026-10-05', from: { accountId: 'card' }, amount: crc(50_000), categoryId: 'g' }),
    tx({ kind: 'debt_payment', date: '2026-10-20', from: { accountId: 'chk' }, amount: crc(30_000), debtId: 'gf', categoryId: 'l', interestPortion: 0 }),
  ];
  const plan: InstallmentPlan = { id: 'p', cardAccountId: 'card', description: 'TV', merchant: '', categoryId: 'g', currency: 'CRC', total: crc(300_000), months: 3, purchaseDate: '2026-10-01', firstChargeDate: '2026-11-20', status: 'active', notes: '', createdAt: 0, updatedAt: 0 };
  const inp = { accounts, snapshots: [snap('ces', '2026-10-31', 2_100_000)], transactions: txs, debts: [gf], installments: [plan] };

  it('statement beats ledger; liabilities include debts, cards, unbilled cuotas', () => {
    const b = balanceSheet(inp, 2026, 10, '2026-11-14')!;
    expect(b.accounts.find((a) => a.accountId === 'ces')).toMatchObject({ balance: crc(2_100_000), source: 'statement' });
    expect(b.accounts.find((a) => a.accountId === 'chk')).toMatchObject({ balance: crc(170_000), source: 'ledger' });
    expect(b.assets).toBe(crc(170_000 + 400_000 + 2_100_000));
    expect(b.creditCards).toBe(crc(50_000));
    expect(b.debts[0]!.balance).toBe(crc(497_000));
    expect(b.tasaCeroPending).toBe(crc(300_000));
    expect(b.netWorth).toBe(b.assets - crc(50_000 + 497_000 + 300_000));
  });
  it('series starts when accounts open and tracks change', () => {
    const s = netWorthSeries(inp, 2026, '2026-11-14');
    expect(s.map((x) => x.month)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(netWorthSeries({ ...inp, accounts: inp.accounts.map((a) => ({ ...a, openingDate: '2026-01-01', openingBalance: 0 })), snapshots: [] }, 2026, '2026-11-14')[0]!.month).toBe('2026-10');
    expect(s[1]!.change).toBe(s[1]!.netWorth - s[0]!.netWorth);
  });
  it('emergency fund excludes her loan fund; cesantía only in total coverage', () => {
    const b = balanceSheet(inp, 2026, 10, '2026-11-14')!;
    const pots: Pot[] = [{ id: 'h', accountId: 'sav', name: 'Hers', owner: 'hers', purpose: '', archived: false, createdAt: 0, updatedAt: 0 }];
    const ef = emergencyFund(b, accounts, pots, new Map([['h', crc(90_000)]]), crc(100_000));
    expect(ef.liquid).toBe(crc(170_000 + 400_000 - 90_000));
    expect(ef.liquidMonths).toBeCloseTo(4.8);
    expect(ef.totalMonths).toBeCloseTo(25.8);
  });
});

describe('goals', () => {
  const g: Goal = { id: 'g', name: 'Emergency fund', currency: 'CRC', target: crc(1_200_000), targetDate: '2027-11-14', plannedMonthly: crc(50_000), archived: false, createdAt: 0, updatedAt: 0 };
  it('required monthly, on-track and projected date', () => {
    const p = goalProgress(g, crc(600_000), '2026-11-14');
    expect(p).toMatchObject({ remaining: crc(600_000), monthsLeft: 12, requiredMonthly: crc(50_000), onTrack: true, projectedDate: '2027-11-14' });
    expect(goalProgress({ ...g, plannedMonthly: crc(40_000) }, crc(600_000), '2026-11-14').onTrack).toBe(false);
    expect(goalProgress(g, crc(1_300_000), '2026-11-14').reached).toBe(true);
  });
});

describe('calculators', () => {
  it('CDP: amount × rate × days / 360, 15% withholding', () => {
    const r = cdp(crc(1_000_000), 180, 5);
    expect(r.gross).toBe(crc(25_000));
    expect(r.withholding).toBe(crc(3_750));
    expect(r.net).toBe(crc(21_250));
    expect(r.maturity).toBe(crc(1_021_250));
    expect(r.netAnnualPct).toBeCloseTo(4.25);
  });
  it('programmed savings: deposits exact, more frequent deposits earn more', () => {
    const start = { year: 2027, month: 1 };
    const m = programmedSavings(crc(70_000), 12, 5, 'monthly', start);
    const q = programmedSavings(crc(70_000), 12, 5, 'quincenal', start);
    const w = programmedSavings(crc(70_000), 12, 5, 'weekly', start);
    expect(m.deposited).toBe(crc(840_000));
    expect(q.deposited).toBe(crc(840_000));
    expect(m.deposits).toBe(12);
    expect(q.deposits).toBe(24);
    expect(m.interestGross).toBeGreaterThan(crc(15_000));
    expect(m.interestGross).toBeLessThan(crc(22_000));
    // Depositing more often (earlier) earns more than one payday deposit.
    expect(q.interestGross).toBeGreaterThan(m.interestGross);
    expect(w.interestGross / w.deposited).toBeGreaterThan(m.interestGross / m.deposited);
    expect(programmedSavings(crc(70_000), 12, 0, 'monthly', start).interestGross).toBe(0);
  });
  it('what-if: future value and months to target', () => {
    expect(futureValue(crc(10_000), 12, 0)).toEqual({ final: crc(120_000), contributed: crc(120_000), interest: 0 });
    expect(monthsToTarget(crc(100_000), crc(10_000), 0)).toBe(10);
    expect(monthsToTarget(crc(100_000), 0, 0)).toBe(Infinity);
  });
});
