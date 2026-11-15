import { make, crc, rule } from './rule';
import type { Insight } from '../types';

/** R20 Year-end sinking funds: from October, marchamo and December goals vs what's set aside. */
export const R20 = rule({
  id: 'R20', name: 'Year-end funds', trigger: 'From October: marchamo and December expenses vs. their pot/goal balance',
  defaults: { fromMonth: 10, marchamo: 0, december: 0 }, labels: { fromMonth: 'Start in month', marchamo: 'Marchamo estimate (₡, céntimos)', december: 'December spending estimate (₡, céntimos)' },
  evaluate(ctx, p) {
    const m = Number(ctx.month.slice(5, 7));
    if (m < p.fromMonth) return [];
    const monthsLeft = Math.max(1, 12 - m + 1);
    const saved = (potId?: string, accountId?: string) => (potId ? [...ctx.balances.values()].reduce((s, b) => s + (b.pots.get(potId) ?? 0), 0) : accountId ? ctx.balances.get(accountId)?.total ?? 0 : 0);
    const items: { name: string; target: number; have: number }[] = ctx.goals.filter((g) => !g.archived && /marchamo|diciembre|december|navidad|christmas/i.test(g.name)).map((g) => ({ name: g.name, target: g.target, have: saved(g.potId, g.accountId) }));
    if (!items.some((i) => /marchamo/i.test(i.name)) && p.marchamo > 0) items.push({ name: 'Marchamo', target: p.marchamo, have: 0 });
    if (!items.some((i) => /diciembre|december|navidad|christmas/i.test(i.name)) && p.december > 0) items.push({ name: 'December', target: p.december, have: 0 });
    return items.filter((i) => i.have < i.target).map((i): Insight => {
      const per = Math.ceil((i.target - i.have) / monthsLeft / 100) * 100;
      return make({
        ruleId: 'R20', severity: 'heads_up', title: `${i.name}: ${crc(i.have)} of ${crc(i.target)} set aside`,
        body: ctx.say(`Set aside ${crc(per)}/month for the next ${monthsLeft} month${monthsLeft > 1 ? 's' : ''} to have it in time.`, `About ${crc(per)} a month gets you there before it's due.`),
        why: { formula: '(target − set aside) ÷ months until December', inputs: { target: crc(i.target), setAside: crc(i.have), monthsLeft }, threshold: `from month ${p.fromMonth}` },
        impactCRC: i.target - i.have, actWithinDays: 30, confidence: 0.9,
        action: { label: 'Open goals', kind: 'open', payload: { to: '/goals' } },
        dedupeKey: `R20:${i.name}:${ctx.month}`,
      });
    });
  },
});
