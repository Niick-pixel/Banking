import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemePref = 'auto' | 'light' | 'dark';
export type TransparencyPref = 'auto' | 'reduced';

interface ThemeCtx {
  theme: ThemePref; setTheme: (t: ThemePref) => void;
  transparency: TransparencyPref; setTransparency: (t: TransparencyPref) => void;
}
const Ctx = createContext<ThemeCtx | null>(null);

function load<T extends string>(key: string, fallback: T): T {
  try { return (localStorage.getItem(key) as T | null) ?? fallback; } catch { return fallback; }
}
function save(key: string, v: string) { try { localStorage.setItem(key, v); } catch { /* private mode */ } }

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemePref>(() => load('colon.theme', 'auto'));
  const [transparency, setTransparency] = useState<TransparencyPref>(() => load('colon.transparency', 'auto'));
  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'auto') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', theme);
    save('colon.theme', theme);
  }, [theme]);
  useEffect(() => {
    const el = document.documentElement;
    if (transparency === 'reduced') el.setAttribute('data-transparency', 'reduced'); else el.removeAttribute('data-transparency');
    save('colon.transparency', transparency);
  }, [transparency]);
  return <Ctx.Provider value={{ theme, setTheme, transparency, setTransparency }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTheme outside ThemeProvider');
  return c;
}

/** Resolve a CSS custom property (charts need concrete colors). Re-reads on theme change. */
export function useCssVar(names: string[]): string[] {
  const { theme } = useTheme();
  const [vals, setVals] = useState<string[]>(() => names.map(() => '#888'));
  useEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.documentElement);
      setVals(names.map((n) => cs.getPropertyValue(n).trim() || '#888'));
    };
    read();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', read);
    return () => mq.removeEventListener('change', read);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, names.join()]);
  return vals;
}
