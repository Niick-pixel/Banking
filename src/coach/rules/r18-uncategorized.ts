import { diffDays } from '../context';
import { make, rule } from './rule';

/** R18 Uncategorized backlog: > 5 expenses without a category, or any older than 7 days. */
export const R18 = rule({
  id: 'R18', name: 'Uncategorized backlog', trigger: '> 5 uncategorized items or any older than 7 days',
  defaults: { count: 5, days: 7 }, labels: { count: 'More than (items)', days: 'Or older than (days)' },
  evaluate(ctx, p) {
    const un = ctx.past.filter((t) => t.kind === 'expense' && !t.categoryId && !t.splits?.length);
    const old = un.filter((t) => diffDays(t.date, ctx.today) > p.days);
    if (un.length <= p.count && !old.length) return [];
    return [make({
      ruleId: 'R18', severity: 'info', title: `${un.length} expense${un.length > 1 ? 's' : ''} without a category`,
      body: ctx.say('Budgets and insights miss them until they have one. Takes a minute.', 'Giving them a category makes your budget numbers complete.'),
      why: { formula: 'expenses with no category and no split', inputs: { count: un.length, olderThan7Days: old.length }, threshold: `> ${p.count}, or any older than ${p.days} days` },
      impactCRC: un.reduce((s, t) => s + (t.kind === 'expense' ? t.amount : 0), 0), actWithinDays: 7, confidence: 1,
      action: { label: 'Categorize them', kind: 'recategorize', payload: { to: '/transactions?uncat=1' } },
      dedupeKey: `R18:${ctx.month}`,
    })];
  },
});
