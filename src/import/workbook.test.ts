import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gridFromXlsx, type CellValue, type Grid } from './grid';
import { parseWorkbook } from './workbook';

let i = 0;
const opts = { fileName: 'test.xlsx', today: '2026-11-14', now: 0, newId: () => `id${++i}` };
const row = (...v: CellValue[]) => v;

/** Synthetic workbook with the same shape as the real one (no personal data). */
function synthetic(): Grid {
  return {
    sheets: [
      { name: 'Setup', rows: [row('SETUP'), row(null, null, null, null, null, 'CATEGORY', 'GROUP'),
        row(null, null, null, null, null, 'Salary - 1st quincena', 'INCOME'),
        row(null, null, null, null, null, 'Groceries', 'LIVING / VARIABLE'),
        row(null, null, null, null, null, 'Loan repayment - Uncle', 'DEBT SERVICE'),
        row(null, null, null, null, null, 'Savings - Mine', 'SAVINGS'),
        row(null, null, null, null, null, 'Savings - Hers (loan fund)', 'SAVINGS')] },
      { name: 'Transactions', rows: [
        row('LEDGER'),
        row('DATE (optional)', 'MONTH', 'TYPE', 'CATEGORY', 'DESCRIPTION', 'AMOUNT (₡)', null, 'self-check', 123),
        row('MARCH 2026'),
        row(null, 3, 'Income', 'Salary - 1st quincena', 'Pay', 300000.5),
        row(new Date(Date.UTC(2026, 2, 10)), 3, 'Expense', 'Groceries', 'Market', 20000),
        row(null, 3, 'Expense', 'Groceries', '^', 1500),
        row(null, 3, 'Expense', 'Loan repayment - Uncle', null, 50000),
        row(null, 3, 'Savings', 'Savings - Mine', null, 70000),
        row(null, 3, 'Income', 'Savings - Mine', null, 10000),
        row(null, 3, 'Savings', 'Savings - Mine', 'withdrawal', -5000),
        row(null, 3, 'Expense', 'Groceries', 'no amount'),
        row(null, 3),
        row('March total', null, null, null, null, 446501.5),
        row('APRIL 2026'),
        row(null, 4, 'Savings', 'Savings - Hers (loan fund)', null, 90000),
        row('April total'),
      ] },
      { name: '2026 Tracker', rows: [
        row('2026'),
        row('INCOME', 'MONTHLY BUDGET', 'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL'),
        row('Salary - 1st quincena', 300000, 0, 0, 300000.5, 0),
        row('Groceries', 25000),
        row('TOTAL INCOME', 300000, 0, 0, 300000.5, 0),
        row('TOTAL EXPENSES', 0, 0, 0, 71500, 0),
        row('TOTAL SAVED', 0, 0, 0, 75000, 90000),
      ] },
      { name: 'Debts', rows: [
        row('DEBTS'),
        row('DEBT / CREDITOR', 'CCY', 'ORIGINAL', 'BALANCE NOW', 'ANNUAL RATE', 'MONTHLY PAYMENT'),
        row('Uncle - car', 'CRC', 200000, 150000, 0.05, 50000),
        row('TOTAL'),
      ] },
      { name: 'Net Worth', rows: [
        row('NW'),
        row('ACCOUNT', 'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL'),
        row('BAC Colones (checking)', null, null, 500000, null),
        row('BAC Ahorro Objetivo (savings)', null, 100000, 175000, 265000),
        row('Association - my savings plan', null, 1000, 2000),
        row('Association - cesantía reserve (obrero + patronal)', null, 1000, 2000),
        row('TOTAL ASSETS'),
      ] },
      { name: 'Dashboard', rows: [row('x')] },
    ],
  };
}

describe('workbook importer (synthetic)', () => {
  const plan = parseWorkbook(synthetic(), opts);
  const byDesc = (d: string) => plan.transactions.filter((t) => t.description === d);

  it('detects sheets and ignores calculated ones', () => {
    expect(plan.detected.find((d) => d.sheet === 'Dashboard')?.role).toBe('Ignored');
    expect(plan.categories).toHaveLength(5);
  });
  it('maps kinds correctly', () => {
    const kinds = plan.transactions.map((t) => t.kind);
    expect(kinds.filter((k) => k === 'income')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'debt_payment')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'savings')).toHaveLength(4);
    expect(plan.transactions.find((t) => t.kind === 'income')!.amount).toBe(30000050);
  });
  it('undated rows → last day of month, flagged; dated rows keep their date', () => {
    expect(byDesc('Market')[0]).toMatchObject({ date: '2026-03-10', dateEstimated: false });
    expect(byDesc('Pay')[0]).toMatchObject({ date: '2026-03-31', dateEstimated: true });
  });
  it('resolves ditto descriptions', () => {
    expect(byDesc('Market')).toHaveLength(2);
    expect(byDesc('Market')[1]!.notes).toMatch(/same as above/);
  });
  it('negative savings → withdrawal; Income-typed savings row warned', () => {
    expect(plan.transactions.some((t) => t.kind === 'savings' && t.direction === 'withdrawal' && t.amount === 500000)).toBe(true);
    expect(plan.issues.some((x) => x.level === 'warning' && /TYPE is "Income"/.test(x.message))).toBe(true);
  });
  it('Hers savings go to the Hers pot, which becomes the family debt\'s loan fund', () => {
    const hers = plan.pots.find((p) => p.owner === 'hers')!;
    expect(plan.debts[0]!.fundPotId).toBe(hers.id);
    expect(plan.transactions.some((t) => t.kind === 'savings' && t.to.potId === hers.id)).toBe(true);
  });
  it('accounts, snapshots, copy detector, budgets, debts', () => {
    expect(plan.accounts.map((a) => a.type)).toEqual(['checking', 'goal_savings', 'association_voluntary', 'association_cesantia']);
    const ahorro = plan.accounts[1]!;
    expect(ahorro).toMatchObject({ openingBalance: 10000000, openingDate: '2026-03-01' });
    expect(plan.snapshots.filter((s) => s.accountId === ahorro.id)).toHaveLength(3);
    expect(plan.issues.some((x) => /same balances/.test(x.message))).toBe(true);
    expect(plan.budgets).toHaveLength(2);
    expect(plan.debts[0]).toMatchObject({ originalAmount: 20000000, annualRateBps: 500, confirmedBalance: { amount: 15000000 } });
  });
  it('skips the amount-less row with a note', () => {
    expect(plan.issues.some((x) => /no amount/.test(x.message))).toBe(true);
  });
  it('reconciles to the Tracker exactly', () => {
    for (const r of plan.reconciliation) expect(r.imported).toEqual(r.tracker);
  });
});

/** Runs only where the real workbook exists locally (git-ignored; never in CI). */
const REAL = 'private/Financial_Tracker.xlsx';
describe.runIf(existsSync(REAL))('real workbook (local only)', () => {
  it('imports and reconciles every month to the céntimo', async () => {
    const buf = readFileSync(REAL);
    const grid = await gridFromXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const plan = parseWorkbook(grid, { ...opts, fileName: REAL });
    console.log(JSON.stringify({ detected: plan.detected, counts: { tx: plan.transactions.length, acc: plan.accounts.length, snaps: plan.snapshots.length, budgets: plan.budgets.length, debts: plan.debts.length, pots: plan.pots.length }, issues: plan.issues, recon: plan.reconciliation }, null, 1));
    expect(plan.issues.filter((x) => x.level === 'error')).toEqual([]);
    for (const r of plan.reconciliation) expect({ m: r.month, ...r.imported }).toEqual({ m: r.month, ...r.tracker });
  });
});
