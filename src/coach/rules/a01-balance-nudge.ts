import { diffDays } from '../context';
import { make, rule } from './rule';

/** A1 Bank-balance nudge (spec §10.5): enter your BAC balance weekly so safe-to-spend and the forecast are real. */
export const A1 = rule({
  id: 'A1', name: 'Bank-balance nudge', trigger: 'No balance entered for a spending account in 7 days (or ever)',
  defaults: { everyDays: 7 }, labels: { everyDays: 'Ask every (days)' },
  evaluate(ctx, p) {
    const accounts = ctx.accounts.filter((a) => !a.archived && a.currency === 'CRC' && ['checking', 'cash'].includes(a.type) && ctx.past.some((t) => 'from' in t && t.from.accountId === a.id));
    return accounts.flatMap((a) => {
      const last = (ctx.snapshots ?? []).filter((s) => s.accountId === a.id && s.date <= ctx.today).map((s) => s.date).sort().at(-1);
      if (last && diffDays(last, ctx.today) < p.everyDays) return [];
      const never = !last;
      return [make({
        ruleId: 'A1', severity: never ? 'heads_up' : 'info',
        title: never ? `What's in ${a.name} today?` : `Update ${a.name}'s balance`,
        body: never ? ctx.say("Safe-to-spend and the forecast need your real balance. Your workbook never had it. Type what the BAC app shows; it takes 10 seconds.", "Enter the balance the BAC app shows and the Coach can tell you what's safe to spend each day.")
          : ctx.say(`Last entered ${diffDays(last!, ctx.today)} days ago. Re-enter it so the numbers stay true.`, `It's been ${diffDays(last!, ctx.today)} days; a quick update keeps safe-to-spend accurate.`),
        why: { formula: 'days since the last balance you entered for this account', inputs: { account: a.name, lastEntered: last ?? 'never' }, threshold: `every ${p.everyDays} days` },
        impactCRC: 0, actWithinDays: never ? 1 : 3, confidence: 1,
        action: { label: 'Enter balance', kind: 'update_balance', payload: { accountId: a.id } },
        dedupeKey: `A1:${a.id}:${ctx.today.slice(0, 7)}-${Math.floor(Number(ctx.today.slice(8, 10)) / p.everyDays)}`,
      })];
    });
  },
});
