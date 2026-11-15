/**
 * Appearance (per device): light/dark mode, which of the 3 light and 3 dark themes,
 * transparency, density, content width, UI size and animation speed.
 * Everything is applied as attributes/variables on <html> so CSS does the work.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemePref = 'auto' | 'light' | 'dark';
export type TransparencyPref = 'auto' | 'reduced';
export type LightPalette = 'aurora' | 'dune' | 'glacier';
export type DarkPalette = 'midnight' | 'ember' | 'updraft';
export type Density = 'comfortable' | 'compact';
export type ContentWidth = 'full' | 'wide' | 'centered';
export type MotionPref = 'smooth' | 'quick' | 'off';

export interface Appearance {
  mode: ThemePref;
  light: LightPalette;
  dark: DarkPalette;
  transparency: TransparencyPref;
  density: Density;
  width: ContentWidth;
  /** 0 = automatic (bigger on large screens), otherwise a fixed scale like 1.1 */
  uiScale: number;
  motion: MotionPref;
}

export const PALETTES: { id: LightPalette | DarkPalette; mode: 'light' | 'dark'; name: string; blurb: string; swatch: string[] }[] = [
  { id: 'aurora', mode: 'light', name: 'Aurora', blurb: 'Cool sky blues and soft violet', swatch: ['#eef1f6', '#8fd3ff', '#b9a8ff', '#7fe3c9'] },
  { id: 'dune', mode: 'light', name: 'Dune', blurb: 'Warm sand, clay and peach', swatch: ['#f6efe5', '#f3c69b', '#e9b3c2', '#f1dfa3'] },
  { id: 'glacier', mode: 'light', name: 'Glacier', blurb: 'Crisp ice, teal and mint', swatch: ['#edf6f7', '#9fe1ee', '#b9d3ff', '#c9f1e2'] },
  { id: 'midnight', mode: 'dark', name: 'Midnight', blurb: 'Deep blue with violet light', swatch: ['#0b0d12', '#1d4ed8', '#6d28d9', '#0f766e'] },
  { id: 'ember', mode: 'dark', name: 'Ember', blurb: 'Charcoal with warm glowing coals', swatch: ['#110c0b', '#9a3412', '#9f1239', '#a16207'] },
  { id: 'updraft', mode: 'dark', name: 'Updraft', blurb: 'Night navy and gold, like the logo', swatch: ['#07111f', '#1e3a8a', '#0e7490', '#b45309'] },
];

const DEFAULTS: Appearance = { mode: 'auto', light: 'aurora', dark: 'midnight', transparency: 'auto', density: 'comfortable', width: 'full', uiScale: 0, motion: 'smooth' };
const KEY = 'aufwind.appearance';

function load(): Appearance {
  try {
    const raw = localStorage.getItem(KEY);
    const legacyMode = localStorage.getItem('aufwind.theme') as ThemePref | null;
    const legacyTr = localStorage.getItem('aufwind.transparency') as TransparencyPref | null;
    return { ...DEFAULTS, ...(legacyMode ? { mode: legacyMode } : {}), ...(legacyTr ? { transparency: legacyTr } : {}), ...(raw ? JSON.parse(raw) : {}) };
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
    el.setAttribute('data-palette', resolved === 'dark' ? a.dark : a.light);
    el.setAttribute('data-density', a.density);
    el.setAttribute('data-width', a.width);
    el.setAttribute('data-motion', motion);
    if (a.transparency === 'reduced') el.setAttribute('data-transparency', 'reduced'); else el.removeAttribute('data-transparency');
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
  }, [resolved, appearance.light, appearance.dark, names.join()]);
  return vals;
}
