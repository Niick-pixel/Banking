import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildOccurrence, calendarEvents, dueOccurrences, occurrences, recurringTxId, suggestRecurring } from './recurring';
import { PREF_DEFAULTS } from './prefs';
import { account, crc, debt, tx } from '../test/factories';
import { accountBalances, monthlyFlows } from './ledger';
import type { Category, RecurringRule } from './schemas';
import { gridFromXlsx } from '../import/grid';
import { parseWorkbook } from '../import/workbook';

const rule = (o: Partial<RecurringRule> = {}): RecurringRule => ({
  id: 'r1', name: 'Rent', template: { kind: 'expense', from: { accountId: 'c' }, amount: crc(185_000), categoryId: 'rent' },
  schedule: { type: 'monthly', day: 1 }, mode: 'auto_post', startDate: '2026-09-01', skipped: [], informational: false, active: true, createdAt: 0, updatedAt: 0, ...o,
});

describe('schedules', () => {
  it('quincena: 15th and last day, leap years', () => {
    expect(occurrences({ type: 'quincena' }, '2028-01-20', '2028-01-01', '2028-02-29')).toEqual(['2028-01-31', '2028-02-15', '2028-02-29']);
  });
  it('monthly clamps day 31; yearly; weekly', () => {
    expect(occurrences({ type: 'monthly', day: 31 }, '2026-01-01', '2026-01-01', '2026-03-31')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(occurrences({ type: 'yearly', month: 12, day: 15 }, '2026-01-01', '2026-01-01', '2027-12-31')).toEqual(['2026-12-15', '2027-12-15']);
    expect(occurrences({ type: 'weekly', weekday: 1 }, '2026-11-01', '2026-11-01', '2026-11-20')).toEqual(['2026-11-02', '2026-11-09', '2026-11-16']);
  });
});

describe('due & posting', () => {
  it('auto-post: posts each missed month once; a deleted posting is not recreated', () => {
    const r = rule();
    const due = dueOccurrences(r, '2026-11-14', new Set());
    expect(due).toEqual(['2026-09-01', '2026-10-01', '2026-11-01']);
    const posted = due.map((d) => buildOccurrence(r, d, 0));
    expect(posted[0]!.id).toBe(recurringTxId('r1', '2026-09-01'));
    expect(posted[0]).toMatchObject({ kind: 'expense', recurringId: 'r1', tags: ['recurring'], amount: crc(185_000) });
    // After posting, lastHandled = Nov 1; user deletes Oct's posting → not due again.
    expect(dueOccurrences({ ...r, lastHandledDate: '2026-11-01' }, '2026-11-14', new Set([posted[0]!.id, posted[2]!.id]))).toEqual([]);
  });
  it('remind: pending until confirmed or skipped; confirmed amount can differ', () => {
    const r = rule({ mode: 'remind', schedule: { type: 'quincena' }, startDate: '2026-11-01' });
    expect(dueOccurrences(r, '2026-11-20', new Set())).toEqual(['2026-11-15']);
    expect(dueOccurrences({ ...r, skipped: ['2026-11-15'] }, '2026-11-20', new Set())).toEqual([]);
    expect(buildOccurrence(r, '2026-11-15', 0, crc(190_000)).kind === 'expense' && buildOccurrence(r, '2026-11-15', 0, crc(190_000))).toMatchObject({ amount: crc(190_000) });
  });
  it('payroll contribution as an adjustment: raises the association balance, never income or spending', () => {
    const accs = [account('c', 'checking'), account('a', 'association_voluntary')];
    const r = rule({ template: { kind: 'adjustment', side: { accountId: 'a' }, signedAmount: crc(35_000), reason: 'Payroll contribution' }, schedule: { type: 'quincena' }, startDate: '2026-11-01' });
    const txs = dueOccurrences(r, '2026-11-30', new Set()).map((d) => buildOccurrence(r, d, 0));
    expect(accountBalances(accs, txs).get('a')!.total).toBe(crc(70_000));
    const f = monthlyFlows(txs, { accountType: (id) => accs.find((a) => a.id === id)?.type }).get('2026-11')!;
    expect([f.income, f.expenses, f.saved]).toEqual([0, 0, 0]);
  });
  it('inactive or ended rules are never due', () => {
    expect(dueOccurrences(rule({ active: false }), '2026-11-14', new Set())).toEqual([]);
    expect(dueOccurrences(rule({ endDate: '2026-09-30' }), '2026-11-14', new Set())).toEqual(['2026-09-01']);
  });
});

describe('calendar', () => {
  it('merges recurring, card due dates and debt payments without duplicating a debt that has a rule', () => {
    const accounts = [account('c', 'checking'), account('card', 'credit_card', -crc(80_000), { cardDueDay: 20 })];
    const d = debt('gf', crc(300_000), { plannedMonthlyPayment: crc(100_000), checklist: { fixedPaymentDay: 15 } });
    const ev = calendarEvents({ rules: [rule({ startDate: '2026-11-01' })], transactions: [], installments: [], debts: [d], accounts, selfLoans: [], categories: [] }, '2026-11-01', '2026-11-30', '2026-11-14');
    expect(ev.map((e) => `${e.date} ${e.source} ${e.status}`)).toEqual(['2026-11-01 recurring upcoming', '2026-11-15 debt upcoming', '2026-11-20 card upcoming']);
    expect(ev.find((e) => e.source === 'card')!.amount).toBe(crc(80_000));
    const withRule = calendarEvents({ rules: [rule({ template: { kind: 'debt_payment', from: { accountId: 'c' }, amount: crc(100_000), debtId: 'gf', categoryId: 'l', interestPortion: 0 }, startDate: '2026-11-01', schedule: { type: 'monthly', day: 15 } })], transactions: [], installments: [], debts: [d], accounts, selfLoans: [], categories: [] }, '2026-11-01', '2026-11-30', '2026-11-14');
    expect(withRule.filter((e) => e.source === 'debt')).toHaveLength(0);
  });
});

describe('suggestions', () => {
  const cats: Category[] = [['sal1', 'Salary - 1st quincena', 'Income'], ['rent', 'House rent', 'Fixed'], ['food', 'Groceries', 'Living'], ['bonus', 'Aguinaldo / Bonus', 'Income'], ['sav', 'Savings - Mine', 'Savings']].map(([id, name, group]) => ({ id: id!, name: name!, group: group as Category['group'], discretionary: false, sortOrder: 0, archived: false, createdAt: 0, updatedAt: 0 }));
  const accounts = [account('c', 'checking'), account('s', 'goal_savings'), account('a', 'association_voluntary'), account('x', 'association_cesantia')];
  const txs = ['2026-07', '2026-08', '2026-09', '2026-10'].flatMap((m, i) => [
    tx({ kind: 'expense', date: `${m}-01`, from: { accountId: 'c' }, amount: crc(185_000), categoryId: 'rent' }),
    tx({ kind: 'income', date: `${m}-15`, to: { accountId: 'c' }, amount: crc(330_000 + i * 2_000), categoryId: 'sal1' }),
    tx({ kind: 'expense', date: `${m}-05`, from: { accountId: 'c' }, amount: crc(50_000 + i * 40_000), categoryId: 'food' }),
  ]);
  const s = suggestRecurring(txs, cats, accounts, PREF_DEFAULTS.payroll, '2026-11-14', []);
  it('finds steady bills and salary, ignores variable spending', () => {
    const keys = s.map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining(['cat-rent', 'cat-sal1', 'payroll-savings', 'payroll-assoc', 'payroll-cesantia', 'aguinaldo', 'marchamo']));
    expect(keys).not.toContain('cat-food');
    expect(s.find((x) => x.key === 'cat-rent')!.rule).toMatchObject({ mode: 'auto_post', schedule: { type: 'monthly', day: 1 }, startDate: '2026-11-15' });
    expect(s.find((x) => x.key === 'cat-sal1')!.rule).toMatchObject({ mode: 'remind', schedule: { type: 'monthly', day: 15 } });
  });
  it('starts next month when this month is already logged (no double counting)', () => {
    const withNov = [...txs, tx({ kind: 'income', date: '2026-11-15', to: { accountId: 'c' }, amount: crc(341_000), categoryId: 'sal1' })];
    const s2 = suggestRecurring(withNov, cats, accounts, PREF_DEFAULTS.payroll, '2026-11-14', []);
    expect(s2.find((x) => x.key === 'cat-sal1')!.rule.startDate).toBe('2026-12-01');
    expect(s2.find((x) => x.key === 'cat-rent')!.rule.startDate).toBe('2026-11-15');
  });
  it('does not suggest what already exists', () => {
    const existing = [rule({ template: { kind: 'expense', from: { accountId: 'c' }, amount: crc(185_000), categoryId: 'rent' } })];
    expect(suggestRecurring(txs, cats, accounts, PREF_DEFAULTS.payroll, '2026-11-14', existing).map((x) => x.key)).not.toContain('cat-rent');
  });
});

const REAL = 'private/Financial_Tracker.xlsx';
describe.runIf(existsSync(REAL))('suggestions from the real workbook (local only)', () => {
  it('prints suggestions', async () => {
    const buf = readFileSync(REAL);
    let i = 0;
    const p = parseWorkbook(await gridFromXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)), { fileName: 'x', today: '2026-11-14', now: 0, newId: () => `i${++i}` });
    const s = suggestRecurring(p.transactions, p.categories, p.accounts, PREF_DEFAULTS.payroll, '2026-11-14', []);
    console.log(s.map((x) => `${x.key} | ${x.name} | ${x.rule.mode} | ${JSON.stringify(x.rule.schedule)} | ${(x.rule.template as { amount?: number; signedAmount?: number }).amount ?? (x.rule.template as { signedAmount?: number }).signedAmount} | ${x.reason}`).join('\n'));
    expect(s.length).toBeGreaterThan(3);
  });
});
