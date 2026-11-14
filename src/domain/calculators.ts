/**
 * Costa Rica calculators. Rates and tax are always inputs (with a "last verified"
 * date in the UI); nothing here is a fact about any bank.
 */
import { roundHalfEven } from '../lib/money';
import { daysInMonth } from '../lib/dates';

export interface CdpResult { gross: number; withholding: number; net: number; maturity: number; netAnnualPct: number }

/** CDP (certificado a plazo): interest = amount × rate × days / 360, withholding on the interest. */
export function cdp(amount: number, days: number, annualRatePct: number, withholdingPct = 15): CdpResult {
  const gross = roundHalfEven((amount * annualRatePct * days) / (100 * 360));
  const withholding = roundHalfEven((gross * withholdingPct) / 100);
  const net = gross - withholding;
  return { gross, withholding, net, maturity: amount + net, netAnnualPct: amount && days ? (net / amount) * (360 / days) * 100 : 0 };
}

export type Frequency = 'weekly' | 'quincenal' | 'monthly';

export interface ProgrammedResult { frequency: Frequency; deposited: number; interestGross: number; withholding: number; final: number; deposits: number }

/**
 * Programmed savings (like a goal-savings plan): deposits on a schedule, interest
 * accrues daily on the balance and is capitalised daily (rate / 365). The monthly
 * amount is spread across the frequency: weekly = monthly×12/52 every 7 days,
 * quincenal = half on the 15th and half on the last day, monthly = all on the last day
 * (payday), so the comparison shows what depositing more often is worth.
 */
export function programmedSavings(monthlyAmount: number, months: number, annualRatePct: number, frequency: Frequency, start: { year: number; month: number }, withholdingPct = 0): ProgrammedResult {
  const depositsOn = new Map<string, number>();
  const key = (y: number, m: number, d: number) => `${y}-${m}-${d}`;
  let deposited = 0, count = 0;
  const add = (y: number, m: number, d: number, amt: number) => { depositsOn.set(key(y, m, d), (depositsOn.get(key(y, m, d)) ?? 0) + amt); deposited += amt; count++; };
  const weekly = Math.round((monthlyAmount * 12) / 52);
  let dayIndex = 0;
  const days: [number, number, number][] = [];
  for (let i = 0; i < months; i++) {
    const idx = start.month - 1 + i;
    const y = start.year + Math.floor(idx / 12), m = (idx % 12) + 1;
    for (let d = 1; d <= daysInMonth(y, m); d++) days.push([y, m, d]);
    if (frequency === 'monthly') add(y, m, daysInMonth(y, m), monthlyAmount);
    if (frequency === 'quincenal') { const half = Math.floor(monthlyAmount / 2); add(y, m, 15, half); add(y, m, daysInMonth(y, m), monthlyAmount - half); }
  }
  if (frequency === 'weekly') for (const [y, m, d] of days) { if (dayIndex % 7 === 0) add(y, m, d, weekly); dayIndex++; }
  let balance = 0, interest = 0;
  const r = annualRatePct / 100 / 365;
  for (const [y, m, d] of days) {
    balance += depositsOn.get(key(y, m, d)) ?? 0;
    const i = roundHalfEven(balance * r);
    balance += i; interest += i;
  }
  const withholding = roundHalfEven((interest * withholdingPct) / 100);
  return { frequency, deposited, interestGross: interest, withholding, final: balance - withholding, deposits: count };
}

/** "What if I save ₡X more per month": future value with monthly compounding. */
export function futureValue(monthly: number, months: number, annualRatePct: number, startBalance = 0): { final: number; contributed: number; interest: number } {
  const r = annualRatePct / 100 / 12;
  let bal = startBalance;
  for (let i = 0; i < months; i++) bal = bal + roundHalfEven(bal * r) + monthly;
  const contributed = monthly * months;
  return { final: bal, contributed, interest: bal - startBalance - contributed };
}

/** Months until a target is reached saving `monthly` (with monthly compounding). */
export function monthsToTarget(target: number, monthly: number, annualRatePct: number, startBalance = 0, max = 600): number {
  if (startBalance >= target) return 0;
  const r = annualRatePct / 100 / 12;
  let bal = startBalance;
  for (let i = 1; i <= max; i++) { bal = bal + roundHalfEven(bal * r) + monthly; if (bal >= target) return i; }
  return Infinity;
}
