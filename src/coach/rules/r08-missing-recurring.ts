import { occurrences, templateAmount } from '../../domain/recurring';
import { addDays, diffDays, occurrencePosted, shiftMonth, spendOf } from '../context';
import { median } from '../stats';
import { crc, ddmm, make, rule } from './rule';
import type { Insight } from '../types';

/**
 * R8 Missing recurring: an expected bill wasn't logged N days after its due date.
 * Expected = your recurring rules, plus fixed bills you paid in each of the last 3 months (e.g. rent).
 */
export const R8 = rule({
  id: 'R8', name: 'Missing recurring', trigger: 'An expected bill (e.g. rent) not logged N days after its due date',
  defaults: { graceDays: 5, lookbackDays: 45 }, labels: { graceDays: 'Days after due date', lookbackDays: 'Look back (days)' },
  evaluate(ctx, p) {
    const out: Insight[] = [];
    const covered = new Set<string>();
    const latestDue = addDays(ctx.today, -p.graceDays);
    for (const r of ctx.recurring) {
      const t = r.template as { kind: string; categoryId?: string };
      if (!r.active || r.informational || !['expense', 'debt_payment', 'transfer'].includes(t.kind)) continue;
      if (t.categoryId) covered.add(t.categoryId);
      const amount = templateAmount(r);
      for (const d of occurrences(r.schedule, r.startDate, addDays(ctx.today, -p.lookbackDays), latestDue)) {
        if ((r.skipped ?? []).includes(d) || occurrencePosted(ctx, r.id, d, t.categoryId, amount)) continue;
        out.push(make({
          ruleId: 'R8', severity: 'warning', title: `${r.name} (${crc(amount)}) isn't logged: due ${ddmm(d)}`,
          body: ctx.say(`${diffDays(d, ctx.today)} days past due. Did you pay it? Log it, or mark it skipped.`, `It was due on ${ddmm(d)}. If it's paid, logging it keeps your numbers right.`),
          why: { formula: 'recurring occurrence with no matching movement', inputs: { rule: r.name, due: d, amount: crc(amount) }, threshold: `${p.graceDays} days after the due date` },
          impactCRC: amount, actWithinDays: 1, confidence: 0.95,
          action: { label: 'Log it / mark as skipped', kind: 'open', payload: { to: '/bills', ruleId: r.id, date: d } },
          dedupeKey: `R8:${r.id}:${d}`,
        }));
      }
    }
    // Inferred: a Fixed bill paid in each of the last 3 complete months, missing this month after its usual day + grace.
    const last3 = [1, 2, 3].map((k) => shiftMonth(ctx.month, -k));
    for (const c of ctx.categories.filter((x) => x.group === 'Fixed' && !x.archived && !covered.has(x.id))) {
      const paid = last3.map((mk) => ctx.past.filter((t) => t.date.startsWith(mk) && spendOf(t)?.categoryId === c.id));
      if (paid.some((ts) => !ts.length)) continue;
      const amount = median(paid.map((ts) => ts.reduce((s, t) => s + (spendOf(t)?.amount ?? 0), 0)));
      if (amount < (ctx.budget(c.id) || amount) * 0.5) continue;
      const dated = paid.flat().filter((t) => !t.dateEstimated).map((t) => Number(t.date.slice(8, 10)));
      const dueDay = dated.length ? Math.round(median(dated)) : 1;
      const due = `${ctx.month}-${String(Math.min(dueDay, ctx.dim)).padStart(2, '0')}`;
      if (due > latestDue || ctx.monthTxs.some((t) => spendOf(t)?.categoryId === c.id)) continue;
      out.push(make({
        ruleId: 'R8', severity: 'warning', title: `${c.name} (${crc(amount)}) isn't logged this month`,
        body: ctx.say(`You paid it in each of the last 3 months${dated.length ? `, usually around day ${dueDay}` : ''}. Paid already? Log it. Not this month? Dismiss.`,
          `It shows up every month and hasn't been logged yet for this one. A quick log keeps everything accurate.`),
        why: { formula: 'Fixed bill present in each of the last 3 months and absent this month', inputs: { category: c.name, typical: crc(amount), usualDay: dated.length ? dueDay : 'unknown (undated rows, assumed day 1)' }, threshold: `${p.graceDays} days after the usual day` },
        impactCRC: amount, actWithinDays: 1, confidence: dated.length ? 0.9 : 0.75,
        action: { label: `Log ${c.name}`, kind: 'open', payload: { to: '/transactions', quickAdd: { categoryId: c.id, amount } } },
        dedupeKey: `R8:${c.id}:${ctx.month}`,
      }));
    }
    return out;
  },
});
