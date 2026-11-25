import { COACH_DEFAULTS, EMPTY_STATE } from '../coach/prefs';
import type { CoachPrefs, CoachState } from '../coach/types';

/** Preference defaults. Everything here is user-editable; nothing is a fact about a bank. */
export interface Payroll {
  mySavingsPerQuincena: number;      // e.g. automatic transfer to savings
  associationPerQuincena: number;    // Asociación voluntary plan
  aporteObreroMonthly: number;       // employee cesantía contribution
  aportePatronalMonthly: number;     // employer contribution (informational)
}
export interface CalcRates {
  cdpAnnualRatePct: number; cdpVerifiedOn?: string;
  programmedAnnualRatePct: number; programmedVerifiedOn?: string;
  withholdingPct: number;            // tax withheld on interest
}
export const PREF_DEFAULTS = {
  efTargetMonths: 6,
  savingsRateTarget: 0.2,
  payroll: { mySavingsPerQuincena: 7_000_000, associationPerQuincena: 3_500_000, aporteObreroMonthly: 1_600_000, aportePatronalMonthly: 1_600_000 } as Payroll,
  calcRates: { cdpAnnualRatePct: 0, programmedAnnualRatePct: 0, withholdingPct: 15 } as CalcRates,
  notifyBills: false,
  /** Dashboard cards you've hidden (ids from DASH_CARDS). */
  dashHidden: [] as string[],
  /** Budget alert: warn when a category reaches this share of its budget. */
  budgetWarnPct: 0.8,
  fx: { source: 'auto', side: 'sell', bccrName: '', bccrEmail: '', bccrToken: '' } as FxPrefs,
  /** Money Coach settings (spec §10.10) and its memory (dismissed, snoozed, votes, wants list…). */
  coach: COACH_DEFAULTS as CoachPrefs,
  coachState: EMPTY_STATE as CoachState,
  /** Inventory: the margins that set each product's minimum and maximum price. */
  storeMargins: { min: 0.2, max: 0.55 } as { min: number; max: number },
};

export interface FxPrefs {
  /** auto = BCCR when a token is set, then the free market rate; manual = always type it. */
  source: 'auto' | 'bccr' | 'market' | 'manual';
  /** BCCR reference rate: sell (venta, what a card charge uses) or buy (compra). */
  side: 'sell' | 'buy';
  bccrName: string; bccrEmail: string; bccrToken: string;
}

export const DASH_CARDS: { id: string; label: string }[] = [
  { id: 'coach', label: 'Coach: top 3 alerts' },
  { id: 'insights', label: 'What happened' },
  { id: 'upcoming', label: 'Coming up (30 days)' },
  { id: 'waterfall', label: 'Where the month’s money went (waterfall)' },
  { id: 'pace', label: 'Spending pace' },
  { id: 'flow', label: 'Income vs expenses' },
  { id: 'groups', label: 'Spending by group' },
  { id: 'where', label: 'Where it went' },
  { id: 'budget', label: 'Budget health' },
  { id: 'freecash', label: 'Free cash by month' },
  { id: 'networth', label: 'Net worth' },
  { id: 'cards', label: 'Credit cards' },
  { id: 'debts', label: 'Debts' },
  { id: 'calendar', label: 'Daily spending calendar' },
];
export type PrefKey = keyof typeof PREF_DEFAULTS;
