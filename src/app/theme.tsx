/**
 * Appearance (per device): light/dark mode, which of the 3 light and 3 dark themes,
 * transparency, density, content width, UI size and animation speed.
 * Everything is applied as attributes/variables on <html> so CSS does the work.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemePref = 'auto' | 'light' | 'dark';
export type TransparencyPref = 'auto' | 'reduced';
export type LightPalette = 'latte' | 'paper' | 'sage';
export type DarkPalette = 'graphite' | 'espresso' | 'ocean';
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
  { id: 'latte', mode: 'light', name: 'Latte', blurb: 'Light brown: cream, sand and coffee', swatch: ['#eadccb', '#d9b99a', '#f1e2cf', '#8b5a36'] },
  { id: 'paper', mode: 'light', name: 'Paper', blurb: 'Crisp white with slate blue', swatch: ['#edf0f4', '#dde5f0', '#ffffff', '#3a5a8c'] },
  { id: 'sage', mode: 'light', name: 'Sage', blurb: 'Soft green-grey, calm and natural', swatch: ['#e3eae2', '#c6dac8', '#f1f4ea', '#2e6a4e'] },
  { id: 'graphite', mode: 'dark', name: 'Graphite', blurb: 'Neutral charcoal with a cool blue accent', swatch: ['#121316', '#2b2f38', '#323745', '#8ab4ff'] },
  { id: 'espresso', mode: 'dark', name: 'Espresso', blurb: 'Dark roast brown with caramel', swatch: ['#16100c', '#3b2718', '#4a3020', '#dba56c'] },
  { id: 'ocean', mode: 'dark', name: 'Ocean', blurb: 'Deep teal night with aqua', swatch: ['#0a1417', '#0f3a40', '#12494a', '#4fd1c5'] },
];

const DEFAULTS: Appearance = { mode: 'auto', light: 'latte', dark: 'graphite', transparency: 'auto', density: 'comfortable', width: 'full', uiScale: 0, motion: 'smooth' };
const KEY = 'aufwind.appearance';

function load(): Appearance {
  try {
    const raw = localStorage.getItem(KEY);
    const legacyMode = localStorage.getItem('aufwind.theme') as ThemePref | null;
    const legacyTr = localStorage.getItem('aufwind.transparency') as TransparencyPref | null;
    const a: Appearance = { ...DEFAULTS, ...(legacyMode ? { mode: legacyMode } : {}), ...(legacyTr ? { transparency: legacyTr } : {}), ...(raw ? JSON.parse(raw) : {}) };
    // v0.4 theme ids → their v0.5 counterparts.
    const MAP: Record<string, LightPalette | DarkPalette> = { aurora: 'paper', dune: 'latte', glacier: 'sage', midnight: 'graphite', ember: 'espresso', updraft: 'ocean' };
    if (MAP[a.light]) a.light = MAP[a.light] as LightPalette;
    if (MAP[a.dark]) a.dark = MAP[a.dark] as DarkPalette;
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
