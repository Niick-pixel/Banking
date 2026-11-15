import { db } from '../db/db';
import { PREF_DEFAULTS, type FxPrefs } from '../domain/prefs';
import { usdRateFor, type RateQuote } from '../fx/rates';
import { todayISO } from '../lib/dates';

const store = {
  get: (date: string) => db.rates.get(`rate-${date}`),
  put: async (r: Parameters<typeof db.rates.put>[0]) => { await db.rates.put(r); },
};

export async function currentFxPrefs(): Promise<FxPrefs> {
  const row = await db.prefs.get('fx');
  return { ...PREF_DEFAULTS.fx, ...((row?.value as Partial<FxPrefs>) ?? {}) };
}

/** USD→CRC rate for a day, using your Settings → Exchange rates choices. */
export async function rateForDay(date: string, prefs?: FxPrefs): Promise<RateQuote | null> {
  return usdRateFor(date, prefs ?? await currentFxPrefs(), store, { today: todayISO() });
}
