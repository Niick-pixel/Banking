/**
 * The Monthly Tracker (budget vs actual), mirroring the workbook's 2026 Tracker
 * sheet, but derived from transactions instead of SUMIFS.
 */
import type { Budget, Category, Transaction } from './schemas';
import { CATEGORY_GROUPS } from './schemas';
import { monthlyFlows, type FlowContext } from './ledger';
import { daysInMonth, type ISODate } from '../lib/dates';

export interface TrackerRow {
  category: Category;
  budget: number;           // monthly budget (0 = none)
  months: number[];         // 12 actuals (signed: savings withdrawals negative)
  ytd: number;
  avg: number;              // ytd / months with data (like the workbook)
  vsBudget: number;         // budget − avg
  pctOfIncome: number;      // ytd / ytd income
  over: boolean[];          // per month: expense over budget / saving under budget
}
export interface TrackerSection { group: Category['group']; rows: TrackerRow[]; subtotal: { budget: number; months: number[]; ytd: number; avg: number } }
export interface Tracker {
  year: number;
  monthsWithData: number;
  sections: TrackerSection[];
  income: number[]; expenses: number[]; saved: number[]; net: number[]; freeCash: number[];
  ytd: { income: number; expenses: number; saved: number; net: number; freeCash: number };
  budgetTotals: { income: number; expenses: number; saved: number };
}

export function budgetFor(budgets: Budget[], categoryId: string, month: string): number {
  const specific = budgets.find((b) => b.categoryId === categoryId && b.month === month);
  if (specific) return specific.amount;
  return budgets.find((b) => b.categoryId === categoryId && b.month === '*')?.amount ?? 0;
}

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

export function computeTracker(year: number, txs: Transaction[], categories: Category[], budgets: Budget[], ctx: FlowContext): Tracker {
  const yearTx = txs.filter((t) => t.date.startsWith(`${year}-`));
  const flows = monthlyFlows(yearTx, ctx);
  const mk = (m: number) => `${year}-${String(m + 1).padStart(2, '0')}`;
  const income = Array.from({ length: 12 }, (_, m) => flows.get(mk(m))?.income ?? 0);
  const expenses = Array.from({ length: 12 }, (_, m) => flows.get(mk(m))?.expenses ?? 0);
  const saved = Array.from({ length: 12 }, (_, m) => flows.get(mk(m))?.saved ?? 0);
  const net = income.map((v, i) => v - expenses[i]!);
  const freeCash = net.map((v, i) => v - saved[i]!);
  const monthsWithData = Math.max(1, income.filter((v) => v > 0).length);
  const ytdIncome = sum(income);

  const sections: TrackerSection[] = CATEGORY_GROUPS.map((group) => {
    const rows = categories.filter((c) => c.group === group && !c.archived).map((category): TrackerRow => {
      const months = Array.from({ length: 12 }, (_, m) => flows.get(mk(m))?.byCategory.get(category.id) ?? 0);
      const budget = budgetFor(budgets, category.id, '*');
      const ytd = sum(months);
      const avg = Math.round(ytd / monthsWithData);
      const over = months.map((v, m) => {
        const b = budgetFor(budgets, category.id, mk(m));
        if (!b || !v) return false;
        if (group === 'Income') return false;
        if (group === 'Savings') return v < b;
        return v > b;
      });
      return { category, budget, months, ytd, avg, vsBudget: budget - avg, pctOfIncome: ytdIncome ? ytd / ytdIncome : 0, over };
    });
    const months = Array.from({ length: 12 }, (_, m) => sum(rows.map((r) => r.months[m]!)));
    const ytd = sum(months);
    return { group, rows, subtotal: { budget: sum(rows.map((r) => r.budget)), months, ytd, avg: Math.round(ytd / monthsWithData) } };
  });
  const bt = (gs: Category['group'][]) => sum(sections.filter((s) => gs.includes(s.group)).map((s) => s.subtotal.budget));
  return {
    year, monthsWithData, sections, income, expenses, saved, net, freeCash,
    ytd: { income: ytdIncome, expenses: sum(expenses), saved: sum(saved), net: sum(net), freeCash: sum(freeCash) },
    budgetTotals: { income: bt(['Income']), expenses: bt(['Fixed', 'Living', 'Discretionary', 'Debt Service']), saved: bt(['Savings']) },
  };
}

export interface BudgetAlert { category: Category; spent: number; budget: number; pct: number; projected: number; level: 'warn' | 'over' }

/** Current-month pace: "at this pace you'll spend ₡X". Alerts at 80% and 100%. */
export function budgetAlerts(t: Tracker, today: ISODate): BudgetAlert[] {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  if (y !== t.year) return [];
  const dim = daysInMonth(y, m);
  const out: BudgetAlert[] = [];
  for (const s of t.sections) {
    if (!['Fixed', 'Living', 'Discretionary', 'Debt Service'].includes(s.group)) continue;
    for (const r of s.rows) {
      const spent = r.months[m - 1]!;
      if (!r.budget || spent <= 0) continue;
      const pct = spent / r.budget;
      // Fixed costs are lumpy (rent lands once), so only project living/discretionary.
      const projected = ['Living', 'Discretionary'].includes(s.group) ? Math.round((spent / d) * dim) : spent;
      if (pct >= 0.8) out.push({ category: r.category, spent, budget: r.budget, pct, projected, level: pct >= 1 ? 'over' : 'warn' });
    }
  }
  return out.sort((a, b) => b.pct - a.pct);
}
