import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { PREF_DEFAULTS, type PrefKey } from '../domain/prefs';

/** Synced preference with a default. Returns [value, set]. */
export function usePref<K extends PrefKey>(key: K): [(typeof PREF_DEFAULTS)[K], (v: (typeof PREF_DEFAULTS)[K]) => Promise<void>] {
  const rec = useLiveQuery(() => db.prefs.get(key), [key]);
  const def = PREF_DEFAULTS[key];
  const value = (rec?.value === undefined ? def : typeof def === 'object' && !Array.isArray(def) ? { ...(def as object), ...(rec.value as object) } : rec.value) as (typeof PREF_DEFAULTS)[K];
  const set = async (v: (typeof PREF_DEFAULTS)[K]) => { await db.prefs.put({ id: key, value: v, updatedAt: Date.now() }); };
  return [value, set];
}
