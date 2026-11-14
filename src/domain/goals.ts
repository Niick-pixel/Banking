import type { Goal } from './schemas';
import { cuotaDate } from './installments';
import type { ISODate } from '../lib/dates';

export interface GoalProgress {
  current: number; pct: number; remaining: number;
  monthsLeft?: number; requiredMonthly?: number;
  onTrack?: boolean; projectedDate?: ISODate; reached: boolean;
}

function monthsBetween(from: ISODate, to: ISODate): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  return Math.max(0, (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0));
}

export function goalProgress(goal: Goal, current: number, today: ISODate): GoalProgress {
  const remaining = Math.max(0, goal.target - current);
  const reached = remaining === 0;
  const pct = goal.target ? Math.min(1, Math.max(0, current / goal.target)) : 0;
  const out: GoalProgress = { current, pct, remaining, reached };
  if (goal.targetDate && !reached) {
    const m = monthsBetween(today, goal.targetDate);
    out.monthsLeft = m;
    out.requiredMonthly = m > 0 ? Math.ceil(remaining / m / 100) * 100 : remaining;
  }
  if (goal.plannedMonthly && !reached) {
    const n = Math.ceil(remaining / goal.plannedMonthly);
    out.projectedDate = cuotaDate(today, n + 1);
    if (out.requiredMonthly !== undefined) out.onTrack = goal.plannedMonthly >= out.requiredMonthly;
  }
  return out;
}
