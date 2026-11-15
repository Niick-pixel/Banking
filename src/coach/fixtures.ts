/** Test fixtures for the Coach: a small household that looks like the real one. */
import { monthlyFlows } from '../domain/ledger';
import { PREF_DEFAULTS } from '../domain/prefs';
import type { Account, BalanceSnapshot, Budget, Category, Debt, Goal, Pot, RecurringRule, SelfLoan, Transaction } from '../domain/schemas';
import { COACH_DEFAULTS, EMPTY_STATE } from './prefs';
import type { CoachInput, CoachPrefs, CoachState } from './types';

const k = (colones: number) => Math.round(colones * 100);
export const crcK = k;

export const ACC: Account[] = [
  { id: 'chk', name: 'BAC Colones', institution: 'BAC', type: 'checking', currency: 'CRC', openingBalance: k(400_000), openingDate: '2026-01-01', isLiquid: true, archived: false, createdAt: 0, updatedAt: 0 },
  { id: 'sav', name: 'Ahorro', institution: 'BAC', type: 'goal_savings', currency: 'CRC', openingBalance: k(0), openingDate: '2026-01-01', isLiquid: true, archived: false, createdAt: 0, updatedAt: 0 },
] as Account[];
export const POTS: Pot[] = [
  { id: 'mine', accountId: 'sav', name: 'Mine', owner: 'mine', purpose: '', archived: false, createdAt: 0, updatedAt: 0 },
  { id: 'hers', accountId: 'sav', name: 'Hers (loan fund)', owner: 'hers', purpose: '', archived: false, createdAt: 0, updatedAt: 0 },
];
const c = (id: string, name: string, group: Category['group'], discretionary = false): Category => ({ id, name, group, discretionary, sortOrder: 0, archived: false, createdAt: 0, updatedAt: 0 });
export const CATS: Category[] = [
  c('sal1', 'Salary - 1st quincena', 'Income'), c('sal2', 'Salary - 2nd quincena', 'Income'), c('agui', 'Aguinaldo / Bonus', 'Income'), c('xinc', 'Other extra income', 'Income'),
  c('rent', 'House rent', 'Fixed'), c('phone', 'Cellphone', 'Fixed'),
  c('groc', 'Groceries', 'Living'), c('food', 'Food / Dining out', 'Living'), c('pers', 'Personal', 'Living'), c('other', 'Other', 'Living'),
  c('unn', 'Unnecessary', 'Discretionary', true),
  c('loan', 'Loan repayment - Girlfriend', 'Debt Service'), c('card', 'Credit card payment', 'Debt Service'),
  c('smine', 'Savings - Mine', 'Savings'), c('shers', 'Savings - Hers (loan fund)', 'Savings'), c('srep', 'Savings - Replenish', 'Savings'),
];
const b = (categoryId: string, colones: number): Budget => ({ id: `b-${categoryId}`, categoryId, month: '*', amount: k(colones), currency: 'CRC', rollover: false, createdAt: 0, updatedAt: 0 });
export const BUDGETS: Budget[] = [b('rent', 185_000), b('phone', 10_865), b('groc', 135_000), b('food', 40_000), b('pers', 35_000), b('other', 10_000), b('unn', 50_000), b('smine', 140_000), b('shers', 90_000)];
export const DEBTS: Debt[] = [{ id: 'gf', creditor: 'Girlfriend', kind: 'family', currency: 'CRC', originalAmount: k(447_000), annualRateBps: 0, startDate: '2026-08-01', plannedMonthlyPayment: k(30_000), status: 'active', createdAt: 0, updatedAt: 0 } as Debt];

let n = 0;
const base = (date: string, estimated = false) => ({ id: `t${++n}`, date, dateEstimated: estimated, currency: 'CRC' as const, description: '', tags: [] as string[], notes: '', createdAt: 0, updatedAt: 0 });
export const ex = (date: string, categoryId: string, colones: number, description = '', estimated = false, from: { accountId: string; potId?: string } = { accountId: 'chk' }): Transaction =>
  ({ ...base(date, estimated), kind: 'expense', from, amount: k(colones), categoryId, description }) as Transaction;
export const inc = (date: string, categoryId: string, colones: number, description = '', estimated = false): Transaction =>
  ({ ...base(date, estimated), kind: 'income', to: { accountId: 'chk' }, amount: k(colones), categoryId, description }) as Transaction;
export const save = (date: string, categoryId: string, colones: number, direction: 'deposit' | 'withdrawal', pot: string, notes = ''): Transaction =>
  ({ ...base(date), kind: 'savings', direction, amount: k(colones), categoryId, notes,
    ...(direction === 'deposit' ? { from: { accountId: 'chk' }, to: { accountId: 'sav', potId: pot } } : { from: { accountId: 'sav', potId: pot }, to: { accountId: 'chk' } }) }) as Transaction;
export const pay = (date: string, colones: number, debtId = 'gf', from: { accountId: string; potId?: string } = { accountId: 'chk' }): Transaction =>
  ({ ...base(date), kind: 'debt_payment', from, amount: k(colones), debtId, categoryId: 'loan', interestPortion: 0 }) as Transaction;

/** A normal month: two pays, rent, phone, groceries spread across the month, savings. */
export function normalMonth(mk: string, opts: { rent?: boolean; estimated?: boolean } = {}): Transaction[] {
  const d = (day: number) => `${mk}-${String(day).padStart(2, '0')}`;
  const e = !!opts.estimated;
  const last = new Date(Date.UTC(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)), 0)).getUTCDate();
  return [
    inc(d(15), 'sal1', 330_000, '', e), inc(d(last), 'sal2', 330_000, '', e),
    ...(opts.rent === false ? [] : [ex(d(1), 'rent', 185_000, 'Rent', e)]),
    ex(d(5), 'phone', 10_865, 'Kolbi', e),
    ex(d(4), 'groc', 40_000, 'Walmart', e), ex(d(12), 'groc', 35_000, 'PriceSmart', e), ex(d(20), 'groc', 30_000, 'Walmart', e), ex(d(27), 'groc', 25_000, 'Fresh market', e),
    ex(d(9), 'food', 12_000, 'Pizza', e), ex(d(22), 'food', 15_000, 'Sushi', e),
    ex(d(14), 'pers', 20_000, 'Haircut and stuff', e),
    save(d(15), 'smine', 70_000, 'deposit', 'mine'), save(d(last), 'smine', 70_000, 'deposit', 'mine'), save(d(16), 'shers', 45_000, 'deposit', 'hers'),
  ];
}

export function input(txs: Transaction[], today: string, over: { snapshots?: BalanceSnapshot[]; prefs?: Partial<CoachPrefs>; state?: Partial<CoachState>; recurring?: RecurringRule[]; selfLoans?: SelfLoan[]; goals?: Goal[]; debts?: Debt[] } = {}): CoachInput {
  const acc = new Map(ACC.map((a) => [a.id, a]));
  return {
    today, hour: 12, transactions: txs, categories: CATS, accounts: ACC, pots: POTS, budgets: BUDGETS, debts: over.debts ?? DEBTS,
    // The checking balance is known from a statement (the opening ₡400k on Jan 1).
    snapshots: over.snapshots ?? [{ id: 's', accountId: 'chk', date: '2026-01-01', balance: k(400_000), source: 'manual', createdAt: 0, updatedAt: 0 }],
    recurring: over.recurring ?? [], selfLoans: over.selfLoans ?? [], goals: over.goals ?? [],
    flows: monthlyFlows(txs, { accountType: (id) => acc.get(id)?.type }),
    prefs: { ...COACH_DEFAULTS, ...over.prefs }, state: { ...EMPTY_STATE, ...over.state },
    savingsRateTarget: 0.2, efTargetMonths: 6, payroll: PREF_DEFAULTS.payroll,
  };
}

export const history = (months: string[], opts?: { rent?: boolean; estimated?: boolean }) => months.flatMap((m) => normalMonth(m, opts));
