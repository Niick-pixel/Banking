import { possibleDuplicates } from '../../domain/health';
import { addDays } from '../context';
import { crc, ddmm, make, rule } from './rule';

/** R17 Duplicate suspect: same amount, ±1 day, similar description. */
export const R17 = rule({
  id: 'R17', name: 'Duplicate suspect', trigger: 'Same amount ±1 day with a similar description',
  defaults: { lookbackDays: 30 }, labels: { lookbackDays: 'Look back (days)' },
  evaluate(ctx, p) {
    const from = addDays(ctx.today, -p.lookbackDays);
    return possibleDuplicates(ctx.past.filter((t) => t.date > from)).map(([a, b]) => make({
      ruleId: 'R17', severity: 'heads_up', title: `Possible duplicate: ${a.description || a.kind} ${'amount' in a ? crc(a.amount) : ''}`,
      body: ctx.say(`Logged ${ddmm(a.date)} and ${ddmm(b.date)}. Merge if it's the same purchase.`, `Two very similar entries on ${ddmm(a.date)} and ${ddmm(b.date)}. Keep both if they're real.`),
      why: { formula: 'same kind, account and amount, within 1 day, similar description', inputs: { first: `${a.date} ${a.description}`, second: `${b.date} ${b.description}` }, threshold: '±1 day' },
      impactCRC: 'amount' in a ? a.amount : 0, actWithinDays: 7, confidence: 0.7,
      action: { label: 'Review: merge or keep both', kind: 'open', payload: { to: `/transactions?date=${a.date}`, ids: [a.id, b.id] } },
      dedupeKey: `R17:${[a.id, b.id].sort().join(':')}`,
    }));
  },
});
