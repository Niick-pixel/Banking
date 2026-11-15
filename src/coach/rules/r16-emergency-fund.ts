import { accountBalances } from '../../domain/ledger';
import { shiftMonth, type Ctx } from '../context';
import { crc, make, rule } from './rule';
import { lastDayOfMonth } from '../../lib/dates';

function coverage(ctx: Ctx, asOf: string, essentials: number) {
  const bal = accountBalances(ctx.accounts, ctx.transactions, asOf);
  let liquid = 0;
  for (const a of ctx.accounts) if (a.isLiquid && a.type !== 'credit_card' && a.currency === 'CRC') liquid += bal.get(a.id)?.total ?? 0;
  for (const p of ctx.pots) if (p.owner === 'hers') liquid -= Math.max(0, bal.get(p.accountId)?.pots.get(p.id) ?? 0);
  return { liquid, months: essentials ? liquid / essentials : 0 };
}

/** R16 Emergency fund: liquid months of essentials below target, or lower than last month. */
export const R16 = rule({
  id: 'R16', name: 'Emergency fund coverage', trigger: 'Liquid coverage below target or below last month',
  defaults: { topUpMonths: 12 }, labels: { topUpMonths: 'Reach target within (months)' },
  evaluate(ctx, p) {
    const ms = [1, 2, 3].map((k) => shiftMonth(ctx.month, -k)).filter((mk) => ctx.flows.has(mk));
    if (!ms.length) return [];
    const essentials = ms.reduce((s, mk) => s + [...ctx.flows.get(mk)!.byCategory].filter(([id]) => ['Fixed', 'Living'].includes(ctx.cat.get(id)?.group ?? '')).reduce((a, [, v]) => a + Math.max(0, v), 0), 0) / ms.length;
    if (!essentials) return [];
    const now = coverage(ctx, ctx.today, essentials);
    const pm = shiftMonth(ctx.month, -1);
    const before = coverage(ctx, lastDayOfMonth(Number(pm.slice(0, 4)), Number(pm.slice(5, 7))), essentials);
    const below = now.months < ctx.efTargetMonths, dropped = now.months < before.months - 0.05;
    if (!below && !dropped) return [];
    const gap = Math.max(0, ctx.efTargetMonths * essentials - now.liquid);
    const topUp = Math.ceil(gap / p.topUpMonths / 100) * 100;
    return [make({
      ruleId: 'R16', severity: 'heads_up', title: `Emergency fund: ${now.months.toFixed(1)} of ${ctx.efTargetMonths} months${dropped ? `, down from ${before.months.toFixed(1)}` : ''}`,
      body: ctx.say(`${crc(now.liquid)} liquid vs ${crc(essentials)}/month of essentials. ${gap ? `${crc(topUp)}/month gets you to ${ctx.efTargetMonths} months in ${p.topUpMonths} months.` : ''}`,
        `Your cushion covers about ${now.months.toFixed(1)} months. ${gap ? `Around ${crc(topUp)} a month would build it up steadily.` : ''}`),
      why: { formula: 'liquid money (minus her fund) ÷ average monthly Fixed + Living', inputs: { liquid: crc(now.liquid), essentials: crc(essentials), months: now.months.toFixed(2), lastMonth: before.months.toFixed(2) }, threshold: `below ${ctx.efTargetMonths} months, or lower than last month` },
      impactCRC: gap, actWithinDays: 30, confidence: 0.8,
      action: { label: `Plan ${crc(topUp)}/month`, kind: 'open', payload: { to: '/goals' } },
      dedupeKey: `R16:${ctx.month}`,
    })];
  },
});
