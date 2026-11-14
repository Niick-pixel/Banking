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
};
export type PrefKey = keyof typeof PREF_DEFAULTS;
