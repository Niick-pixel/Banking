import type { Category } from './schemas';

/** Generic starter categories for a fresh start (the workbook import brings its own). */
export const DEFAULT_CATEGORIES: [string, Category['group'], boolean?][] = [
  ['Salary - 1st quincena', 'Income'], ['Salary - 2nd quincena', 'Income'], ['Aguinaldo / Bonus', 'Income'], ['Other extra income', 'Income'],
  ['House rent', 'Fixed'], ['Cellphone', 'Fixed'], ['Entertainment & Subscriptions', 'Fixed'], ['Health insurance', 'Fixed'], ['Fitness', 'Fixed'],
  ['Groceries', 'Living'], ['Food / Dining out', 'Living'], ['Transportation', 'Living'], ['Medical', 'Living'], ['Personal', 'Living'], ['Other', 'Living'],
  ['Unnecessary', 'Discretionary', true],
  ['Credit card payment', 'Debt Service'], ['Loan repayment', 'Debt Service'],
  ['Savings - Mine', 'Savings'], ['Savings - Shared', 'Savings'], ['Savings - Replenish', 'Savings'],
];
