/**
 * Appearance (per device): light/dark mode, which of the 3 light and 3 dark themes,
 * transparency, density, content width, UI size and animation speed.
 * Everything is applied as attributes/variables on <html> so CSS does the work.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemePref = 'auto' | 'light' | 'dark';
export type TransparencyPref = 'auto' | 'frosted' | 'reduced';
export type ThemeId = 'paper' | 'graphite' | 'sage' | 'terracotta' | 'ledger';
/** @deprecated kept so older settings code compiles; every theme now has a light and a dark side. */
export type LightPalette = ThemeId;
export type DarkPalette = ThemeId;
export type Density = 'comfortable' | 'compact';
export type ContentWidth = 'full' | 'wide' | 'centered';
export type MotionPref = 'smooth' | 'quick' | 'off';

export interface Appearance {
  mode: ThemePref;
  /** One theme, used in light and dark mode. */
  palette: ThemeId;
  transparency: TransparencyPref;
  density: Density;
  width: ContentWidth;
  /** 0 = automatic (bigger on large screens), otherwise a fixed scale like 1.1 */
  uiScale: number;
  motion: MotionPref;
}

export const PALETTES: { id: ThemeId; name: string; blurb: string; light: string[]; dark: string[] }[] = [
  { id: 'paper', name: 'Paper', blurb: 'Warm paper with amber ink', light: ['#e9e2d4', '#f6f1e6', '#8a5205', '#241b12'], dark: ['#131009', '#1d1811', '#e9a63f', '#f3e7d3'] },
  { id: 'graphite', name: 'Graphite', blurb: 'Neutral grey, slate blue', light: ['#e3e3e0', '#f3f3f0', '#2e5496', '#1b1d20'], dark: ['#111214', '#1a1b1e', '#8cace8', '#ececea'] },
  { id: 'sage', name: 'Sage', blurb: 'Soft green-grey', light: ['#e1e5da', '#f1f3ec', '#286442', '#1a231b'], dark: ['#0e120e', '#171c17', '#80c494', '#e6eee3'] },
  { id: 'terracotta', name: 'Terracotta', blurb: 'Clay and cream', light: ['#ebddd2', '#f8ede5', '#9a3e20', '#2a1810'], dark: ['#150d09', '#20150f', '#ea8c68', '#f4e4d8'] },
  { id: 'ledger', name: 'Ledger', blurb: 'Ink blue on grey paper', light: ['#e2e4df', '#f3f3ee', '#165476', '#142029'], dark: ['#0c1114', '#141b20', '#70b2d6', '#e3ecf1'] },
];

const DEFAULTS: Appearance = { mode: 'auto', palette: 'paper', transparency: 'auto', density: 'comfortable', width: 'full', uiScale: 0, motion: 'smooth' };
const KEY = 'aufwind.appearance';

function load(): Appearance {
  try {
    const raw = localStorage.getItem(KEY);
    const legacyMode = localStorage.getItem('aufwind.theme') as ThemePref | null;
    const legacyTr = localStorage.getItem('aufwind.transparency') as TransparencyPref | null;
    const a: Appearance = { ...DEFAULTS, ...(legacyMode ? { mode: legacyMode } : {}), ...(legacyTr ? { transparency: legacyTr } : {}), ...(raw ? JSON.parse(raw) : {}) };
    // Older theme choices → the closest new theme.
    const MAP: Record<string, ThemeId> = { latte: 'paper', dune: 'paper', aurora: 'graphite', paper: 'paper', glacier: 'sage', sage: 'sage', midnight: 'graphite', graphite: 'graphite', ember: 'terracotta', espresso: 'terracotta', updraft: 'ledger', ocean: 'ledger' };
    const legacy = a as Appearance & { light?: string; dark?: string };
    if (!PALETTES.some((p) => p.id === a.palette)) a.palette = MAP[(prefersDark() ? legacy.dark : legacy.light) ?? ''] ?? 'paper';
    return a;
  } catch { return DEFAULTS; }
}

interface ThemeCtx {
  appearance: Appearance;
  set: (patch: Partial<Appearance>) => void;
  resolved: 'light' | 'dark';
  /** Seconds for a standard transition at the chosen motion speed (0 when off). */
  dur: (base?: number) => number;
  // Back-compat shorthands
  theme: ThemePref; setTheme: (t: ThemePref) => void;
  transparency: TransparencyPref; setTransparency: (t: TransparencyPref) => void;
}
const Ctx = createContext<ThemeCtx | null>(null);

const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
async function logicalWidth(): Promise<number> {
  if (!isDesktop()) return window.innerWidth;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const w = getCurrentWindow();
    const [size, f] = await Promise.all([w.innerSize(), w.scaleFactor()]);
    return size.width / f;
  } catch { return window.innerWidth; }
}

const prefersDark = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
const prefersReduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [a, setA] = useState<Appearance>(load);
  const [sysDark, setSysDark] = useState(prefersDark());
  // Logical window width in the desktop app (independent of the webview zoom we set), else CSS px.
  const [vw, setVw] = useState(typeof window !== 'undefined' ? window.innerWidth : 1440);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSysDark(mq.matches);
    const onResize = () => void logicalWidth().then(setVw);
    onResize();
    mq.addEventListener('change', on); window.addEventListener('resize', onResize);
    return () => { mq.removeEventListener('change', on); window.removeEventListener('resize', onResize); };
  }, []);
  const resolved: 'light' | 'dark' = a.mode === 'auto' ? (sysDark ? 'dark' : 'light') : a.mode;
  const motion: MotionPref = prefersReduced() ? 'off' : a.motion;
  // Automatic UI size: a touch larger on big monitors (2K/4K), so text isn't tiny full-screen.
  const scale = a.uiScale || (vw >= 3000 ? 1.25 : vw >= 2300 ? 1.12 : vw >= 1900 ? 1.05 : 1);

  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute('data-theme', resolved);
    el.setAttribute('data-palette', a.palette);
    el.setAttribute('data-density', a.density);
    el.setAttribute('data-width', a.width);
    el.setAttribute('data-motion', motion);
    if (a.transparency !== 'auto') el.setAttribute('data-transparency', a.transparency); else el.removeAttribute('data-transparency');
    el.style.setProperty('--ui-scale', String(scale));
    // Size: native webview zoom in the desktop app (keeps charts, hit-testing and layout exact).
    // In a browser, Ctrl +/- already does this, so we leave it alone.
    if (isDesktop()) void import('@tauri-apps/api/webview').then(({ getCurrentWebview }) => getCurrentWebview().setZoom(scale)).catch(() => {});
    el.style.setProperty('--motion', motion === 'off' ? '0' : motion === 'quick' ? '0.55' : '1');
    try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* private mode */ }
  }, [a, resolved, motion, scale]);

  const value = useMemo<ThemeCtx>(() => ({
    appearance: a,
    set: (p) => setA((x) => ({ ...x, ...p })),
    resolved,
    dur: (base = 0.45) => (motion === 'off' ? 0 : motion === 'quick' ? base * 0.55 : base),
    theme: a.mode, setTheme: (mode) => setA((x) => ({ ...x, mode })),
    transparency: a.transparency, setTransparency: (transparency) => setA((x) => ({ ...x, transparency })),
  }), [a, resolved, motion]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTheme outside ThemeProvider');
  return c;
}

/** Resolve CSS custom properties (charts need concrete colors). Re-reads when the theme changes. */
export function useCssVar(names: string[]): string[] {
  const { resolved, appearance } = useTheme();
  const [vals, setVals] = useState<string[]>(() => names.map(() => '#888'));
  useEffect(() => {
    // Wait a frame so the new theme's variables are applied.
    const id = requestAnimationFrame(() => {
      const cs = getComputedStyle(document.documentElement);
      setVals(names.map((n) => cs.getPropertyValue(n).trim() || '#888'));
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved, appearance.palette, names.join()]);
  return vals;
}
