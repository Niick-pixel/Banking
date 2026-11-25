import { addDays, diffDays, spendOf, type Ctx } from '../context';
import { hoursOfWork } from '../forecast';
import { crc, make, rule } from './rule';
import type { Category, Transaction } from '../../domain/schemas';
import type { Insight } from '../types';

const ESSENTIAL = /grocer|supermerc|transport|medical|medic|health|salud|farmac|pharm|rent|alquiler|utilit|servicio/i;
const STOP = new Set('the and for with from stuff bought day run quick food last month extra payment more debt second few only what that will was need needed bunch dumb ahh this those these some lots another new old big small buying buy compra pago para con por los las del una uno que mas'.split(' '));
export const merchantTokens = (desc: string) => [...new Set(desc.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)))];

export const isNonEssential = (c?: Category) => !!c && (c.group === 'Discretionary' || c.discretionary || (c.group === 'Living' && !ESSENTIAL.test(c.name)));
const isDiscretionary = (c?: Category) => !!c && (c.group === 'Discretionary' || c.discretionary);

/** R4 Impulse cluster: ≥3 discretionary buys within 48 h, or the same store ≥3 times in 7 days. */
export const R4 = rule({
  id: 'R4', name: 'Impulse cluster', trigger: '≥ 3 discretionary buys within 48 h, or the same store/keyword ≥ 3 times in 7 days',
  defaults: { count: 3, hours: 48, keywordDays: 7 },
  labels: { count: 'Purchases', hours: 'Within (hours)', keywordDays: 'Same store within (days)' },
  evaluate(ctx, p) {
    const out: Insight[] = [];
    const from = addDays(ctx.today, -p.keywordDays);
    const recent = ctx.past.filter((t) => t.kind === 'expense' && t.date > from && !t.tags.includes('migrated-summary'));
    const catOf = (t: Transaction) => { const s = spendOf(t); return s?.categoryId ? ctx.cat.get(s.categoryId) : undefined; };
    const total = (ts: Transaction[]) => ts.reduce((s, t) => s + (spendOf(t)?.amount ?? 0), 0);
    const estimated = (ts: Transaction[]) => ts.some((t) => t.dateEstimated);

    // Same keyword (store) ≥ count in the window, among non-essential spending.
    const byToken = new Map<string, Transaction[]>();
    for (const t of recent) if (isNonEssential(catOf(t))) for (const w of merchantTokens(t.description)) byToken.set(w, [...(byToken.get(w) ?? []), t]);
    const flagged = new Set<string>();
    for (const [w, ts] of [...byToken].sort((a, b) => b[1].length - a[1].length)) {
      if (ts.length < p.count || ts.every((t) => flagged.has(t.id))) continue;
      ts.forEach((t) => flagged.add(t.id));
      const sum = total(ts), hours = hoursOfWork(ctx, sum);
      const store = w[0]!.toUpperCase() + w.slice(1);
      out.push(make({
        ruleId: 'R4', severity: 'warning',
        title: `${ts.length} ${store} purchases ${estimated(ts) ? 'this month' : `in ${p.keywordDays} days`}: ${crc(sum)}`,
        body: ctx.say(`${crc(sum)}${hours ? ` ≈ ${hours.toFixed(1)} hours of work` : ''}. Put the next one on your cooling-off list instead.`,
          `${ts.length} ${store} orders add up to ${crc(sum)}${hours ? `, about ${hours.toFixed(1)} hours of work` : ''}. A short wait before the next one might help.`),
        why: { formula: `count of non-essential purchases mentioning "${w}" in the last ${p.keywordDays} days`, inputs: { purchases: ts.map((t) => `${t.description} ${crc(spendOf(t)!.amount)}`).join('; '), total: crc(sum), datesEstimated: estimated(ts) ? 'yes (workbook rows without a day)' : 'no' }, threshold: `≥ ${p.count} in ${p.keywordDays} days` },
        impactCRC: sum, actWithinDays: 3, confidence: estimated(ts) ? 0.7 : 0.95,
        action: { label: `Turn on cooling-off for ${store}`, kind: 'cooling_off', payload: { store: w } },
        dedupeKey: `R4:${ctx.month}:kw:${w}`,
      }));
    }

    // ≥ count discretionary purchases in any `hours` window (needs real dates).
    const disc = recent.filter((t) => !t.dateEstimated && isDiscretionary(catOf(t)) && !flagged.has(t.id)).sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i + p.count - 1 < disc.length; i++) {
      const win = disc.filter((t) => t.date >= disc[i]!.date && diffDays(disc[i]!.date, t.date) * 24 < p.hours);
      if (win.length < p.count) continue;
      const sum = total(win);
      out.push(make({
        ruleId: 'R4', severity: 'warning', title: `${win.length} discretionary buys in ${p.hours} h: ${crc(sum)}`,
        body: ctx.say(`${win.map((t) => t.description || catOf(t)?.name).join(', ')}. That's a cluster. Pause the next one for ${p.hours} h.`, `A few treats close together (${crc(sum)}). Maybe give the next one a day or two.`),
        why: { formula: `discretionary purchases within ${p.hours} h`, inputs: { first: disc[i]!.date, count: win.length, total: crc(sum) }, threshold: `≥ ${p.count} within ${p.hours} h` },
        impactCRC: sum, actWithinDays: 2, confidence: 0.9,
        action: { label: 'Open cooling-off list', kind: 'open', payload: { to: '/coach#wants' } },
        dedupeKey: `R4:${disc[i]!.date}:cluster`,
      }));
      break;
    }
    return out;
  },
});
export type { Ctx };
