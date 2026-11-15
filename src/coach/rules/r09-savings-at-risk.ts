import { diffDays } from '../context';
import { safeToSpend } from '../forecast';
import { crc, ddmm, make, rule } from './rule';

/** R9 Savings commitment at risk: 3 days before payday, money left can't cover this quincena's planned savings. */
export const R9 = rule({
  id: 'R9', name: 'Savings commitment at risk', trigger: '3 days before payday, projected free cash < planned savings for the quincena',
  defaults: { daysBefore: 3 }, labels: { daysBefore: 'Days before payday' },
  evaluate(ctx, p) {
    if (diffDays(ctx.today, ctx.nextPayday) > p.daysBefore) return [];
    const savingsCats = ctx.categories.filter((c) => c.group === 'Savings' && !c.archived);
    const planned = savingsCats.reduce((s, c) => s + ctx.budget(c.id), 0) / 2;
    if (!planned) return [];
    const savedThisQuincena = ctx.past.filter((t) => t.kind === 'savings' && t.date > ctx.lastPayday && t.date <= ctx.today && t.direction === 'deposit').reduce((s, t) => s + (t.kind === 'savings' ? t.amount : 0), 0);
    const gap = planned - savedThisQuincena;
    if (gap <= 0) return [];
    const s = safeToSpend(ctx);
    if (!s.known) return [];
    const free = s.value + s.buffer;
    if (free >= gap) return [];
    const target = ctx.pots.find((x) => x.owner === 'mine');
    return [make({
      ruleId: 'R9', severity: 'warning', title: `This quincena's savings are short ${crc(gap)}`,
      body: ctx.say(`Planned ${crc(planned)}, saved ${crc(savedThisQuincena)}. Only ${crc(Math.max(0, free))} is free before ${ddmm(ctx.nextPayday)}. Save first: move ${crc(Math.min(gap, Math.max(0, free)))} now.`,
        `You planned ${crc(planned)} for this quincena. Moving what you can now protects it from everyday spending.`),
      why: { formula: 'planned = Savings budgets ÷ 2; at risk when free cash before payday < planned − saved', inputs: { planned: crc(planned), saved: crc(savedThisQuincena), freeBeforePayday: crc(free), payday: ctx.nextPayday }, threshold: `${p.daysBefore} days before payday` },
      impactCRC: gap, actWithinDays: diffDays(ctx.today, ctx.nextPayday), confidence: 0.85,
      action: { label: `Save first: move ${crc(Math.min(gap, Math.max(0, free)) || gap)}`, kind: 'move_money', payload: { amount: Math.min(gap, Math.max(0, free)) || gap, toPotId: target?.id, toAccountId: target?.accountId, kind: 'savings' } },
      dedupeKey: `R9:${ctx.nextPayday}`,
    })];
  },
});
