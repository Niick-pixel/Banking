import { shiftMonth, spendOf } from '../context';
import { crc, make, pct, rule } from './rule';
import type { Insight } from '../types';

const key = (d: string) => d.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]+/g, ' ').trim().split(/\s+/).slice(0, 2).join(' ');

/** R13 Subscription detector: same description, similar amount (±5%) in consecutive months; price rises > 5%. */
export const R13 = rule({
  id: 'R13', name: 'Subscriptions', trigger: 'Same description ±5% in 2+ consecutive months (propose as recurring); price up > 5%',
  defaults: { tolerance: 0.05, rise: 0.05 }, labels: { tolerance: 'Same price within', rise: 'Flag a rise above' },
  evaluate(ctx, p) {
    const out: Insight[] = [];
    const months = [ctx.month, shiftMonth(ctx.month, -1), shiftMonth(ctx.month, -2)];
    const by = new Map<string, Map<string, number>>(); // key → month → amount
    const names = new Map<string, string>();
    for (const t of ctx.past) {
      const s = spendOf(t);
      if (!s || t.kind !== 'expense' || !t.description || t.tags.includes('migrated-summary')) continue;
      const mk = t.date.slice(0, 7);
      if (!months.includes(mk)) continue;
      const k = key(t.description);
      if (k.length < 2) continue;
      const m = by.get(k) ?? new Map<string, number>();
      if (m.has(mk)) { m.set(mk, -1); } else m.set(mk, s.amount); // two in one month → not a subscription
      by.set(k, m); names.set(k, t.description);
    }
    const known = ctx.recurring.map((r) => key(r.name));
    for (const [k, m] of by) {
      const cur = m.get(months[0]!) ?? m.get(months[1]!), prevMonth = m.has(months[0]!) ? months[1]! : months[2]!;
      const prev = m.get(prevMonth);
      if (!cur || !prev || cur < 0 || prev < 0) continue;
      const change = (cur - prev) / prev;
      if (Math.abs(change) <= p.tolerance && !known.includes(k)) {
        out.push(make({
          ruleId: 'R13', severity: 'info', title: `${names.get(k)} looks like a subscription (${crc(cur)}/month)`,
          body: ctx.say('Track it as recurring so it shows in your bills and the forecast. Not needed any more? Cancel it.', 'Adding it as a recurring bill means you never have to log it by hand.'),
          why: { formula: 'same description, amount within ±5%, consecutive months', inputs: { [prevMonth]: crc(prev), latest: crc(cur) }, threshold: `±${pct(p.tolerance)}` },
          impactCRC: cur * 12, actWithinDays: 30, confidence: 0.7,
          action: { label: 'Add as recurring', kind: 'open', payload: { to: '/bills', name: names.get(k), amount: cur } },
          dedupeKey: `R13:sub:${k}`,
        }));
      } else if (change > p.rise && change < 1) {
        out.push(make({
          ruleId: 'R13', severity: 'heads_up', title: `${names.get(k)} went up ${pct(change)}: ${crc(prev)} → ${crc(cur)}`,
          body: ctx.say(`That's ${crc((cur - prev) * 12)} more a year. Still worth it?`, `A small price rise, ${crc((cur - prev) * 12)} a year. Worth a look.`),
          why: { formula: '(this month − last month) ÷ last month', inputs: { before: crc(prev), now: crc(cur) }, threshold: `> ${pct(p.rise)}` },
          impactCRC: (cur - prev) * 12, actWithinDays: 30, confidence: 0.7,
          action: { label: 'See it', kind: 'open', payload: { to: `/transactions?month=${ctx.month}` } },
          dedupeKey: `R13:rise:${k}:${ctx.month}`,
        }));
      }
    }
    return out;
  },
});
