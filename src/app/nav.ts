/**
 * Five sections instead of fifteen pages. Each section groups related pages as
 * tabs; Settings lives on its own at the bottom left. URLs stay the same, so old
 * links, the command palette and the guided tour keep working.
 */
import { ArrowLeftRight, CreditCard, LayoutDashboard, PieChart, TrendingUp, type LucideIcon } from 'lucide-react';

export interface Page { to: string; label: string }
export interface Section { id: string; label: string; icon: LucideIcon; pages: Page[]; blurb: string }

export const SECTIONS: Section[] = [
  { id: 'home', label: 'Home', icon: LayoutDashboard, blurb: 'Your month at a glance', pages: [{ to: '/', label: 'Overview' }] },
  { id: 'activity', label: 'Activity', icon: ArrowLeftRight, blurb: 'Every movement, bills and the calendar', pages: [{ to: '/transactions', label: 'Transactions' }, { to: '/bills', label: 'Bills & calendar' }] },
  { id: 'budget', label: 'Budget', icon: PieChart, blurb: 'Budget vs actual and reports', pages: [{ to: '/tracker', label: 'Tracker' }, { to: '/reports', label: 'Reports' }] },
  { id: 'debts', label: 'Debts & cards', icon: CreditCard, blurb: 'Loans, Tasa Cero and money set aside', pages: [{ to: '/debts', label: 'Debts' }, { to: '/tasa-cero', label: 'Tasa Cero' }, { to: '/pots', label: 'Pots' }] },
  { id: 'wealth', label: 'Wealth', icon: TrendingUp, blurb: 'Net worth, accounts, goals and calculators', pages: [{ to: '/net-worth', label: 'Net worth' }, { to: '/accounts', label: 'Accounts' }, { to: '/goals', label: 'Savings & goals' }, { to: '/calculators', label: 'Calculators' }] },
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
