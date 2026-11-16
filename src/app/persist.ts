/**
 * UI state that survives restarts, per device (localStorage): collapsed months, filters,
 * chart/table toggles, calculator inputs, last tab in each section… Data never goes here;
 * only how you like to see it. Every read/write tolerates storage being unavailable.
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

const PREFIX = 'aufwind.ui.';

export function readPersisted<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(PREFIX + key); return raw === null ? fallback : (JSON.parse(raw) as T); } catch { return fallback; }
}
export function writePersisted<T>(key: string, value: T) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* private mode / full */ }
}

/** useState that remembers its value under `key`. */
export function usePersisted<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [v, setV] = useState<T>(() => readPersisted(key, typeof initial === 'function' ? (initial as () => T)() : initial));
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } writePersisted(key, v); }, [key, v]);
  return [v, setV];
}

/** A remembered set of strings (e.g. collapsed months). */
export function usePersistedSet(key: string): [Set<string>, (id: string) => void, (s: Set<string>) => void] {
  const [arr, setArr] = usePersisted<string[]>(key, []);
  const set = new Set(arr);
  const toggle = useCallback((id: string) => setArr((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id])), [setArr]);
  const replace = useCallback((s: Set<string>) => setArr([...s]), [setArr]);
  return [set, toggle, replace];
}
