import type { CoachPrefs, CoachState } from './types';

export const COACH_DEFAULTS: CoachPrefs = {
  enabled: true,
  tone: 'direct',
  buffer: 2_500_000,
  workHoursPerMonth: 173,
  push: true,
  quietStart: 22, quietEnd: 7,
  maxPushPerDay: 3,
  cooldownWarningDays: 3, cooldownCriticalDays: 1,
  coolingMin: 1_500_000, coolingLong: 5_000_000, coolingShortHours: 48, coolingLongDays: 7,
  hoursNoteMin: 1_500_000,
  windfallOrder: ['replenish', 'hers', 'emergency', 'sinking', 'free'],
  windfallFreeMaxPct: 0.15,
  rules: {},
};

export const EMPTY_STATE: CoachState = {
  dismissed: {}, snoozed: {}, notUseful: {}, weights: {}, reasons: {}, pushLog: {},
  pushDay: { date: '', count: 0 }, payoff: {}, caps: [], wants: [], moneyNotWasted: 0,
};
