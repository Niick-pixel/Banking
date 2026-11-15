/** Replays the Coach over the real workbook. Runs only where the private file exists (never in CI). */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gridFromXlsx } from '../import/grid';
import { parseWorkbook } from '../import/workbook';
import { monthlyFlows } from '../domain/ledger';
import { PREF_DEFAULTS } from '../domain/prefs';
import { COACH_DEFAULTS, EMPTY_STATE } from './prefs';
import { replay } from './replay';

const REAL = 'private/Financial_Tracker.xlsx';
describe.runIf(existsSync(REAL))('Coach replay over the real workbook (local only)', () => {
  it('fires what spec §10.9 expects', async () => {
    const buf = readFileSync(REAL);
    const grid = await gridFromXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    let i = 0;
    const p = parseWorkbook(grid, { fileName: 'real', today: '2026-11-15', now: 0, newId: () => `r${++i}` });
    const acc = new Map(p.accounts.map((a) => [a.id, a]));
    const months = replay({
      today: '2026-11-15', hour: 12, transactions: p.transactions, categories: p.categories, accounts: p.accounts, pots: p.pots,
      budgets: p.budgets, debts: p.debts, recurring: [], selfLoans: p.selfLoans, goals: [], snapshots: p.snapshots,
      flows: monthlyFlows(p.transactions, { accountType: (id) => acc.get(id)?.type }),
      prefs: COACH_DEFAULTS, state: EMPTY_STATE, savingsRateTarget: 0.2, efTargetMonths: 6, payroll: PREF_DEFAULTS.payroll,
    });
    writeFileSync('private/tmp/replay.txt', months.map((m) => `== ${m.month} (as of ${m.asOf})\n${m.insights.map((x) => `  [${x.ruleId} ${x.severity} ${(x.priority ?? 0).toFixed(3)}] ${x.title}\n      ${x.body}`).join('\n')}`).join('\n'));
    const at = (mk: string) => months.find((m) => m.month === mk)!.insights;
    expect(at('2026-09').find((x) => x.dedupeKey === 'R1:2026-09:group:Living')?.severity).toBe('critical');
    expect(at('2026-10').some((x) => x.ruleId === 'R4' && /Amazon/.test(x.title))).toBe(true);
    expect(at('2026-11').some((x) => x.ruleId === 'R15' && /Quinquenio/.test(x.title))).toBe(true);
  });
});
