import { safeToSpend } from '../forecast';
import { crc, ddmm, make, rule } from './rule';

/** R6 Safe-to-spend negative: bills and savings until payday need more than you have. */
export const R6 = rule({
  id: 'R6', name: 'Safe-to-spend negative', trigger: 'Safe-to-spend < 0', defaults: {},
  evaluate(ctx) {
    const s = safeToSpend(ctx);
    if (!s.known) return [];
    if (s.value >= 0) return [];
    const z = s.belowZero[0];
    if (z) return [make({
      ruleId: 'R6', severity: 'warning', title: `${z.name} is below zero in the app (${crc(z.balance)})`,
      body: ctx.say(`A debit account can't go below zero, so the app's balance is off: it is ${z.asOf ? `your balance from ${ddmm(z.asOf)} plus everything logged after it` : 'the ledger total'}. Type what BAC shows today, or fix an entry that came out of this account by mistake. Safe-to-spend will be right after that.`,
        `The app has ${z.name} below zero, which can't be right. Type what BAC shows today and safe-to-spend will be right again.`),
      why: { formula: z.asOf ? 'last balance you entered + movements logged after it' : 'opening balance + every movement', inputs: { balance: crc(z.balance), ...(z.asOf ? { since: ddmm(z.asOf) } : {}) }, threshold: '< ₡0' },
      impactCRC: -z.balance, actWithinDays: 2, confidence: 0.9,
      action: { label: 'Enter balance', kind: 'update_balance', payload: { accountId: z.accountId } },
      dedupeKey: `R6:below:${z.accountId}:${z.asOf ?? ''}`,
    })];
    const flexible = ctx.categories.filter((c) => ['Living', 'Discretionary'].includes(c.group)).map((c) => ({ c, v: ctx.spent.get(c.id) ?? 0 })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 3);
    return [make({
      ruleId: 'R6', severity: 'critical', title: `You're ${crc(-s.value)} short until payday (${ddmm(s.until)})`,
      body: ctx.say(`Bills and savings due before payday plus your buffer need ${crc(s.bills + s.savings + s.buffer)}; you have ${crc(s.balance + s.income)}. Cut back on: ${flexible.map((x) => x.c.name).join(', ') || 'day-to-day spending'}.`,
        `Money is tight until ${ddmm(s.until)}. The easiest places to ease off are ${flexible.map((x) => x.c.name).join(', ') || 'day-to-day spending'}.`),
      why: { formula: 'spending balance + income before payday − bills − savings − buffer', inputs: { balance: crc(s.balance), income: crc(s.income), bills: crc(s.bills), savings: crc(s.savings), buffer: crc(s.buffer), safeToSpend: crc(s.value) }, threshold: '< ₡0' },
      impactCRC: -s.value, actWithinDays: Math.min(3, s.days), confidence: 0.85,
      action: { label: 'See the 3 flexible categories', kind: 'open', payload: { to: `/transactions?month=${ctx.month}&group=Living` } },
      dedupeKey: `R6:${s.until}`,
    })];
  },
});
