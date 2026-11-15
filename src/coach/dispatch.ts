/**
 * Spec §10.7: what reaches you. Everything goes to the Inbox (minus dismissed/snoozed);
 * push only for warning/critical, max N per day, never in quiet hours, once per cooldown per dedupeKey.
 */
import type { CoachPrefs, CoachState, Insight } from './types';

export interface Dispatch { inbox: Insight[]; top: Insight[]; push: Insight[]; hidden: number }

const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

export function inQuietHours(hour: number, p: Pick<CoachPrefs, 'quietStart' | 'quietEnd'>): boolean {
  return p.quietStart > p.quietEnd ? hour >= p.quietStart || hour < p.quietEnd : hour >= p.quietStart && hour < p.quietEnd;
}

export function dispatch(ranked: Insight[], prefs: CoachPrefs, state: CoachState, now: { date: string; hour: number; iso: string }): Dispatch {
  const visible = ranked.filter((i) => {
    if (state.dismissed[i.dedupeKey]) return false;
    const until = state.snoozed[i.dedupeKey];
    return !(until && until > now.date);
  });
  const push: Insight[] = [];
  if (prefs.push && !inQuietHours(now.hour, prefs)) {
    let used = state.pushDay.date === now.date ? state.pushDay.count : 0;
    for (const i of visible) {
      if (used >= prefs.maxPushPerDay) break;
      if (i.severity !== 'warning' && i.severity !== 'critical') continue;
      const last = state.pushLog[i.dedupeKey];
      const cooldown = i.severity === 'critical' ? prefs.cooldownCriticalDays : prefs.cooldownWarningDays;
      if (last && daysBetween(last, now.iso) < cooldown) continue;
      push.push(i); used++;
    }
  }
  return { inbox: visible, top: visible.slice(0, 3), push, hidden: ranked.length - visible.length };
}
