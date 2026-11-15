/** Spec §10.8: priority = impact × urgency × confidence × userWeight × severityMultiplier. */
import { clamp } from './stats';
import type { CoachState, Insight, Severity } from './types';

export const SEVERITY_MULT: Record<Severity, number> = { info: 0.5, heads_up: 1, warning: 1.5, critical: 3, win: 0.8 };

export function urgency(days: number): number { return days <= 3 ? 1 : days <= 14 ? 0.6 : 0.3; }

/** Three "not useful" votes halve a rule's weight (and again at six, …). Your explicit weight wins. */
export function userWeight(state: CoachState, ruleId: string): number {
  if (state.weights[ruleId] !== undefined) return state.weights[ruleId]!;
  return Math.pow(0.5, Math.floor((state.notUseful[ruleId] ?? 0) / 3));
}

export function score(i: Insight, avgMonthlyIncome: number, state: CoachState): number {
  // Wins and info with no money at stake still get a small floor so they can appear when nothing else does.
  const impact = avgMonthlyIncome > 0 ? clamp(i.impactCRC / avgMonthlyIncome, 0.02, 1) : 0.5;
  return impact * urgency(i.actWithinDays) * clamp(i.confidence, 0, 1) * userWeight(state, i.ruleId) * SEVERITY_MULT[i.severity];
}
