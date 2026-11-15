/**
 * USD→CRC reference rates for a given day.
 *
 * Order (Settings → Exchange rates): BCCR official (needs a free token) → free market
 * rate (fawazahmed0 currency-api on jsDelivr) → whatever you type. Every result says
 * where it came from, and fetched rates are cached per day in `db.rates` (synced), so
 * a day is fetched once and works offline afterwards.
 *
 * Rates are integer CRC céntimos per 1 USD (₡503.25 → 50325), like the rest of the app.
 */
import type { ExchangeRate } from '../domain/schemas';
import type { FxPrefs } from '../domain/prefs';

export type RateSource = 'BCCR' | 'market' | 'manual';
export interface RateQuote {
  /** The day you asked for. */
  date: string;
  /** The day the rate is actually from (BCCR publishes no rate on some holidays; we step back). */
  rateDate: string;
  rate: number;
  source: RateSource;
  side: 'sell' | 'buy';
}

const toCentimos = (v: number) => Math.round(v * 100);
const ddmmyyyy = (iso: string) => iso.split('-').reverse().join('/');
const minusDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

/** Parse BCCR's ObtenerIndicadoresEconomicosXML response (the payload arrives as escaped XML). */
export function parseBccrXml(xml: string): { date: string; value: number }[] {
  const text = xml.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const out: { date: string; value: number }[] = [];
  const re = /<INGC011_CAT_INDICADORECONOMIC>([\s\S]*?)<\/INGC011_CAT_INDICADORECONOMIC>/g;
  for (const m of text.matchAll(re)) {
    const body = m[1]!;
    const d = /<DES_FECHA>(\d{4}-\d{2}-\d{2})/.exec(body)?.[1];
    const v = /<NUM_VALOR>([\d.,]+)<\/NUM_VALOR>/.exec(body)?.[1];
    if (d && v) out.push({ date: d, value: Number(v.replace(',', '.')) });
  }
  return out;
}

/** Parse the currency-api JSON ({ date, usd: { crc } }). */
export function parseMarketJson(json: unknown): { date: string; value: number } | null {
  const j = json as { date?: string; usd?: { crc?: number } };
  return j?.usd?.crc && j.date ? { date: j.date, value: j.usd.crc } : null;
}

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** In the desktop app, use Tauri's HTTP client (BCCR doesn't allow browser CORS); in the browser, fetch. */
async function defaultFetcher(): Promise<Fetcher> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { fetch: tfetch } = await import('@tauri-apps/plugin-http');
    return (url) => tfetch(url, { method: 'GET', connectTimeout: 8000 });
  }
  return (url) => fetch(url);
}

const BCCR_URL = 'https://gee.bccr.fi.cr/Indicadores/Suscripciones/WS/wsindicadoreseconomicos.asmx/ObtenerIndicadoresEconomicosXML';
export const BCCR_INDICATOR = { buy: 317, sell: 318 } as const;

/** BCCR for a 7-day window ending on `date`; returns the latest value on or before it. */
export async function fetchBccr(date: string, side: 'sell' | 'buy', p: Pick<FxPrefs, 'bccrName' | 'bccrEmail' | 'bccrToken'>, get: Fetcher): Promise<RateQuote | null> {
  if (!p.bccrToken || !p.bccrEmail) return null;
  const q = new URLSearchParams({
    Indicador: String(BCCR_INDICATOR[side]), FechaInicio: ddmmyyyy(minusDays(date, 7)), FechaFinal: ddmmyyyy(date),
    Nombre: p.bccrName || 'Aufwind', SubNiveles: 'N', CorreoElectronico: p.bccrEmail, Token: p.bccrToken,
  });
  const r = await get(`${BCCR_URL}?${q}`);
  if (!r.ok) throw new Error(`BCCR answered ${r.status}`);
  const rows = parseBccrXml(await r.text()).filter((x) => x.date <= date && x.value > 0).sort((a, b) => a.date.localeCompare(b.date));
  const last = rows.at(-1);
  return last ? { date, rateDate: last.date, rate: toCentimos(last.value), source: 'BCCR', side } : null;
}

/** Free market mid-rate for a day (falls back to the mirror host). Steps back up to 4 days. */
export async function fetchMarket(date: string, get: Fetcher, today: string): Promise<RateQuote | null> {
  for (let back = 0; back < 5; back++) {
    const d = minusDays(date, back);
    const tag = d >= today ? 'latest' : d;
    for (const url of [
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${tag}/v1/currencies/usd.min.json`,
      `https://${tag}.currency-api.pages.dev/v1/currencies/usd.min.json`,
    ]) {
      try {
        const r = await get(url);
        if (!r.ok) continue;
        const p = parseMarketJson(JSON.parse(await r.text()));
        if (p) return { date, rateDate: p.date, rate: toCentimos(p.value), source: 'market', side: 'sell' };
      } catch { /* try the next host / day */ }
    }
  }
  return null;
}

export interface RateStore {
  get(date: string): Promise<ExchangeRate | undefined>;
  put(r: ExchangeRate): Promise<void>;
}

/**
 * The rate to use for `date`. Cached BCCR rates win, then a fresh BCCR fetch, then a
 * cached/fresh market rate. Returns null when nothing is reachable: the caller asks you to type it.
 */
export async function usdRateFor(date: string, prefs: FxPrefs, store: RateStore, opts: { get?: Fetcher; today: string; now?: number }): Promise<RateQuote | null> {
  if (prefs.source === 'manual') return null;
  const side = prefs.side;
  const cached = await store.get(date);
  const fromCache = (c: ExchangeRate): RateQuote => ({ date, rateDate: date, rate: side === 'buy' ? c.buy : c.sell, source: c.source, side });
  if (cached && cached.source !== 'manual' && (cached.source === 'BCCR' || prefs.source === 'market')) return fromCache(cached);
  const get = opts.get ?? await defaultFetcher();
  const now = opts.now ?? Date.now();
  const save = async (q: RateQuote, buy: number, sell: number) => {
    // Today's market rate still moves, so only cache past days (and BCCR, which is fixed per day).
    if (q.source === 'market' && date >= opts.today) return;
    await store.put({ id: `rate-${date}`, date, buy, sell, source: q.source as 'BCCR' | 'market', createdAt: cached?.createdAt ?? now, updatedAt: now });
  };
  if (prefs.source !== 'market' && prefs.bccrToken) {
    try {
      const [sell, buy] = await Promise.all([fetchBccr(date, 'sell', prefs, get), fetchBccr(date, 'buy', prefs, get)]);
      const q = side === 'buy' ? buy : sell;
      if (q && sell && buy) { await save(q, buy.rate, sell.rate); return q; }
    } catch { /* fall through to market */ }
    if (prefs.source === 'bccr') return cached ? fromCache(cached) : null;
  }
  if (cached && cached.source === 'market') return fromCache(cached);
  const m = await fetchMarket(date, get, opts.today);
  if (m) { await save(m, m.rate, m.rate); return { ...m, side }; }
  return null;
}
