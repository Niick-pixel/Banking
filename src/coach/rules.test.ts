import { describe, expect, it } from 'vitest';
import { buildContext } from './context';
import { evaluateRules, runCoach } from './engine';
import { ex, history, inc, input, normalMonth, pay, save, crcK } from './fixtures';
import { splitWindfall } from './windfall';
import type { CoachInput } from './types';
import type { RecurringRule } from '../domain/schemas';

const H = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const fired = (inp: CoachInput, id: string) => evaluateRules(buildContext(inp)).insights.filter((i) => i.ruleId === id);
const rentRule: RecurringRule = { id: 'rr', name: 'Rent', template: { kind: 'expense', from: { accountId: 'chk' }, amount: crcK(185_000), categoryId: 'rent' }, schedule: { type: 'monthly', day: 1 }, mode: 'remind', startDate: '2026-01-01', skipped: [], informational: false, active: true, createdAt: 0, updatedAt: 0 };

describe('spec §10.9 acceptance', () => {
  it('September-like month: Living ≈ ₡855k vs ₡270k budget → R1 critical well before month end', () => {
    const sept = [ex('2026-09-03', 'pers', 322_412, 'Xbox Series X'), ex('2026-09-06', 'pers', 113_368, 'Amazon bunch'), ex('2026-09-08', 'groc', 71_336, 'PriceSmart'), ex('2026-09-09', 'pers', 61_880, 'Xbox controller')];
    const r = fired(input([...history(H.slice(0, 4)), ...sept], '2026-09-10'), 'R1');
    expect(r.find((i) => i.dedupeKey.endsWith('group:Living'))?.severity).toBe('critical');
  });
  it('rent is recurring but not logged in September and October → R8 both months', () => {
    const txs = [...history(['2026-06', '2026-07', '2026-08']), ...normalMonth('2026-09', { rent: false }), ...normalMonth('2026-10', { rent: false })];
    expect(fired(input(txs, '2026-09-20', { recurring: [rentRule] }), 'R8').map((i) => i.dedupeKey)).toContain('R8:rr:2026-09-01');
    expect(fired(input(txs, '2026-10-20', { recurring: [rentRule] }), 'R8').map((i) => i.dedupeKey)).toContain('R8:rr:2026-10-01');
    // Without a rule, rent you paid the last 3 months is still expected.
    expect(fired(input(txs, '2026-09-20'), 'R8').map((i) => i.dedupeKey)).toContain('R8:rent:2026-09');
  });
  it('October: three Amazon purchases in Unnecessary → R4', () => {
    const oct = [ex('2026-10-31', 'unn', 35_156, 'Amazon prime day', true), ex('2026-10-31', 'unn', 3_548, 'Amazon Fio', true), ex('2026-10-31', 'unn', 6_034, 'Amazon', true)];
    const r = fired(input([...history(H.slice(0, 5)), ...oct], '2026-10-31'), 'R4');
    expect(r[0]?.title).toMatch(/3 Amazon purchases/);
  });
  it('₡50,000 out of the Hers pot → R10 critical, asks for a reason, shows the refill time', () => {
    const txs = [...history(H), save('2026-11-05', 'shers', 50_000, 'withdrawal', 'hers')];
    const r = fired(input(txs, '2026-11-06'), 'R10');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ severity: 'critical', requiresReason: true });
    expect(r[0]!.body).toMatch(/1 more month/);
    // Once you give a reason, it no longer blocks.
    const st = { reasons: { [r[0]!.dedupeKey]: 'Emergency vet bill' } };
    expect(fired(input(txs, '2026-11-06', { state: st }), 'R10')[0]!.requiresReason).toBe(false);
  });
  it('aguinaldo → R15 fires and the splitter fills replenish first', () => {
    const loans = [{ id: 'sl', description: 'Borrowed for laptop', currency: 'CRC' as const, amount: crcK(200_000), borrowedOn: '2026-10-01', plannedSource: '', status: 'open' as const, notes: '', createdAt: 0, updatedAt: 0 }];
    const inp = input([...history(H), inc('2026-11-20', 'agui', 600_000, 'Aguinaldo')], '2026-11-21', { selfLoans: loans });
    const r = fired(inp, 'R15');
    expect(r).toHaveLength(1);
    const split = splitWindfall(buildContext(inp), crcK(600_000));
    expect(split[0]).toMatchObject({ target: 'replenish', amount: crcK(200_000) });
    expect(split.reduce((s, l) => s + l.amount, 0)).toBe(crcK(600_000));
    expect(split.find((l) => l.target === 'free')!.amount).toBeLessThanOrEqual(crcK(90_000));
  });
  it('only fixed costs logged by day 3 (or 6) → R1 does not fire', () => {
    for (const day of ['03', '06']) {
      const txs = [...history(H, { estimated: true }), ex('2026-11-01', 'rent', 185_000), ex('2026-11-02', 'phone', 10_865)];
      expect(fired(input(txs, `2026-11-${day}`), 'R1')).toHaveLength(0);
    }
  });
});

describe('every rule: fires / does not fire', () => {
  const base = history(H);
  it('R1 pace', () => {
    expect(fired(input([...base, ex('2026-11-08', 'food', 30_000)], '2026-11-08'), 'R1').length).toBeGreaterThan(0);
    expect(fired(input([...base, ex('2026-11-09', 'food', 12_000)], '2026-11-20'), 'R1')).toHaveLength(0);
  });
  it('R2 thresholds (and is superseded by R1 for the same category)', () => {
    const r = fired(input([...base, ex('2026-11-28', 'other', 9_000)], '2026-11-29'), 'R2');
    expect(r.map((i) => i.severity)).toEqual(['heads_up']);
    expect(fired(input([...base, ex('2026-11-28', 'other', 5_000)], '2026-11-29'), 'R2')).toHaveLength(0);
  });
  it('R3 unusual transaction', () => {
    expect(fired(input([...base, ex('2026-11-14', 'pers', 300_000, 'Xbox')], '2026-11-15'), 'R3')).toHaveLength(1);
    expect(fired(input([...base, ex('2026-11-14', 'pers', 21_000, 'Haircut')], '2026-11-15'), 'R3')).toHaveLength(0);
  });
  it('R4 discretionary cluster within 48 h', () => {
    const c = [ex('2026-11-10', 'unn', 8_000, 'Game'), ex('2026-11-11', 'unn', 5_000, 'Skin'), ex('2026-11-11', 'unn', 9_000, 'Shoes')];
    expect(fired(input([...base, ...c], '2026-11-12'), 'R4')).toHaveLength(1);
    expect(fired(input([...base, c[0]!, ex('2026-11-14', 'unn', 5_000, 'Skin')], '2026-11-15'), 'R4')).toHaveLength(0);
  });
  it('R5 payday splurge', () => {
    const pay15 = inc('2026-11-15', 'sal1', 330_000);
    expect(fired(input([...base, pay15, ex('2026-11-15', 'pers', 60_000), ex('2026-11-16', 'food', 40_000)], '2026-11-17'), 'R5')).toHaveLength(1);
    expect(fired(input([...base, pay15, ex('2026-11-16', 'food', 15_000)], '2026-11-17'), 'R5')).toHaveLength(0);
  });
  it('R6 safe-to-spend negative', () => {
    const broke = [...base, ex('2026-11-20', 'pers', 1_200_000, 'Laptop')];
    expect(fired(input(broke, '2026-11-21'), 'R6')).toHaveLength(1);
    expect(fired(input(base, '2026-11-21'), 'R6')).toHaveLength(0);
  });
  it('R7 cash-flow dip', () => {
    const low = [...base, ex('2026-11-10', 'pers', 1_000_000, 'Big purchase')];
    expect(fired(input(low, '2026-11-11'), 'R7')).toHaveLength(1);
    expect(fired(input(base, '2026-11-11', { prefs: { buffer: 0 } }), 'R7')).toHaveLength(0);
  });
  it('R8 missing recurring', () => {
    expect(fired(input(base, '2026-11-08', { recurring: [rentRule] }), 'R8')).toHaveLength(1);
    expect(fired(input([...base, ex('2026-11-01', 'rent', 185_000)], '2026-11-08', { recurring: [rentRule] }), 'R8')).toHaveLength(0);
    expect(fired(input(base, '2026-11-04', { recurring: [rentRule] }), 'R8')).toHaveLength(0); // still within 5 days
  });
  it('R9 savings at risk', () => {
    const spent = [...base, ex('2026-11-20', 'pers', 900_000, 'Sofa')];
    expect(fired(input(spent, '2026-11-28'), 'R9')).toHaveLength(1);
    expect(fired(input([...base, save('2026-11-16', 'smine', 70_000, 'deposit', 'mine'), save('2026-11-17', 'shers', 45_000, 'deposit', 'hers')], '2026-11-28'), 'R9')).toHaveLength(0);
  });
  it('R10 ignores paying her debt from her fund', () => {
    expect(fired(input([...base, pay('2026-11-05', 30_000, 'gf', { accountId: 'sav', potId: 'hers' })], '2026-11-06'), 'R10')).toHaveLength(0);
    expect(fired(input([...base, ex('2026-11-05', 'pers', 20_000, 'Oops', false, { accountId: 'sav', potId: 'hers' })], '2026-11-06'), 'R10')).toHaveLength(1);
  });
  it('R11 payoff slipping vs last month', () => {
    const paid = [...base, pay('2026-08-10', 30_000), pay('2026-09-10', 30_000), pay('2026-10-10', 30_000)];
    expect(fired(input(paid, '2026-11-10', { state: { payoff: { gf: { month: '2026-10', date: '2027-06-10' } } } }), 'R11')).toHaveLength(1);
    expect(fired(input(paid, '2026-11-10', { state: { payoff: { gf: { month: '2026-10', date: '2028-06-10' } } } }), 'R11')).toHaveLength(0);
  });
  it('R12 debt-service ratio', () => {
    const heavy = [...base, ...['2026-08', '2026-09', '2026-10'].map((m) => ex(`${m}-20`, 'card', 250_000, 'Card'))];
    expect(fired(input(heavy, '2026-11-10'), 'R12')).toHaveLength(1);
    expect(fired(input(base, '2026-11-10'), 'R12')).toHaveLength(0);
  });
  it('R13 subscription and price rise', () => {
    const sub = [...base, ex('2026-10-03', 'pers', 3_350, 'Amazon prime'), ex('2026-11-03', 'pers', 3_365, 'Amazon prime')];
    expect(fired(input(sub, '2026-11-10'), 'R13')[0]?.severity).toBe('info');
    const rise = [...base, ex('2026-10-03', 'pers', 9_060, 'Claude plan'), ex('2026-11-03', 'pers', 10_373, 'Claude plan')];
    expect(fired(input(rise, '2026-11-10'), 'R13').find((i) => /Claude/.test(i.title))?.severity).toBe('heads_up');
    expect(fired(input(base, '2026-11-10'), 'R13').filter((i) => /Kolbi/.test(i.title))).toHaveLength(1); // phone bill is steady
    expect(fired(input(base, '2026-11-10', { recurring: [{ ...rentRule, name: 'Kolbi' }] }), 'R13').filter((i) => /Kolbi/.test(i.title))).toHaveLength(0);
  });
  it('R14 lifestyle creep', () => {
    const creep = H.flatMap((m, i) => [...normalMonth(m), ex(`${m}-18`, 'pers', 20_000 * (i + 1) ** 2, 'More stuff')]);
    expect(fired(input(creep, '2026-11-10'), 'R14')).toHaveLength(1);
    expect(fired(input(base, '2026-11-10'), 'R14')).toHaveLength(0);
  });
  it('R15 ordinary side income does not count as a windfall', () => {
    const side = H.map((m) => inc(`${m}-10`, 'xinc', 15_000, 'Sold stuff'));
    expect(fired(input([...base, ...side, inc('2026-11-10', 'xinc', 18_000, 'Battery sold')], '2026-11-12'), 'R15')).toHaveLength(0);
    expect(fired(input([...base, ...side, inc('2026-11-10', 'xinc', 747_372, 'Quinquenio')], '2026-11-12'), 'R15')).toHaveLength(1);
  });
  it('R16 emergency fund', () => {
    expect(fired(input(base, '2026-11-10'), 'R16')).toHaveLength(1); // well under 6 months
    expect(fired(input(base, '2026-11-10', { }) && { ...input(base, '2026-11-10'), efTargetMonths: 0.1 }, 'R16')).toHaveLength(0);
  });
  it('R17 duplicates', () => {
    expect(fired(input([...base, ex('2026-11-10', 'groc', 12_345, 'Walmart'), ex('2026-11-11', 'groc', 12_345, 'Walmart')], '2026-11-12'), 'R17')).toHaveLength(1);
    expect(fired(input([...base, ex('2026-11-10', 'groc', 12_345, 'Walmart'), ex('2026-11-15', 'groc', 12_345, 'Walmart')], '2026-11-16'), 'R17')).toHaveLength(0);
  });
  it('R18 uncategorized backlog', () => {
    const un = (d: string) => ({ ...ex(d, 'groc', 1_000), categoryId: undefined }) as unknown as ReturnType<typeof ex>;
    expect(fired(input([...base, un('2026-11-01')], '2026-11-12'), 'R18')).toHaveLength(1);
    expect(fired(input([...base, un('2026-11-10')], '2026-11-12'), 'R18')).toHaveLength(0);
  });
  it('R19 upcoming bill under buffer', () => {
    const big = { ...rentRule, id: 'big', name: 'Insurance', schedule: { type: 'monthly' as const, day: 22 }, template: { kind: 'expense', from: { accountId: 'chk' }, amount: crcK(5_000_000), categoryId: 'phone' } };
    expect(fired(input(base, '2026-11-20', { recurring: [big] }), 'R19')).toHaveLength(1);
    expect(fired(input(base, '2026-11-10', { recurring: [big] }), 'R19')).toHaveLength(0);
  });
  it('R20 year-end funds from October', () => {
    const goals = [{ id: 'g', name: 'Marchamo', currency: 'CRC' as const, target: crcK(150_000), archived: false, createdAt: 0, updatedAt: 0 }];
    expect(fired(input(base, '2026-11-10', { goals }), 'R20')[0]?.body).toMatch(/₡75,000/);
    expect(fired(input(base, '2026-08-10', { goals }), 'R20')).toHaveLength(0);
  });
  it('R21 wins', () => {
    expect(fired(input(base, '2026-11-10'), 'R21').some((i) => /Saved/.test(i.title))).toBe(true);
    const lean = H.flatMap((m) => [inc(`${m}-15`, 'sal1', 330_000), ex(`${m}-20`, 'groc', 200_000)]);
    expect(fired(input(lean, '2026-11-10'), 'R21')).toHaveLength(0);
  });
});

describe('engine', () => {
  it('ranks, persists payoff projections, and never throws on empty data', () => {
    const run = runCoach(input(history(H), '2026-11-10'), { iso: '2026-11-10T12:00:00Z', hour: 12 });
    expect(run.errors).toEqual([]);
    const p = run.insights.map((i) => i.priority!);
    expect([...p].sort((a, b) => b - a)).toEqual(p);
    expect(run.dispatch.top.length).toBeLessThanOrEqual(3);
    expect(run.statePatch.payoff?.gf?.month).toBe('2026-11');
    expect(runCoach(input([], '2026-11-10')).errors).toEqual([]);
  });
});

describe('unknown balance', () => {
  it('without a statement for checking, balance rules stay quiet and A1 asks for the balance', () => {
    const inp = input([...history(H), ex('2026-11-20', 'pers', 1_200_000, 'Laptop')], '2026-11-21', { snapshots: [] });
    expect(fired(inp, 'R6')).toHaveLength(0);
    expect(fired(inp, 'R7')).toHaveLength(0);
    expect(fired(inp, 'A1')[0]?.action?.kind).toBe('update_balance');
    expect(fired(input(history(H), '2026-11-21', { snapshots: [{ id: 'x', accountId: 'chk', date: '2026-11-19', balance: 1, source: 'manual', createdAt: 0, updatedAt: 0 }] }), 'A1')).toHaveLength(0);
  });
});
