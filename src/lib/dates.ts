/**
 * Dates are stored as ISO calendar strings "YYYY-MM-DD" — no time, no timezone —
 * so a movement logged on the 15th is the 15th everywhere. Display uses es-CR
 * order (DD/MM/YYYY).
 */
export type ISODate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isISODate(s: string): s is ISODate {
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const [, y, mo, d] = m.map(Number) as [number, number, number, number];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function todayISO(now: Date = new Date()): ISODate {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function toISO(year: number, month: number, day: number): ISODate {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseISO(d: ISODate): { year: number; month: number; day: number } {
  const m = ISO_RE.exec(d);
  if (!m) throw new Error(`Invalid ISO date: ${d}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function lastDayOfMonth(year: number, month: number): ISODate {
  return toISO(year, month, daysInMonth(year, month));
}

/** "2026-11" — the key used to bucket movements by month. */
export type MonthKey = string;

export function monthKey(d: ISODate): MonthKey {
  return d.slice(0, 7);
}

/** Pay dates for a month under the quincena schedule: the 15th and the last day. */
export function quincenaDates(year: number, month: number): [ISODate, ISODate] {
  return [toISO(year, month, 15), lastDayOfMonth(year, month)];
}

/** DD/MM/YYYY */
export function formatDateCR(d: ISODate): string {
  const { year, month, day } = parseISO(d);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

/** Signed whole-day difference b − a. */
export function daysBetween(a: ISODate, b: ISODate): number {
  const pa = parseISO(a);
  const pb = parseISO(b);
  return Math.round(
    (Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / 86_400_000,
  );
}
