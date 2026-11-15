import { addDays } from '../context';
import { recurringEvents } from '../forecast';
import { crc, ddmm, make, rule } from './rule';

/** R19 Upcoming bills: a bill due within 3 days leaves you under your buffer. */
export const R19 = rule({
  id: 'R19', name: 'Upcoming bills', trigger: 'A bill due in ≤ 3 days leaves the balance under your buffer',
  defaults: { days: 3 }, labels: { days: 'Due within (days)' },
  evaluate(ctx, p) {
    if (ctx.unknownBalance.length) return [];
    const ev = recurringEvents(ctx, ctx.today, addDays(ctx.today, p.days));
    let bal = ctx.spendable;
    return ev.flatMap((e) => {
      bal += e.amount;
      if (e.kind !== 'bill' || bal >= ctx.prefs.buffer) return [];
      return [make({
        ruleId: 'R19', severity: 'heads_up', title: `${e.label} (${crc(-e.amount)}) due ${ddmm(e.date)}`,
        body: ctx.say(`After it you'd have ${crc(bal)}, under your ${crc(ctx.prefs.buffer)} buffer.`, `Once it's paid, your balance will be on the low side (${crc(bal)}).`),
        why: { formula: 'spending balance − bills due through that day', inputs: { balanceNow: crc(ctx.spendable), after: crc(bal), buffer: crc(ctx.prefs.buffer) }, threshold: `due within ${p.days} days and below buffer` },
        impactCRC: ctx.prefs.buffer - bal, actWithinDays: 1, confidence: 0.9,
        dedupeKey: `R19:${e.ruleId}:${e.date}`,
      })];
    });
  },
});
