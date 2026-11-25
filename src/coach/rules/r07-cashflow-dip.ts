import { forecast } from '../forecast';
import { crc, ddmm, make, rule } from './rule';

/** R7 Cash-flow dip: the forecast balance falls below your buffer within 30 days. */
export const R7 = rule({
  id: 'R7', name: 'Cash-flow dip', trigger: 'Forecast balance < buffer on any day in the next 30',
  defaults: { horizonDays: 30 }, labels: { horizonDays: 'Look ahead (days)' },
  evaluate(ctx, p) {
    if (ctx.unknownBalance.length) return [];
    const f = forecast(ctx, p.horizonDays);
    const d = f.firstBelowBuffer;
    if (!d) return [];
    const cause = [...f.days.filter((x) => x.date <= d.date).flatMap((x) => x.events)].filter((e) => e.amount < 0).sort((a, b) => a.amount - b.amount)[0];
    return [make({
      ruleId: 'R7', severity: 'warning', title: `Balance drops below your buffer on ${ddmm(d.date)}`,
      body: ctx.say(`Forecast: ${crc(d.balance)} that day${cause ? `, after ${cause.label} (${crc(-cause.amount)} on ${ddmm(cause.date)})` : ''}. Day-to-day spend assumed: ${crc(f.dailyVariable)}/day.`,
        `If things go as usual, the account gets low around ${ddmm(d.date)}${cause ? ` once ${cause.label} goes out` : ''}.`),
      why: { formula: 'spending balance + scheduled income − scheduled bills/savings − typical daily spend, day by day', inputs: { today: crc(ctx.spendable), dailySpend: crc(f.dailyVariable), lowestDay: f.min.date, lowest: crc(f.min.balance), buffer: crc(ctx.prefs.buffer) }, threshold: `below ${crc(ctx.prefs.buffer)} within ${p.horizonDays} days` },
      impactCRC: ctx.prefs.buffer - d.balance, actWithinDays: Math.max(0, Math.round((Date.parse(d.date) - Date.parse(ctx.today)) / 86_400_000)), confidence: 0.7,
      action: { label: 'See the forecast', kind: 'open', payload: { to: '/coach#forecast' } },
      dedupeKey: `R7:${d.date.slice(0, 7)}`,
    })];
  },
});
