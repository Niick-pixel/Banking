/**
 * Tasa Cero: an interest-free purchase split into N monthly cuotas on a card.
 *
 * Split rule: every cuota is the same whole-colón amount (rounded down); the
 * LAST cuota absorbs the remainder so the cuotas always add up to the exact
 * purchase total, to the céntimo.
 */
import type { InstallmentPlan, Transaction } from './schemas';
import { daysInMonth, parseISO, toISO, type ISODate } from '../lib/dates';
import { MoneyError } from '../lib/money';

const COLON = 100; // céntimos per colón

export interface CuotaSplit { regular: number; last: number; months: number }

export function splitCuotas(total: number, months: number): CuotaSplit {
  if (!Number.isSafeInteger(total) || total <= 0) throw new MoneyError('Total must be a positive amount');
  if (!Number.isInteger(months) || months < 1) throw new MoneyError('Months must be ≥ 1');
  const regular = Math.floor(total / months / COLON) * COLON;
  const last = total - regular * (months - 1);
  return { regular, last, months };
}

export function cuotaAmount(split: CuotaSplit, n: number): number {
  return n === split.months ? split.last : split.regular;
}

/** Same day-of-month as the first charge, clamped to month end (31st → 28/29/30). */
export function cuotaDate(firstChargeDate: ISODate, n: number): ISODate {
  const { year, month, day } = parseISO(firstChargeDate);
  const idx = month - 1 + (n - 1);
  const y = year + Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return toISO(y, m, Math.min(day, daysInMonth(y, m)));
}

export interface ScheduleRow { n: number; date: ISODate; amount: number; remainingAfter: number }

export function schedule(total: number, months: number, firstChargeDate: ISODate): ScheduleRow[] {
  const split = splitCuotas(total, months);
  let remaining = total;
  return Array.from({ length: months }, (_, i) => {
    const n = i + 1;
    const amount = cuotaAmount(split, n);
    remaining -= amount;
    return { n, date: cuotaDate(firstChargeDate, n), amount, remainingAfter: remaining };
  });
}

/** Deterministic id → posting the same cuota twice is impossible (put() overwrites). */
export const cuotaTxId = (planId: string, n: number) => `cuota:${planId}:${n}`;

/** Cuotas due on or before `today` that must exist as transactions. */
export function dueCuotaTransactions(plan: InstallmentPlan, today: ISODate, now: number): Transaction[] {
  if (plan.status === 'cancelled') return [];
  return schedule(plan.total, plan.months, plan.firstChargeDate)
    .filter((r) => r.date <= today)
    .map((r) => ({
      id: cuotaTxId(plan.id, r.n),
      kind: 'expense' as const,
      date: r.date,
      dateEstimated: false,
      from: { accountId: plan.cardAccountId },
      amount: r.amount,
      currency: plan.currency,
      categoryId: plan.categoryId,
      description: `${plan.description} · cuota ${r.n}/${plan.months}`,
      tags: ['tasa-cero'],
      notes: '',
      installmentPlanId: plan.id,
      installmentNumber: r.n,
      createdAt: now,
      updatedAt: now,
    }));
}

export interface PlanProgress { billed: number; billedCount: number; pending: number; nextDate?: ISODate; nextAmount?: number; endDate: ISODate }

export function planProgress(plan: InstallmentPlan, today: ISODate): PlanProgress {
  const rows = schedule(plan.total, plan.months, plan.firstChargeDate);
  const billedRows = plan.status === 'cancelled' ? [] : rows.filter((r) => r.date <= today);
  const billed = billedRows.reduce((s, r) => s + r.amount, 0);
  const next = rows.find((r) => r.date > today);
  return {
    billed, billedCount: billedRows.length, pending: plan.status === 'cancelled' ? 0 : plan.total - billed,
    nextDate: next?.date, nextAmount: next?.amount, endDate: rows[rows.length - 1]!.date,
  };
}

/** Sum of cuotas billed in a given month across plans → "monthly Tasa Cero commitment". */
export function commitmentForMonth(plans: InstallmentPlan[], year: number, month: number): number {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  let sum = 0;
  for (const p of plans) {
    if (p.status === 'cancelled') continue;
    for (const r of schedule(p.total, p.months, p.firstChargeDate)) if (r.date.startsWith(prefix)) sum += r.amount;
  }
  return sum;
}
