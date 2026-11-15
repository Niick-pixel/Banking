/**
 * Spec §10.2: baselines → forecast → rules → scorer → dispatcher.
 * Pure: give it the ledger and your coach settings/state, get ranked insights back.
 */
import { buildContext, type Ctx } from './context';
import { dispatch, type Dispatch } from './dispatch';
import { forecast, safeToSpend, type Forecast, type SafeToSpend } from './forecast';
import { RULES } from './rules';
import { projectedPayoff } from './rules/r11-payoff-slipping';
import { score } from './score';
import type { CoachInput, CoachState, Insight } from './types';

export interface CoachRun {
  ctx: Ctx;
  insights: Insight[];
  safe: SafeToSpend;
  forecast: Forecast;
  dispatch: Dispatch;
  /** State changes to persist (payoff projections for R11). */
  statePatch: Partial<CoachState>;
  errors: { ruleId: string; message: string }[];
}

export function evaluateRules(ctx: Ctx): { insights: Insight[]; errors: CoachRun['errors'] } {
  const errors: CoachRun['errors'] = [];
  let all: Insight[] = [];
  for (const r of RULES) {
    const p = ctx.param(r.id, r.defaults);
    if (!p.on) continue;
    try { all.push(...r.evaluate(ctx, p)); } catch (e) { errors.push({ ruleId: r.id, message: e instanceof Error ? e.message : String(e) }); }
  }
  // Few, sharp alerts: a pace alert supersedes the plain threshold for the same category.
  const paced = new Set(all.filter((i) => i.ruleId === 'R1').map((i) => (i.action?.payload as { categoryId?: string } | undefined)?.categoryId).filter(Boolean));
  all = all.filter((i) => !(i.ruleId === 'R2' && paced.has((i.action?.payload as { categoryId?: string }).categoryId)));
  // A group-level pace alert makes its category alerts redundant unless they're critical on their own.
  return { insights: all, errors };
}

export function runCoach(input: CoachInput, now = { iso: new Date().toISOString(), hour: new Date().getHours() }): CoachRun {
  const ctx = buildContext(input);
  const { insights, errors } = evaluateRules(ctx);
  for (const i of insights) i.priority = score(i, ctx.avgMonthlyIncome, input.state);
  insights.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const payoff: CoachState['payoff'] = { ...input.state.payoff };
  for (const d of input.debts.filter((x) => x.status === 'active')) {
    const prev = payoff[d.id];
    const p = projectedPayoff(ctx, d);
    if (p.date && (!prev || prev.month < ctx.month)) payoff[d.id] = { month: ctx.month, date: p.date };
  }
  return {
    ctx, insights, errors,
    safe: safeToSpend(ctx),
    forecast: forecast(ctx, 60),
    dispatch: dispatch(insights, input.prefs, input.state, { date: input.today, hour: input.hour ?? now.hour, iso: now.iso }),
    statePatch: { payoff },
  };
}
