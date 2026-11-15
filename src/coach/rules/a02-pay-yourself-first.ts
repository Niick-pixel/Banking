import { diffDays } from '../context';
import { crc, ddmm, make, rule } from './rule';

/** A2 Pay yourself first (spec §10.5): right after a quincena, propose this quincena's savings before spending starts. */
export const A2 = rule({
  id: 'A2', name: 'Pay yourself first', trigger: 'Within 2 days after payday, while this quincena\'s planned savings aren\'t moved yet',
  defaults: { withinDays: 2 }, labels: { withinDays: 'Days after payday' },
  evaluate(ctx, p) {
    const since = diffDays(ctx.lastPayday, ctx.today);
    if (since < 0 || since > p.withinDays) return [];
    const lines = ctx.categories.filter((c) => c.group === 'Savings' && !c.archived && ctx.budget(c.id) > 0).map((c) => {
      const planned = ctx.budget(c.id) / 2;
      const done = ctx.past.filter((t) => t.kind === 'savings' && t.direction === 'deposit' && t.categoryId === c.id && t.date >= ctx.lastPayday).reduce((s, t) => s + (t.kind === 'savings' ? t.amount : 0), 0);
      const pot = /hers|her\b|ella/i.test(c.name) ? ctx.pots.find((x) => x.owner === 'hers') : ctx.pots.find((x) => x.owner === 'mine');
      return { c, left: Math.max(0, planned - done), pot };
    }).filter((x) => x.left > 0);
    return lines.map((x) => make({
      ruleId: 'A2', severity: 'heads_up', title: `Payday ${ddmm(ctx.lastPayday)}: move ${crc(x.left)} to ${x.c.name} first`,
      body: ctx.say('Savings first, spending after. One tap moves it.', 'Setting it aside now means you never have to find it later.'),
      why: { formula: 'planned per quincena = monthly budget ÷ 2, minus what you already moved since payday', inputs: { budget: crc(ctx.budget(x.c.id)), left: crc(x.left) }, threshold: `within ${p.withinDays} days after payday` },
      impactCRC: x.left, actWithinDays: 1, confidence: 0.9,
      action: { label: `Move ${crc(x.left)} now`, kind: 'move_money', payload: { amount: x.left, toPotId: x.pot?.id, toAccountId: x.pot?.accountId } },
      dedupeKey: `A2:${ctx.lastPayday}:${x.c.id}`,
    }));
  },
});
