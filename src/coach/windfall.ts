/**
 * Windfall splitter (spec §10.5): fill needs in your priority order; free money is capped
 * (default 15%), and anything left after every need is met goes to the emergency fund.
 */
import { debtStatus } from '../domain/ledger';
import { selfLoanProgress } from '../domain/debts';
import { shiftMonth, type Ctx } from './context';
import type { WindfallTarget } from './types';

export interface SplitLine { target: WindfallTarget; label: string; need: number; amount: number; potId?: string; accountId?: string; detail: string }

export function windfallNeeds(ctx: Ctx): Record<WindfallTarget, { need: number; label: string; detail: string; potId?: string; accountId?: string }> {
  const loans = selfLoanProgress(ctx.selfLoans, ctx.past, ctx.categories).filter((x) => !x.done);
  const replenish = loans.reduce((s, x) => s + x.remaining, 0);
  const hersPot = ctx.pots.find((p) => p.owner === 'hers');
  const hersBal = hersPot ? ctx.balances.get(hersPot.accountId)?.pots.get(hersPot.id) ?? 0 : 0;
  const owed = ctx.debts.filter((d) => d.kind === 'family' && d.status === 'active').reduce((s, d) => s + Math.max(0, debtStatus(d, ctx.past).balance), 0);
  const essentials = [1, 2, 3].map((k) => ctx.flows.get(shiftMonth(ctx.month, -k))).filter(Boolean)
    .map((f) => [...f!.byCategory].filter(([id]) => ['Fixed', 'Living'].includes(ctx.cat.get(id)?.group ?? '')).reduce((s, [, v]) => s + Math.max(0, v), 0));
  const monthly = essentials.length ? essentials.reduce((a, b) => a + b, 0) / essentials.length : 0;
  let liquid = 0;
  for (const a of ctx.accounts) {
    if (!a.isLiquid || a.type === 'credit_card' || a.currency !== 'CRC') continue;
    liquid += ctx.balances.get(a.id)?.total ?? 0;
  }
  liquid -= Math.max(0, hersBal);
  const emergency = Math.max(0, Math.round(ctx.efTargetMonths * monthly - liquid));
  const sinkingGoals = ctx.goals.filter((g) => !g.archived && /marchamo|diciembre|december|navidad|christmas|sinking/i.test(g.name));
  const goalSaved = (potId?: string, accountId?: string) => (potId ? [...ctx.balances.values()].reduce((s, b) => s + (b.pots.get(potId) ?? 0), 0) : accountId ? ctx.balances.get(accountId)?.total ?? 0 : 0);
  const sinking = sinkingGoals.reduce((s, g) => s + Math.max(0, g.target - goalSaved(g.potId, g.accountId)), 0);
  const mine = ctx.pots.find((p) => p.owner === 'mine');
  return {
    replenish: { need: replenish, label: 'Replenish self-loans', detail: loans.length ? `${loans.length} open: ${loans.map((x) => x.loan.description).join(', ')}` : 'none open', potId: mine?.id, accountId: mine?.accountId },
    hers: { need: Math.max(0, owed - hersBal), label: 'Her loan fund', detail: `owed ${owed / 100 | 0}, set aside ${hersBal / 100 | 0}`, potId: hersPot?.id, accountId: hersPot?.accountId },
    emergency: { need: emergency, label: 'Emergency fund', detail: `target ${ctx.efTargetMonths} months of ~${Math.round(monthly / 100)} essentials`, potId: mine?.id, accountId: mine?.accountId },
    sinking: { need: sinking, label: 'Year-end funds (marchamo, December)', detail: sinkingGoals.length ? sinkingGoals.map((g) => g.name).join(', ') : 'no marchamo/December goal yet' },
    free: { need: Infinity, label: 'Free money', detail: `at most ${Math.round(ctx.prefs.windfallFreeMaxPct * 100)}%` },
  };
}

export function splitWindfall(ctx: Ctx, amount: number): SplitLine[] {
  const needs = windfallNeeds(ctx);
  const freeCap = Math.round(amount * ctx.prefs.windfallFreeMaxPct);
  let left = amount;
  const lines: SplitLine[] = [];
  for (const t of ctx.prefs.windfallOrder) {
    const n = needs[t];
    const take = t === 'free' ? Math.min(left, freeCap) : Math.min(left, n.need);
    lines.push({ target: t, label: n.label, need: Number.isFinite(n.need) ? n.need : freeCap, amount: take, potId: n.potId, accountId: n.accountId, detail: n.detail });
    left -= take;
  }
  if (left > 0) { const e = lines.find((l) => l.target === 'emergency'); if (e) e.amount += left; else lines[0]!.amount += left; }
  return lines;
}
