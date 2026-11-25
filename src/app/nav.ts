/**
 * Six sections instead of fifteen pages. Each section groups related pages as
 * tabs; Settings lives on its own at the bottom left. URLs stay the same, so old
 * links, the command palette and the guided tour keep working.
 */
import { ArrowLeftRight, BarChart3, Compass, CreditCard, LayoutDashboard, Package, PieChart, TrendingUp, type LucideIcon } from 'lucide-react';

export interface Page { to: string; label: string }
export interface Section { id: string; label: string; icon: LucideIcon; pages: Page[]; blurb: string }

export const SECTIONS: Section[] = [
  { id: 'home', label: 'Home', icon: LayoutDashboard, blurb: 'Your month at a glance', pages: [{ to: '/', label: 'Overview' }] },
  { id: 'coach', label: 'Coach', icon: Compass, blurb: 'Alerts, safe-to-spend, forecast and cooling-off, in one window', pages: [{ to: '/coach', label: 'Coach' }] },
  { id: 'activity', label: 'Activity', icon: ArrowLeftRight, blurb: 'Every movement', pages: [{ to: '/transactions', label: 'Transactions' }] },
  { id: 'budget', label: 'Budget', icon: PieChart, blurb: 'Budget vs actual; categories top right', pages: [{ to: '/tracker', label: 'Budget' }] },
  { id: 'reports', label: 'Reports', icon: BarChart3, blurb: 'How the month went, and the calendar with your bills', pages: [{ to: '/reports', label: 'Summary' }, { to: '/calendar', label: 'Calendar' }] },
  { id: 'debts', label: 'Debts & cards', icon: CreditCard, blurb: 'What you owe, what others owe you, funds and check-ins', pages: [{ to: '/debts', label: 'Debts & lending' }, { to: '/funds', label: 'Funds' }, { to: '/check-in', label: 'Balance check-in' }] },
  { id: 'wealth', label: 'Wealth', icon: TrendingUp, blurb: 'Net worth and accounts, goals and calculators', pages: [{ to: '/net-worth', label: 'Wealth' }, { to: '/goals', label: 'Savings & goals' }, { to: '/calculators', label: 'Calculators' }] },
  { id: 'inventory', label: 'Inventory', icon: Package, blurb: 'Products, stock and sales', pages: [{ to: '/inventory', label: 'Inventory' }] },
];

/** Pages that live inside another page now (a view switch top right): which tab to highlight. */
const ALIASES: Record<string, string> = { '/categories': '/tracker', '/accounts': '/net-worth', '/net-worth/months': '/net-worth', '/review': '/', '/tasa-cero': '/transactions' };


export const SETTINGS_PATHS = ['/settings', '/import'];

export const canonicalPath = (path: string) => { const raw = path.replace(/\/$/, '') || '/'; return ALIASES[raw] ?? raw; };

export function sectionFor(path: string): Section | null {
  const raw = path.replace(/\/$/, '') || '/';
  const p = ALIASES[raw] ?? raw;
  return SECTIONS.find((s) => s.pages.some((pg) => pg.to === p)) ?? null;
}

/** Flat list for the command palette. */
export const ALL_PAGES = [
  ...SECTIONS.flatMap((s) => s.pages.map((p) => ({ to: p.to, label: s.pages.length > 1 ? `${p.label}` : s.label, section: s.label, ready: true }))),
  { to: '/settings', label: 'Settings', section: 'Settings', ready: true },
  { to: '/import', label: 'Import workbook', section: 'Settings', ready: true },
];
