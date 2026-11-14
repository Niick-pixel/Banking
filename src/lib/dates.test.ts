import { describe, expect, it } from 'vitest';
import { daysBetween, formatDateCR, isISODate, lastDayOfMonth, monthKey, quincenaDates, todayISO } from './dates';

describe('dates', () => {
  it('validates ISO dates', () => {
    expect(isISODate('2026-02-29')).toBe(false);
    expect(isISODate('2028-02-29')).toBe(true);
    expect(isISODate('2026-13-01')).toBe(false);
  });
  it('last day of month (used for undated workbook rows)', () => {
    expect(lastDayOfMonth(2026, 2)).toBe('2026-02-28');
    expect(lastDayOfMonth(2026, 10)).toBe('2026-10-31');
  });
  it('quincenas', () => {
    expect(quincenaDates(2026, 11)).toEqual(['2026-11-15', '2026-11-30']);
    expect(quincenaDates(2028, 2)).toEqual(['2028-02-15', '2028-02-29']);
  });
  it('formats es-CR', () => {
    expect(formatDateCR('2026-11-04')).toBe('04/11/2026');
  });
  it('month key and today', () => {
    expect(monthKey('2026-11-30')).toBe('2026-11');
    expect(todayISO(new Date(2026, 10, 14, 23, 59))).toBe('2026-11-14');
  });
  it('days between', () => {
    expect(daysBetween('2026-11-14', '2026-11-15')).toBe(1);
    expect(daysBetween('2026-12-31', '2026-01-01')).toBe(-364);
  });
});
