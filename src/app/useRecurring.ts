import { useMemo } from 'react';
import { useLedger } from './data';
import { calendarEvents, dueOccurrences, type CalendarEvent } from '../domain/recurring';
import type { RecurringRule } from '../domain/schemas';
import { todayISO } from '../lib/dates';

export interface Pending { rule: RecurringRule; date: string }

/** Reminders waiting for confirmation, oldest first. */
export function usePendingReminders(): Pending[] {
  const l = useLedger();
  return useMemo(() => {
    const posted = new Set(l.transactions.filter((t) => t.recurringId).map((t) => t.id));
    const today = todayISO();
    return l.recurring.filter((r) => r.mode === 'remind').flatMap((rule) => dueOccurrences(rule, today, posted).map((date) => ({ rule, date }))).sort((a, b) => a.date.localeCompare(b.date));
  }, [l]);
}

export function useCalendar(from: string, to: string): CalendarEvent[] {
  const l = useLedger();
  return useMemo(() => {
    try {
      return calendarEvents({ rules: l.recurring, transactions: l.transactions, installments: l.installments, debts: l.debts, accounts: l.accounts, selfLoans: l.selfLoans, categories: l.categories }, from, to, todayISO());
    } catch (e) { console.error(e); return []; }
  }, [l, from, to]);
}
