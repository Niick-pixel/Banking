import { describe, expect, it } from 'vitest';
import { fetchBccr, parseBccrXml, parseMarketJson, usdRateFor, type Fetcher } from './rates';
import type { ExchangeRate } from '../domain/schemas';
import { PREF_DEFAULTS } from '../domain/prefs';
import { convert, minor } from '../lib/money';

// Shape of a real BCCR ObtenerIndicadoresEconomicosXML answer (inner dataset arrives escaped).
const bccr = (rows: [string, string][]) => `<?xml version="1.0" encoding="utf-8"?>
<string xmlns="http://ws.sdde.bccr.fi.cr">&lt;Datos_de_INGC011_CAT_INDICADORECONOMIC&gt;${rows.map(([d, v]) =>
  `&lt;INGC011_CAT_INDICADORECONOMIC&gt;&lt;COD_INDICADORINTERNO&gt;318&lt;/COD_INDICADORINTERNO&gt;&lt;DES_FECHA&gt;${d}T00:00:00-06:00&lt;/DES_FECHA&gt;&lt;NUM_VALOR&gt;${v}&lt;/NUM_VALOR&gt;&lt;/INGC011_CAT_INDICADORECONOMIC&gt;`).join('')}&lt;/Datos_de_INGC011_CAT_INDICADORECONOMIC&gt;</string>`;

const res = (body: string, ok = true) => ({ ok, status: ok ? 200 : 404, text: async () => body });
const memStore = () => { const m = new Map<string, ExchangeRate>(); return { m, get: async (d: string) => m.get(`rate-${d}`), put: async (r: ExchangeRate) => { m.set(r.id, r); } }; };
const prefs = { ...PREF_DEFAULTS.fx, bccrEmail: 'x@example.com', bccrToken: 'TOKEN' };

describe('BCCR parsing', () => {
  it('reads dates and values from the escaped dataset', () => {
    expect(parseBccrXml(bccr([['2026-11-13', '506.43000000'], ['2026-11-14', '507.10']]))).toEqual([{ date: '2026-11-13', value: 506.43 }, { date: '2026-11-14', value: 507.1 }]);
  });
  it('picks the last published day on or before the date (weekends/holidays)', async () => {
    const get: Fetcher = async () => res(bccr([['2026-11-12', '505.00'], ['2026-11-13', '506.43']]));
    const q = await fetchBccr('2026-11-15', 'sell', prefs, get);
    expect(q).toMatchObject({ rate: 50643, rateDate: '2026-11-13', source: 'BCCR' });
  });
  it('asks the right indicator and dd/mm/yyyy dates', async () => {
    let url = '';
    await fetchBccr('2026-11-15', 'buy', prefs, async (u) => { url = u; return res(bccr([])); });
    expect(url).toContain('Indicador=317');
    expect(url).toContain('FechaFinal=15%2F11%2F2026');
  });
});

describe('market fallback', () => {
  it('parses currency-api json', () => {
    expect(parseMarketJson({ date: '2026-11-14', usd: { crc: 505.912 } })).toEqual({ date: '2026-11-14', value: 505.912 });
    expect(parseMarketJson({})).toBeNull();
  });
  it('is used when no BCCR token is set, and past days are cached', async () => {
    const s = memStore();
    let calls = 0;
    const get: Fetcher = async (u) => { calls++; return u.includes('2026-11-01') ? res(JSON.stringify({ date: '2026-11-01', usd: { crc: 510.5 } })) : res('', false); };
    const q = await usdRateFor('2026-11-01', PREF_DEFAULTS.fx, s, { get, today: '2026-11-15', now: 1 });
    expect(q).toMatchObject({ rate: 51050, source: 'market' });
    const again = await usdRateFor('2026-11-01', PREF_DEFAULTS.fx, s, { get, today: '2026-11-15', now: 2 });
    expect(again?.rate).toBe(51050);
    expect(calls).toBe(1);
  });
  it('falls back to market when BCCR fails, and to null when nothing answers', async () => {
    const s = memStore();
    const get: Fetcher = async (u) => u.includes('bccr') ? res('', false) : res(JSON.stringify({ date: '2026-11-10', usd: { crc: 500 } }));
    expect(await usdRateFor('2026-11-10', prefs, s, { get, today: '2026-11-15' })).toMatchObject({ source: 'market', rate: 50000 });
    expect(await usdRateFor('2026-11-09', { ...prefs, source: 'manual' }, s, { get, today: '2026-11-15' })).toBeNull();
    expect(await usdRateFor('2026-11-08', PREF_DEFAULTS.fx, memStore(), { get: async () => res('', false), today: '2026-11-15' })).toBeNull();
  });
  it('BCCR stores both sides and the chosen side converts exactly', async () => {
    const s = memStore();
    const get: Fetcher = async (u) => res(bccr([['2026-11-13', u.includes('Indicador=317') ? '500.10' : '506.43']]));
    const q = await usdRateFor('2026-11-13', prefs, s, { get, today: '2026-11-15' });
    expect(s.m.get('rate-2026-11-13')).toMatchObject({ buy: 50010, sell: 50643, source: 'BCCR' });
    expect(convert(minor(1999), 'USD', 'CRC', q!.rate)).toBe(1012354); // $19.99 × ₡506.43 = ₡10,123.54
  });
});
