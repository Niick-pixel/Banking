/**
 * Six sections instead of fifteen pages. Each section groups related pages as
 * tabs; Settings lives on its own at the bottom left. URLs stay the same, so old
 * links, the command palette and the guided tour keep working.
 */
import { ArrowLeftRight, Compass, CreditCard, LayoutDashboard, PieChart, TrendingUp, type LucideIcon } from 'lucide-react';

export interface Page { to: string; label: string }
export interface Section { id: string; label: string; icon: LucideIcon; pages: Page[]; blurb: string }

export const SECTIONS: Section[] = [
  { id: 'home', label: 'Home', icon: LayoutDashboard, blurb: 'Your month at a glance', pages: [{ to: '/', label: 'Overview' }, { to: '/review', label: 'Quincena review' }] },
  { id: 'coach', label: 'Coach', icon: Compass, blurb: 'Alerts, safe-to-spend, forecast', pages: [{ to: '/coach', label: 'Inbox' }, { to: '/coach/forecast', label: 'Forecast' }, { to: '/coach/wants', label: 'Cooling-off' }, { to: '/coach/reports', label: 'Reports' }, { to: '/coach/history', label: 'History replay' }] },
  { id: 'activity', label: 'Activity', icon: ArrowLeftRight, blurb: 'Every movement, Tasa Cero plans, bills and the calendar', pages: [{ to: '/transactions', label: 'Transactions' }, { to: '/tasa-cero', label: 'Tasa Cero' }, { to: '/bills', label: 'Bills & calendar' }] },
  { id: 'budget', label: 'Budget', icon: PieChart, blurb: 'Budget vs actual, categories and reports', pages: [{ to: '/tracker', label: 'Budget' }, { to: '/categories', label: 'Categories' }, { to: '/reports', label: 'Reports' }] },
  { id: 'debts', label: 'Debts & cards', icon: CreditCard, blurb: 'Loans, cards, funds and balance check-ins', pages: [{ to: '/debts', label: 'Debts' }, { to: '/funds', label: 'Funds' }, { to: '/check-in', label: 'Balance check-in' }] },
  { id: 'wealth', label: 'Wealth', icon: TrendingUp, blurb: 'Net worth, accounts, goals and calculators', pages: [{ to: '/net-worth', label: 'Overview' }, { to: '/accounts', label: 'Accounts' }, { to: '/goals', label: 'Savings & goals' }, { to: '/calculators', label: 'Calculators' }] },
];

export const SETTINGS_PATHS = ['/settings', '/import'];

export function sectionFor(path: string): Section | null {
  const p = path.replace(/\/$/, '') || '/';
  return SECTIONS.find((s) => s.pages.some((pg) => pg.to === p)) ?? null;
}

/** Flat list for the command palette. */
export const ALL_PAGES = [
  ...SECTIONS.flatMap((s) => s.pages.map((p) => ({ to: p.to, label: s.pages.length > 1 ? `${p.label}` : s.label, section: s.label, ready: true }))),
  { to: '/settings', label: 'Settings', section: 'Settings', ready: true },
  { to: '/import', label: 'Import workbook', section: 'Settings', ready: true },
];
