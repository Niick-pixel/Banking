/** Plain monthly summary. No gamification: what happened, in numbers. */
import type { Budget, Category } from './schemas';
import type { MonthFlow } from './ledger';
import { budgetFor } from './tracker';
import { formatMoney } from '../lib/money';

export interface Insight { tone: 'good' | 'bad' | 'neutral'; text: string }
export interface MonthSummary {
  savingsRate: number; prevSavingsRate?: number;
  top: { category: Category; amount: number; share: number }[];
  avoidable: number; avoidableShare: number;
  expenseChange?: number; // fraction vs previous month
  overBudget: { category: Category; amount: number; budget: number }[];
  insights: Insight[];
}

const SPEND_GROUPS = new Set(['Fixed', 'Living', 'Discretionary', 'Debt Service']);
const fmt = (n: number) => formatMoney(n, 'CRC');
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function monthSummary(month: MonthFlow | undefined, prev: MonthFlow | undefined, categories: Category[], budgets: Budget[], savingsTarget: number): MonthSummary {
  const cats = new Map(categories.map((c) => [c.id, c]));
  const f = month ?? { month: '', income: 0, expenses: 0, debtService: 0, saved: 0, paidFromSavings: 0, byCategory: new Map(), net: 0, freeCash: 0 };
  const savingsRate = f.income ? f.saved / f.income : 0;
  const prevSavingsRate = prev?.income ? prev.saved / prev.income : undefined;
  const spend = [...f.byCategory.entries()].map(([id, amount]) => ({ category: cats.get(id)!, amount })).filter((x) => x.category && SPEND_GROUPS.has(x.category.group) && x.amount > 0);
  spend.sort((a, b) => b.amount - a.amount);
  const top = spend.slice(0, 3).map((x) => ({ ...x, share: f.expenses ? x.amount / f.expenses : 0 }));
  const avoidable = spend.filter((x) => x.category.discretionary || x.category.group === 'Discretionary').reduce((s, x) => s + x.amount, 0);
  const avoidableShare = f.expenses ? avoidable / f.expenses : 0;
  const expenseChange = prev?.expenses ? (f.expenses - prev.expenses) / prev.expenses : undefined;
  const overBudget = spend.map((x) => ({ ...x, budget: budgetFor(budgets, x.category.id, f.month) })).filter((x) => x.budget > 0 && x.amount > x.budget).sort((a, b) => (b.amount - b.budget) - (a.amount - a.budget));

  const insights: Insight[] = [];
  if (f.income) insights.push({ tone: savingsRate >= savingsTarget ? 'good' : 'bad', text: `Saved ${pct(savingsRate)} of income (target ${pct(savingsTarget)})${prevSavingsRate !== undefined ? `, ${savingsRate >= prevSavingsRate ? 'up' : 'down'} from ${pct(prevSavingsRate)} last month` : ''}.` });
  if (top.length) insights.push({ tone: 'neutral', text: `Biggest spending: ${top.map((t) => `${t.category.name} ${fmt(t.amount)} (${pct(t.share)})`).join(', ')}.` });
  if (expenseChange !== undefined && Math.abs(expenseChange) >= 0.05) {
    // Largest single mover vs last month
    let mover: { name: string; delta: number } | undefined;
    for (const x of spend) { const d = x.amount - (prev?.byCategory.get(x.category.id) ?? 0); if (!mover || Math.abs(d) > Math.abs(mover.delta)) mover = { name: x.category.name, delta: d }; }
    insights.push({ tone: expenseChange > 0 ? 'bad' : 'good', text: `Spending ${expenseChange > 0 ? 'rose' : 'fell'} ${pct(Math.abs(expenseChange))} vs last month${mover && mover.delta !== 0 ? `, mostly ${mover.name} (${mover.delta > 0 ? '+' : '−'}${fmt(Math.abs(mover.delta))})` : ''}.` });
  }
  if (avoidable > 0) insights.push({ tone: avoidableShare > 0.1 ? 'bad' : 'neutral', text: `Avoidable spending: ${fmt(avoidable)} (${pct(avoidableShare)} of spending).` });
  if (overBudget.length) insights.push({ tone: 'bad', text: `Over budget: ${overBudget.slice(0, 3).map((o) => `${o.category.name} by ${fmt(o.amount - o.budget)}`).join(', ')}${overBudget.length > 3 ? ` and ${overBudget.length - 3} more` : ''}.` });
  if (f.income && f.freeCash < 0) insights.push({ tone: 'bad', text: `You spent and saved ${fmt(-f.freeCash)} more than you earned this month. That came from existing money or credit.` });
  if (f.paidFromSavings > 0) insights.push({ tone: 'neutral', text: `${fmt(f.paidFromSavings)} was paid from savings or pots (counted once, not as new spending on top of what you saved).` });
  return { savingsRate, prevSavingsRate, top, avoidable, avoidableShare, expenseChange, overBudget, insights };
}
