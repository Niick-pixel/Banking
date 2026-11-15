/**
 * The Money Coach in the app: runs the engine over the live ledger, remembers what you
 * dismissed/snoozed/voted, sends the few pushes it's allowed, and performs one-tap actions.
 * Nothing changes your data unless you tap an action.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { newId, saveSelfLoan, saveSnapshot, saveTransaction } from '../db/repo';
import { runCoach, type CoachRun } from '../coach/engine';
import { weeklyCheckIn } from '../coach/reports';
import { inQuietHours } from '../coach/dispatch';
import type { SplitLine } from '../coach/windfall';
import type { CoachState, Insight, WantItem } from '../coach/types';
import { TransactionSchema, type Transaction } from '../domain/schemas';
import { todayISO } from '../lib/dates';
import { useLedger } from './data';
import { usePref } from './prefs';
import { notificationsAllowed, send } from './reminders';

export interface CoachApi {
  run: CoachRun | null;
  enabled: boolean;
  state: CoachState;
  dismiss: (i: Insight) => Promise<void>;
  snooze: (i: Insight, days: number) => Promise<void>;
  notUseful: (i: Insight) => Promise<void>;
  giveReason: (i: Insight, reason: string) => Promise<void>;
  setCap: (categoryId: string, month: string, dailyCap: number) => Promise<void>;
  clearCap: (categoryId: string, month: string) => Promise<void>;
  updateBalance: (accountId: string, balance: number) => Promise<void>;
  saveTo: (opts: { amount: number; potId?: string; accountId?: string; fromAccountId?: string; target?: SplitLine['target']; note?: string }) => Promise<void>;
  applySplit: (lines: SplitLine[], fromAccountId?: string, sourceKey?: string) => Promise<void>;
  addWant: (w: Pick<WantItem, 'name' | 'amount' | 'categoryId' | 'store'>) => Promise<void>;
  decideWant: (id: string, d: 'bought' | 'dropped' | 'extend') => Promise<void>;
  patchState: (p: Partial<CoachState>) => Promise<void>;
}

const Ctx = createContext<CoachApi | null>(null);
export const useCoach = () => useContext(Ctx)!;

const plusDays = (iso: string, n: number) => { const t = new Date(`${iso}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

export function CoachProvider({ children }: { children: ReactNode }) {
  const l = useLedger();
  const snapshots = useLiveQuery(() => db.snapshots.toArray(), [], []);
  const [rawPrefs] = usePref('coach');
  const [warnPct] = usePref('budgetWarnPct');
  // Settings → Budgets' alert threshold is R2's threshold unless you tuned R2 itself.
  const prefs = useMemo(() => ({ ...rawPrefs, rules: { ...rawPrefs.rules, R2: { warnPct, ...rawPrefs.rules.R2 } } }), [rawPrefs, warnPct]);
  const [state, setState] = usePref('coachState');
  const [rateTarget] = usePref('savingsRateTarget');
  const [efTarget] = usePref('efTargetMonths');
  const [payroll] = usePref('payroll');
  const today = todayISO();
  const stateRef = useRef(state);
  stateRef.current = state;

  const run = useMemo(() => {
    if (!l.ready || !l.accounts.length || !prefs.enabled) return null;
    return runCoach({
      today, hour: new Date().getHours(), transactions: l.transactions, categories: l.categories, accounts: l.accounts, pots: l.pots,
      budgets: l.budgets, debts: l.debts, recurring: l.recurring, selfLoans: l.selfLoans, goals: l.goals, snapshots, flows: l.flows,
      prefs, state, savingsRateTarget: rateTarget, efTargetMonths: efTarget, payroll,
    });
  }, [l, snapshots, prefs, state, rateTarget, efTarget, payroll, today]);

  const patchState = useCallback(async (p: Partial<CoachState>) => { await setState({ ...stateRef.current, ...p }); }, [setState]);

  // Remember payoff projections (R11 compares against last month's).
  useEffect(() => {
    const next = run?.statePatch.payoff;
    if (next && JSON.stringify(next) !== JSON.stringify(state.payoff)) void patchState({ payoff: next });
  }, [run, state.payoff, patchState]);

  // Pushes: only warning/critical, within the daily budget, outside quiet hours, once per cooldown.
  useEffect(() => {
    if (!run?.dispatch.push.length) return;
    void (async () => {
      if (!(await notificationsAllowed())) return;
      const now = new Date().toISOString();
      const log = { ...stateRef.current.pushLog };
      let count = stateRef.current.pushDay.date === today ? stateRef.current.pushDay.count : 0;
      for (const i of run.dispatch.push) { await send(i.title, i.body); log[i.dedupeKey] = now; count++; }
      await patchState({ pushLog: log, pushDay: { date: today, count } });
    })();
  }, [run, today, patchState]);

  // Weekly check-in: Sunday evening (18:00+), once per week, outside quiet hours.
  useEffect(() => {
    const now = new Date();
    if (!run || !prefs.push || now.getDay() !== 0 || now.getHours() < 18 || inQuietHours(now.getHours(), prefs)) return;
    const key = `weekly:${today}`;
    if (stateRef.current.pushLog[key]) return;
    void (async () => {
      if (!(await notificationsAllowed())) return;
      const w = weeklyCheckIn(run.ctx, run.dispatch.inbox);
      const fmt = (n: number) => `₡${Math.round(n / 100).toLocaleString('en-US')}`;
      await send('Weekly check-in', `${w.line} Spent ${fmt(w.spent)} this week.${w.safeWeek !== null ? ` Safe for next week: ~${fmt(w.safeWeek)}.` : ''}${w.top[0] ? ` Top: ${w.top[0].title}` : ''}`);
      await patchState({ pushLog: { ...stateRef.current.pushLog, [key]: now.toISOString() } });
    })();
  }, [run, prefs, today, patchState]);

  const api = useMemo<CoachApi>(() => {
    const s = () => stateRef.current;
    const savingsCategory = (target?: SplitLine['target'], potId?: string) => {
      const cats = l.categories.filter((c) => c.group === 'Savings' && !c.archived);
      const owner = l.pots.find((p) => p.id === potId)?.owner;
      return (target === 'replenish' && cats.find((c) => /replenish|reponer/i.test(c.name)))
        || (owner === 'hers' && cats.find((c) => /hers|her\b|ella/i.test(c.name)))
        || cats.find((c) => /mine|mío|mio/i.test(c.name)) || cats[0];
    };
    const spending = l.accounts.find((a) => a.type === 'checking' && !a.archived) ?? l.accounts[0];
    const saveTo: CoachApi['saveTo'] = async ({ amount, potId, accountId, fromAccountId, target, note }) => {
      const pot = l.pots.find((p) => p.id === potId);
      const to = pot ? { accountId: pot.accountId, potId: pot.id } : accountId ? { accountId } : undefined;
      const cat = savingsCategory(target, potId);
      if (!to || !cat || !spending) throw new Error('Set up a savings pot first.');
      const now = Date.now();
      const tx = TransactionSchema.parse({
        id: newId(), date: today, dateEstimated: false, currency: 'CRC', description: note ?? 'Coach: saved', tags: ['coach'], notes: '',
        kind: 'savings', direction: 'deposit', from: { accountId: fromAccountId ?? spending.id }, to, amount, categoryId: cat.id, createdAt: now, updatedAt: now,
      });
      await saveTransaction(tx);
    };
    return {
      run, enabled: prefs.enabled, state,
      patchState,
      dismiss: (i) => patchState({ dismissed: { ...s().dismissed, [i.dedupeKey]: today } }),
      snooze: (i, days) => patchState({ snoozed: { ...s().snoozed, [i.dedupeKey]: plusDays(today, days) } }),
      notUseful: (i) => patchState({ notUseful: { ...s().notUseful, [i.ruleId]: (s().notUseful[i.ruleId] ?? 0) + 1 }, dismissed: { ...s().dismissed, [i.dedupeKey]: today } }),
      giveReason: async (i, reason) => {
        const p = i.action?.payload as { transactionId?: string; amount?: number } | undefined;
        const tx = l.transactions.find((t) => t.id === p?.transactionId) as Transaction | undefined;
        if (tx && 'amount' in tx) {
          const now = Date.now();
          // Logged as borrowing from her fund: it shows on the Pots page until it's put back.
          await saveSelfLoan({ id: newId(), description: `From her fund: ${reason}`, currency: 'CRC', amount: tx.amount, fromAccountId: 'from' in tx ? tx.from.accountId : undefined, borrowedOn: tx.date, plannedSource: '', status: 'open', notes: reason, createdAt: now, updatedAt: now });
        }
        await patchState({ reasons: { ...s().reasons, [i.dedupeKey]: reason } });
      },
      setCap: (categoryId, month, dailyCap) => patchState({ caps: [...s().caps.filter((c) => !(c.categoryId === categoryId && c.month === month)), { categoryId, month, dailyCap, setOn: today }] }),
      clearCap: (categoryId, month) => patchState({ caps: s().caps.filter((c) => !(c.categoryId === categoryId && c.month === month)) }),
      updateBalance: async (accountId, balance) => { await saveSnapshot(accountId, today, balance); },
      saveTo,
      applySplit: async (lines, fromAccountId, sourceKey) => {
        for (const line of lines) if (line.amount > 0 && line.target !== 'free' && (line.potId || line.accountId)) await saveTo({ amount: line.amount, potId: line.potId, accountId: line.accountId, fromAccountId, target: line.target, note: `Windfall → ${line.label}` });
        if (sourceKey) await patchState({ dismissed: { ...s().dismissed, [sourceKey]: today } });
      },
      addWant: async (w) => {
        const p = prefs;
        const now = new Date();
        const ready = new Date(now.getTime() + (w.amount >= p.coolingLong ? p.coolingLongDays * 86_400_000 : p.coolingShortHours * 3_600_000));
        await patchState({ wants: [...s().wants, { ...w, id: newId(), addedAt: now.toISOString(), readyAt: ready.toISOString(), status: 'waiting' }] });
      },
      decideWant: async (id, d) => {
        const w = s().wants.find((x) => x.id === id);
        if (!w) return;
        if (d === 'extend') { await patchState({ wants: s().wants.map((x) => (x.id === id ? { ...x, readyAt: new Date(Date.parse(x.readyAt) + 7 * 86_400_000).toISOString() } : x)) }); return; }
        await patchState({
          wants: s().wants.map((x) => (x.id === id ? { ...x, status: d, decidedAt: new Date().toISOString() } : x)),
          moneyNotWasted: s().moneyNotWasted + (d === 'dropped' ? w.amount : 0),
        });
      },
    };
  }, [run, prefs, state, patchState, l, today]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
