import { describe, expect, it } from 'vitest';
import { mad, median } from './stats';
import { buildContext, paydaysAround } from './context';
import { forecast, pace, safeToSpend } from './forecast';
import { score, urgency, userWeight } from './score';
import { dispatch, inQuietHours } from './dispatch';
import { ex, history, input, crcK } from './fixtures';
import { COACH_DEFAULTS, EMPTY_STATE } from './prefs';
import type { Insight } from './types';

const H = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];

describe('baselines', () => {
  it('median and MAD ignore one spike', () => {
    expect(median([10, 12, 11, 500])).toBe(11.5);
    expect(mad([10, 12, 11, 13, 500])).toBe(1);
  });
  it('day curve comes from dated months only; rent is all on day 1', () => {
    const ctx = buildContext(input(history(H), '2026-11-10'));
    const rent = ctx.baselines.get('rent')!;
    expect(rent.median).toBe(crcK(185_000));
    expect(rent.curve![1]).toBeCloseTo(1);
    const groc = ctx.baselines.get('groc')!;
    expect(groc.curve![4]).toBeCloseTo(40 / 130);
    expect(groc.curve![31]).toBeCloseTo(1);
  });
  it('undated history → no curve (falls back to a straight line)', () => {
    const ctx = buildContext(input(history(H, { estimated: true }), '2026-11-10'));
    expect(ctx.baselines.get('groc')!.curve).toBeNull();
  });
});

describe('pace', () => {
  it('uses the 0.15 floor early in the month', () => {
    const ctx = buildContext(input([...history(H, { estimated: true }), ex('2026-11-02', 'groc', 30_000)], '2026-11-02'));
    const p = pace(ctx, ['groc'], crcK(135_000));
    expect(p.expectedShare).toBeCloseTo(2 / 30);
    expect(p.projected).toBe(Math.round(crcK(30_000) / 0.15));
  });
  it('uses your day curve when history is dated', () => {
    const ctx = buildContext(input([...history(H), ex('2026-11-12', 'groc', 75_000)], '2026-11-12'));
    const p = pace(ctx, ['groc'], crcK(135_000));
    expect(p.curve).toBe('history');
    expect(p.expectedShare).toBeCloseTo(75 / 130);
    expect(p.ratio).toBeCloseTo(1, 1);
  });
});

describe('paydays', () => {
  it('quincena: 15th and month end', () => {
    expect(paydaysAround('2026-11-03')).toEqual({ last: '2026-10-31', next: '2026-11-15' });
    expect(paydaysAround('2026-11-15')).toEqual({ last: '2026-11-15', next: '2026-11-30' });
    expect(paydaysAround('2026-11-30')).toEqual({ last: '2026-11-30', next: '2026-12-15' });
    expect(paydaysAround('2026-12-31')).toEqual({ last: '2026-12-31', next: '2027-01-15' });
  });
});

describe('safe-to-spend and forecast', () => {
  const rent = { id: 'rr', name: 'Rent', template: { kind: 'expense', from: { accountId: 'chk' }, amount: crcK(185_000), categoryId: 'rent' }, schedule: { type: 'monthly' as const, day: 1 }, mode: 'remind' as const, startDate: '2026-01-01', skipped: [], informational: false, active: true, createdAt: 0, updatedAt: 0 };
  it('balance − bills before payday − buffer, per day', () => {
    // Opening ₡400k + Oct history (net of savings) – check the formula, not the absolute.
    const inp = input(history(['2026-10']), '2026-11-25', { recurring: [{ ...rent, schedule: { type: 'monthly', day: 28 } }] });
    const s = safeToSpend(buildContext(inp));
    expect(s.until).toBe('2026-11-30');
    expect(s.bills).toBe(crcK(185_000));
    expect(s.value).toBe(s.balance + s.income - s.bills - s.savings - COACH_DEFAULTS.buffer);
    expect(s.perDay).toBe(Math.round(s.value / 5));
  });
  it('a logged occurrence is not counted again', () => {
    const inp = input([...history(['2026-10']), ex('2026-11-28', 'rent', 185_000)], '2026-11-29', { recurring: [{ ...rent, schedule: { type: 'monthly', day: 28 } }] });
    expect(safeToSpend(buildContext(inp)).bills).toBe(0);
  });
  it('forecast adds estimated salary on paydays when no income rule exists, and flags the buffer', () => {
    const f = forecast(buildContext(input(history(H), '2026-11-20')), 60);
    const pay = f.days.find((d) => d.date === '2026-11-30')!;
    expect(pay.events.some((e) => e.kind === 'income')).toBe(true);
    expect(f.days).toHaveLength(60);
  });
});

describe('scoring and dispatch', () => {
  const ins = (p: Partial<Insight>): Insight => ({ id: 'x', ruleId: 'R1', severity: 'warning', title: '', body: '', why: { formula: '', inputs: {}, threshold: '' }, impactCRC: 100, dedupeKey: 'x', actWithinDays: 2, confidence: 1, ...p });
  it('priority = impact × urgency × confidence × weight × severity', () => {
    expect(urgency(2)).toBe(1); expect(urgency(10)).toBe(0.6); expect(urgency(30)).toBe(0.3);
    expect(score(ins({ impactCRC: 50 }), 100, EMPTY_STATE)).toBeCloseTo(0.5 * 1 * 1 * 1 * 1.5);
    expect(score(ins({ severity: 'critical', impactCRC: 500 }), 100, EMPTY_STATE)).toBeCloseTo(3);
  });
  it('three "not useful" votes halve a rule', () => {
    expect(userWeight({ ...EMPTY_STATE, notUseful: { R4: 3 } }, 'R4')).toBe(0.5);
    expect(userWeight({ ...EMPTY_STATE, notUseful: { R4: 2 } }, 'R4')).toBe(1);
  });
  it('max 3 pushes a day, quiet hours, cooldown, dismissed/snoozed hidden', () => {
    expect(inQuietHours(23, COACH_DEFAULTS)).toBe(true); expect(inQuietHours(6, COACH_DEFAULTS)).toBe(true); expect(inQuietHours(12, COACH_DEFAULTS)).toBe(false);
    const list = ['a', 'b', 'c', 'd', 'e'].map((k) => ins({ dedupeKey: k, id: k }));
    const now = { date: '2026-11-15', hour: 12, iso: '2026-11-15T12:00:00Z' };
    expect(dispatch(list, COACH_DEFAULTS, EMPTY_STATE, now).push).toHaveLength(3);
    expect(dispatch(list, COACH_DEFAULTS, EMPTY_STATE, { ...now, hour: 23 }).push).toHaveLength(0);
    const st = { ...EMPTY_STATE, pushLog: { a: '2026-11-14T12:00:00Z' }, dismissed: { b: '2026-11-15' }, snoozed: { c: '2026-11-20' }, pushDay: { date: '2026-11-15', count: 1 } };
    const d = dispatch(list, COACH_DEFAULTS, st, now);
    expect(d.inbox.map((i) => i.id)).toEqual(['a', 'd', 'e']);
    expect(d.push.map((i) => i.id)).toEqual(['d', 'e']);
    expect(dispatch([ins({ severity: 'info' })], COACH_DEFAULTS, EMPTY_STATE, now).push).toHaveLength(0);
  });
});

describe('real-data quirks', () => {
  it('monthly-total rows on the last day do not create a day curve', () => {
    const sum = (m: string) => ({ ...ex(`${m}-30`, 'groc', 130_000, 'June total'), tags: ['migrated-summary'] });
    const ctx = buildContext(input(['2026-06', '2026-07', '2026-08'].map(sum), '2026-11-15'));
    expect(ctx.baselines.get('groc')!.curve).toBeNull();
  });
  it('Coach uses the same balance as every screen (opening + everything that happened, incl. undated rows of this month)', async () => {
    const { balancesNow } = await import('../domain/ledger');
    const inp = input([ex('2026-11-30', 'groc', 50_000, 'Walmart', true), ex('2026-11-15', 'groc', 1_000, 'same day'), ex('2026-11-20', 'groc', 9_000, 'future')], '2026-11-15');
    const ctx = buildContext(inp);
    const now = balancesNow(inp.accounts, inp.transactions, '2026-11-15').get('chk')!.total;
    expect(ctx.known.get('chk')).toBe(now);
    expect(ctx.spendable).toBe(now);
  });
});
