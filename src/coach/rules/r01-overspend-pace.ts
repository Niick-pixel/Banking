import { VARIABLE_GROUPS } from '../context';
import { pace } from '../forecast';
import { crc, make, pct, rule } from './rule';
import type { Insight } from '../types';

/** R1 Overspend pace: projected spend ≥ 110% of budget for a day-to-day category (or the whole group), after day 5. */
export const R1 = rule({
  id: 'R1', name: 'Overspend pace', trigger: 'Projected month-end spend ≥ 110% of budget, after day 5',
  defaults: { warnRatio: 1.1, criticalRatio: 1.4, afterDay: 5 },
  labels: { warnRatio: 'Warn at (× budget)', criticalRatio: 'Critical at (× budget)', afterDay: 'Only after day' },
  evaluate(ctx, p) {
    if (ctx.day <= p.afterDay) return [];
    const out: Insight[] = [];
    const units: { key: string; name: string; ids: string[]; categoryId?: string }[] = [];
    for (const g of VARIABLE_GROUPS) {
      const cats = ctx.categories.filter((c) => c.group === g && !c.archived);
      units.push({ key: `group:${g}`, name: `${g} (all)`, ids: cats.map((c) => c.id) });
      for (const c of cats) units.push({ key: c.id, name: c.name, ids: [c.id], categoryId: c.id });
    }
    for (const u of units) {
      const budget = u.ids.reduce((s, id) => s + ctx.budget(id), 0);
      if (!budget) continue;
      const pc = pace(ctx, u.ids, budget);
      if (pc.ratio < p.warnRatio) continue;
      const over = pc.projected - budget;
      const left = Math.max(0, budget - pc.spent);
      const daysLeft = Math.max(1, ctx.daysLeft);
      const cap = Math.floor(left / daysLeft / 100) * 100;
      const done = ctx.day >= ctx.dim;
      out.push(make({
        ruleId: 'R1', severity: pc.ratio >= p.criticalRatio ? 'critical' : 'warning',
        title: done ? `${u.name} ended ${crc(pc.spent - budget)} over budget` : `${u.name} will end ${crc(over)} over budget`,
        body: done
          ? ctx.say(`Spent ${crc(pc.spent)} against ${crc(budget)} (${pct(pc.spent / budget)}).`, `This month came to ${crc(pc.spent)} against a ${crc(budget)} budget. Next month is a fresh start.`)
          : ctx.say(`${crc(pc.spent)} spent by day ${ctx.day}. At this pace: ${crc(pc.projected)} vs ${crc(budget)}. ${left ? `Keep it under ${crc(cap)}/day for the last ${daysLeft} days.` : 'The budget is already used up.'}`,
            `You've spent ${crc(pc.spent)} so far, which points to about ${crc(pc.projected)} by month end. If you can stay near ${crc(cap)} a day, you'll land on budget.`),
        why: { formula: 'projected = spent ÷ max(expected share by today, 0.15); ratio = projected ÷ budget',
          inputs: { spent: crc(pc.spent), budget: crc(budget), day: `${ctx.day} of ${ctx.dim}`, expectedShare: pct(pc.expectedShare), curve: pc.curve === 'history' ? 'your usual day-of-month pattern' : 'straight line (not enough dated history yet)', projected: crc(pc.projected), ratio: pc.ratio.toFixed(2) },
          threshold: `warning ≥ ${p.warnRatio}, critical ≥ ${p.criticalRatio}, after day ${p.afterDay}` },
        impactCRC: over, actWithinDays: Math.min(daysLeft, 14), confidence: Math.min(1, ctx.day / 10),
        action: u.categoryId && !done && left > 0 ? { label: `Set ${crc(cap)}/day limit for the rest of the month`, kind: 'set_limit', payload: { categoryId: u.categoryId, month: ctx.month, dailyCap: cap } }
          : { label: 'See these movements', kind: 'open', payload: { categoryId: u.categoryId, to: u.categoryId ? `/transactions?month=${ctx.month}&cat=${u.categoryId}` : `/transactions?month=${ctx.month}&group=${encodeURIComponent(u.name.replace(' (all)', ''))}` } },
        dedupeKey: `R1:${ctx.month}:${u.key}`, expiresAt: `${ctx.month}-${String(ctx.dim).padStart(2, '0')}`,
      }));
    }
    return out;
  },
});
