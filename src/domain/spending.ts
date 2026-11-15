/**
 * Data for the insight charts: daily spending (heatmap + pace) and the month waterfall.
 * Pure functions over the ledger, so every chart number is testable and matches the totals.
 */
import type { Category, Transaction } from './schemas';
import type { MonthFlow } from './ledger';

export const SPEND_GROUPS = ['Fixed', 'Living', 'Discretionary', 'Debt Service'] as const;

/**
 * Colón spending per day (expenses and debt payments). Rows whose date was estimated
 * (undated workbook rows parked on the month's last day) are left out and counted, so
 * they don't fake a spike; dollar amounts entered with a rate are already in colones.
 */
export function dailySpending(txs: Transaction[], from: string, to: string): { byDay: Map<string, number>; estimated: number } {
  const byDay = new Map<string, number>();
  let estimated = 0;
  for (const t of txs) {
    if (t.kind !== 'expense' && t.kind !== 'debt_payment') continue;
    if (t.currency !== 'CRC' || t.date < from || t.date > to) continue;
    if (t.dateEstimated) { estimated++; continue; }
    byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.amount);
  }
  return { byDay, estimated };
}

/** Running total for each day of a month (index 0 = day 1), up to `lastDay`. */
export function cumulative(byDay: Map<string, number>, month: string, days: number, lastDay = days): number[] {
  const out: number[] = [];
  let run = 0;
  for (let d = 1; d <= Math.min(days, lastDay); d++) {
    run += byDay.get(`${month}-${String(d).padStart(2, '0')}`) ?? 0;
    out.push(run);
  }
  return out;
}

export interface WaterStep { name: string; kind: 'start' | 'down' | 'subtotal' | 'end'; value: number; lo: number; hi: number; group?: string }

/** Income → minus each spending group → Net → minus saved → Free cash. Ends equal the flow totals. */
export function monthWaterfall(f: MonthFlow, category: Map<string, Category>): WaterStep[] {
  const steps: WaterStep[] = [];
  let run = f.income;
  steps.push({ name: 'Income', kind: 'start', value: f.income, lo: 0, hi: f.income });
  let grouped = 0;
  for (const g of SPEND_GROUPS) {
    const v = [...f.byCategory].filter(([id]) => category.get(id)?.group === g).reduce((s, [, x]) => s + x, 0);
    if (!v) continue;
    grouped += v;
    steps.push({ name: g, kind: 'down', value: -v, lo: Math.min(run, run - v), hi: Math.max(run, run - v), group: g });
    run -= v;
  }
  const other = f.expenses - grouped;
  if (other) { steps.push({ name: 'Uncategorized', kind: 'down', value: -other, lo: Math.min(run, run - other), hi: Math.max(run, run - other) }); run -= other; }
  steps.push({ name: 'Net', kind: 'subtotal', value: f.net, lo: Math.min(0, f.net), hi: Math.max(0, f.net) });
  if (f.saved) steps.push({ name: 'Saved', kind: 'down', value: -f.saved, lo: Math.min(f.net, f.net - f.saved), hi: Math.max(f.net, f.net - f.saved), group: 'Savings' });
  steps.push({ name: 'Free cash', kind: 'end', value: f.freeCash, lo: Math.min(0, f.freeCash), hi: Math.max(0, f.freeCash) });
  return steps;
}
