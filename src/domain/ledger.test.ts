import { describe, expect, it } from 'vitest';
import { accountBalances, debtStatus, legs, monthlyFlows, type FlowContext } from './ledger';
import { TransactionSchema } from './schemas';
import { account, crc, debt, tx } from '../test/factories';

const checking = account('checking', 'checking', crc(1_000_000));
const savings = account('savings', 'goal_savings');
const accounts = [checking, savings];
const ctx: FlowContext = { accountType: (id) => accounts.find((a) => a.id === id)?.type };
const flowOf = (txs: Parameters<typeof monthlyFlows>[0], m = '2026-11') => monthlyFlows(txs, ctx).get(m)!;

describe('spec fixture: loan fund via Hers pot', () => {
  const gf = debt('gf', crc(527_000));
  const C = { accountId: 'checking' };
  const mine = { accountId: 'savings', potId: 'mine' };
  const hers = { accountId: 'savings', potId: 'hers' };
  const txs = [
    tx({ kind: 'income', date: '2026-11-15', to: C, amount: crc(340_000), categoryId: 'salary1' }),
    tx({ kind: 'savings', direction: 'deposit', date: '2026-11-15', from: C, to: mine, amount: crc(70_000), categoryId: 'sav-mine' }),
    tx({ kind: 'savings', direction: 'deposit', date: '2026-11-30', from: C, to: mine, amount: crc(70_000), categoryId: 'sav-mine' }),
    tx({ kind: 'savings', direction: 'deposit', date: '2026-11-15', from: C, to: hers, amount: crc(90_000), categoryId: 'sav-hers' }),
    tx({ kind: 'savings', direction: 'deposit', date: '2026-11-20', from: C, to: mine, amount: crc(100_000), categoryId: 'sav-replenish' }),
    tx({ kind: 'debt_payment', date: '2026-11-25', from: hers, amount: crc(50_000), debtId: 'gf', categoryId: 'loan-gf', interestPortion: 0, linkId: 'L1' }),
  ];

  it('Hers pot = ₡40,000', () => {
    const b = accountBalances(accounts, txs).get('savings')!;
    expect(b.pots.get('hers')).toBe(crc(40_000));
    expect(b.pots.get('mine')).toBe(crc(240_000));
    expect(b.total).toBe(crc(280_000));
  });

  it('girlfriend debt drops by ₡50,000', () => {
    expect(debtStatus(gf, txs).balance).toBe(crc(477_000));
  });

  it('paying from the pot is counted once: free cash only falls by what left checking', () => {
    const f = flowOf(txs);
    expect(f.income).toBe(crc(340_000));
    expect(f.expenses).toBe(crc(50_000));
    expect(f.debtService).toBe(crc(50_000));
    expect(f.saved).toBe(crc(280_000)); // 330k deposited − 50k paid out of the pot
    expect(f.freeCash).toBe(crc(10_000)); // 340k − 330k that actually left checking
    const checkingDelta = accountBalances(accounts, txs).get('checking')!.total - checking.openingBalance;
    expect(f.freeCash).toBe(checkingDelta);
  });
});

describe('spec fixture: transfers', () => {
  it('checking → savings changes neither income nor expenses', () => {
    const t = tx({ kind: 'transfer', date: '2026-11-10', from: { accountId: 'checking' }, to: { accountId: 'savings' }, amount: crc(200_000) });
    const f = flowOf([t]);
    expect([f.income, f.expenses, f.saved, f.freeCash]).toEqual([0, 0, 0, 0]);
    expect(legs(t).reduce((s, l) => s + l.amount, 0)).toBe(0);
  });
  it('a transfer cannot be saved with one side missing', () => {
    const bad = { ...tx({ kind: 'transfer', date: '2026-11-10', from: { accountId: 'checking' }, to: { accountId: 'savings' }, amount: 1 }) } as Record<string, unknown>;
    delete bad.to;
    expect(TransactionSchema.safeParse(bad).success).toBe(false);
  });
  it('a transfer to the same place is rejected', () => {
    const t = tx({ kind: 'transfer', date: '2026-11-10', from: { accountId: 'checking' }, to: { accountId: 'checking' }, amount: 1 });
    expect(TransactionSchema.safeParse(t).success).toBe(false);
  });
});

describe('spec fixture: undated rows land in the right month', () => {
  it('estimated last-day date buckets into its month', () => {
    const t = tx({ kind: 'expense', date: '2026-09-30', dateEstimated: true, from: { accountId: 'checking' }, amount: crc(185_000), categoryId: 'rent' } as never);
    const flows = monthlyFlows([t], ctx);
    expect(flows.get('2026-09')!.expenses).toBe(crc(185_000));
    expect(flows.has('2026-10')).toBe(false);
  });
});

describe('spec fixture: withdrawal from savings', () => {
  it('lowers savings, is not spending', () => {
    const t = tx({ kind: 'savings', direction: 'withdrawal', date: '2026-11-05', from: { accountId: 'savings', potId: 'mine' }, to: { accountId: 'checking' }, amount: crc(60_000), categoryId: 'sav-mine' });
    const f = flowOf([t]);
    expect(f.expenses).toBe(0);
    expect(f.saved).toBe(-crc(60_000));
    expect(accountBalances(accounts, [t]).get('savings')!.total).toBe(-crc(60_000));
  });
  it('…until it is actually spent', () => {
    const w = tx({ kind: 'savings', direction: 'withdrawal', date: '2026-11-05', from: { accountId: 'savings' }, to: { accountId: 'checking' }, amount: crc(60_000), categoryId: 'sav-mine' });
    const spend = tx({ kind: 'expense', date: '2026-11-06', from: { accountId: 'checking' }, amount: crc(60_000), categoryId: 'medical' });
    const f = flowOf([w, spend]);
    expect(f.expenses).toBe(crc(60_000));
    expect(f.saved).toBe(-crc(60_000));
  });
});

describe('expenses', () => {
  it('splits must add up exactly', () => {
    const base = { kind: 'expense', date: '2026-11-06', from: { accountId: 'checking' }, amount: crc(10_000) } as const;
    expect(TransactionSchema.safeParse(tx({ ...base, splits: [{ categoryId: 'a', amount: crc(4_000) }, { categoryId: 'b', amount: crc(6_000) }] })).success).toBe(true);
    expect(TransactionSchema.safeParse(tx({ ...base, splits: [{ categoryId: 'a', amount: crc(4_000) }, { categoryId: 'b', amount: crc(5_999) }] })).success).toBe(false);
  });
  it('rejects negative amounts', () => {
    expect(TransactionSchema.safeParse(tx({ kind: 'expense', date: '2026-11-06', from: { accountId: 'checking' }, amount: -5, categoryId: 'x' })).success).toBe(false);
  });
  it('credit-card purchase + card payment counts once', () => {
    const card = account('card', 'credit_card');
    const accs = [checking, card];
    const c2: FlowContext = { accountType: (id) => accs.find((a) => a.id === id)?.type };
    const buy = tx({ kind: 'expense', date: '2026-11-03', from: { accountId: 'card' }, amount: crc(25_000), categoryId: 'groceries' });
    const pay = tx({ kind: 'transfer', date: '2026-11-20', from: { accountId: 'checking' }, to: { accountId: 'card' }, amount: crc(25_000) });
    const f = monthlyFlows([buy, pay], c2).get('2026-11')!;
    expect(f.expenses).toBe(crc(25_000));
    expect(accountBalances(accs, [buy, pay]).get('card')!.total).toBe(0);
  });
});

describe('debt confirmation', () => {
  it('flags a gap between confirmed and derived balance', () => {
    const d = debt('gf', crc(527_000), { confirmedBalance: { date: '2026-11-14', amount: crc(447_000) } });
    const pay = tx({ kind: 'debt_payment', date: '2026-09-30', from: { accountId: 'checking' }, amount: crc(30_000), debtId: 'gf', categoryId: 'loan-gf', interestPortion: 0 });
    const s = debtStatus(d, [pay]);
    expect(s.balance).toBe(crc(497_000));
    expect(s.gapVsConfirmed).toBe(-crc(50_000));
  });
});
