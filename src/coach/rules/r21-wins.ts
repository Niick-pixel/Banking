import { debtStatus } from '../../domain/ledger';
import { addDays, shiftMonth, SPEND_GROUPS } from '../context';
import { crc, make, pct, rule } from './rule';
import type { Insight } from '../types';

/** R21 Wins: factual, no confetti. */
export const R21 = rule({
  id: 'R21', name: 'Wins', trigger: 'Under budget 3 months straight; savings target hit; a debt paid off; a cooling-off item skipped',
  defaults: { streak: 3 }, labels: { streak: 'Months under budget' },
  evaluate(ctx, p) {
    const out: Insight[] = [];
    const ms = Array.from({ length: p.streak }, (_, k) => shiftMonth(ctx.month, -(k + 1)));
    if (ms.every((mk) => ctx.flows.has(mk))) {
      const good = ctx.categories.filter((c) => (SPEND_GROUPS as readonly string[]).includes(c.group) && ms.every((mk) => { const b = ctx.budget(c.id, mk); const s = ctx.flows.get(mk)!.byCategory.get(c.id) ?? 0; return b > 0 && s > 0 && s <= b; }));
      if (good.length) out.push(make({ ruleId: 'R21', severity: 'win', title: `Under budget ${p.streak} months straight: ${good.map((c) => c.name).join(', ')}`, body: 'Consistent, and it adds up.', why: { formula: 'spent ≤ budget in each month', inputs: { months: ms.join(', ') }, threshold: `${p.streak} months` }, impactCRC: 0, actWithinDays: 30, confidence: 1, dedupeKey: `R21:streak:${ctx.month}` }));
    }
    const lm = ctx.flows.get(shiftMonth(ctx.month, -1));
    if (lm?.income && lm.saved / lm.income >= ctx.savingsRateTarget) out.push(make({ ruleId: 'R21', severity: 'win', title: `Saved ${pct(lm.saved / lm.income)} last month (target ${pct(ctx.savingsRateTarget)})`, body: `${crc(lm.saved)} saved.`, why: { formula: 'saved ÷ income', inputs: { saved: crc(lm.saved), income: crc(lm.income) }, threshold: `≥ ${pct(ctx.savingsRateTarget)}` }, impactCRC: 0, actWithinDays: 30, confidence: 1, dedupeKey: `R21:rate:${lm.month}` }));
    const from = addDays(ctx.today, -30);
    for (const d of ctx.debts) {
      const last = ctx.past.filter((t) => t.kind === 'debt_payment' && t.debtId === d.id).map((t) => t.date).sort().at(-1);
      if (last && last > from && (d.status === 'paid' || debtStatus(d, ctx.past).balance <= 0)) out.push(make({ ruleId: 'R21', severity: 'win', title: `${d.creditor} is paid off`, body: `${crc(d.originalAmount)} cleared.`, why: { formula: 'balance = original − payments', inputs: { lastPayment: last }, threshold: 'balance ≤ 0' }, impactCRC: 0, actWithinDays: 30, confidence: 1, dedupeKey: `R21:debt:${d.id}` }));
    }
    const skipped = ctx.state.wants.filter((w) => w.status === 'dropped' && (w.decidedAt ?? '') > from);
    if (skipped.length) out.push(make({ ruleId: 'R21', severity: 'win', title: `Skipped ${skipped.length} cooling-off item${skipped.length > 1 ? 's' : ''}: ${crc(skipped.reduce((s, w) => s + w.amount, 0))} not wasted`, body: `Money not wasted so far: ${crc(ctx.state.moneyNotWasted)}.`, why: { formula: 'cooling-off items you dropped in the last 30 days', inputs: { items: skipped.map((w) => w.name).join(', ') }, threshold: 'any' }, impactCRC: 0, actWithinDays: 30, confidence: 1, dedupeKey: `R21:wants:${ctx.month}` }));
    return out;
  },
});
