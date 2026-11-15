/**
 * Money Coach (spec §10). Deterministic rules over the ledger: every number comes from
 * here, and every insight carries the formula, inputs and threshold that produced it.
 */
import type { Account, BalanceSnapshot, Budget, Category, Debt, Goal, Pot, RecurringRule, SelfLoan, Transaction } from '../domain/schemas';
import type { MonthFlow } from '../domain/ledger';
import type { Payroll } from '../domain/prefs';

export type Severity = 'info' | 'heads_up' | 'warning' | 'critical' | 'win';
/** R1–R21 from the spec catalog; A-ids are automations (e.g. A1 bank-balance nudge). */
export type RuleId = `R${number}` | `A${number}`;

export interface InsightAction {
  label: string;
  kind: 'move_money' | 'set_limit' | 'recategorize' | 'snooze' | 'open' | 'cooling_off' | 'split_windfall' | 'log_reason' | 'update_balance';
  payload: Record<string, unknown>;
}

export interface Insight {
  id: string;
  ruleId: RuleId;
  severity: Severity;
  title: string;
  body: string;
  why: { formula: string; inputs: Record<string, number | string>; threshold: string };
  /** Money at stake, in céntimos. */
  impactCRC: number;
  action?: InsightAction;
  expiresAt?: string;
  dedupeKey: string;
  /** Days until something must be done (drives urgency). */
  actWithinDays: number;
  /** 0–1, rule-specific. */
  confidence: number;
  /** Filled by the scorer. */
  priority?: number;
  /** R10: the app asks for a reason before the alert can be closed. */
  requiresReason?: boolean;
}

export type CoachTone = 'direct' | 'gentle';
export type WindfallTarget = 'replenish' | 'hers' | 'emergency' | 'sinking' | 'free';

export interface CoachPrefs {
  enabled: boolean;
  tone: CoachTone;
  /** Kept aside in safe-to-spend and the forecast, céntimos. */
  buffer: number;
  workHoursPerMonth: number;
  push: boolean;
  quietStart: number; // hour, 0–23
  quietEnd: number;
  maxPushPerDay: number;
  cooldownWarningDays: number;
  cooldownCriticalDays: number;
  /** Cooling-off: items at/above `coolingMin` wait `coolingShortHours`; at/above `coolingLong` they wait `coolingLongDays`. */
  coolingMin: number; coolingLong: number; coolingShortHours: number; coolingLongDays: number;
  /** Show "≈ N hours of work" for discretionary purchases at/above this. */
  hoursNoteMin: number;
  windfallOrder: WindfallTarget[];
  windfallFreeMaxPct: number;
  /** Per-rule switches and threshold overrides (merged over each rule's defaults). */
  rules: Record<string, { on?: boolean } & Record<string, number | boolean | undefined>>;
}

/** Coach memory (synced): what you dismissed/snoozed, votes, push log, payoff history, wants list. */
export interface CoachState {
  dismissed: Record<string, string>;        // dedupeKey → ISO date dismissed
  snoozed: Record<string, string>;          // dedupeKey → ISO date until
  notUseful: Record<string, number>;        // ruleId → votes
  weights: Record<string, number>;          // ruleId → userWeight (default 1)
  reasons: Record<string, string>;          // dedupeKey → reason you gave (R10)
  pushLog: Record<string, string>;          // dedupeKey → ISO datetime last pushed
  pushDay: { date: string; count: number };
  /** R11: last projected payoff per debt and when it was computed. */
  payoff: Record<string, { month: string; date: string }>;
  caps: { categoryId: string; month: string; dailyCap: number; setOn: string }[];
  wants: WantItem[];
  moneyNotWasted: number;
}

export interface WantItem {
  id: string; name: string; amount: number; categoryId?: string; store?: string;
  addedAt: string;      // ISO datetime
  readyAt: string;      // ISO datetime
  status: 'waiting' | 'bought' | 'dropped';
  decidedAt?: string;
}

export interface CoachInput {
  today: string;
  /** Hour of day (local), for quiet hours; tests pass a fixed value. */
  hour?: number;
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  pots: Pot[];
  budgets: Budget[];
  debts: Debt[];
  recurring: RecurringRule[];
  selfLoans: SelfLoan[];
  goals: Goal[];
  /** Statement balances: the Coach starts from the latest one, like Net Worth does. */
  snapshots?: BalanceSnapshot[];
  flows: Map<string, MonthFlow>;
  prefs: CoachPrefs;
  state: CoachState;
  savingsRateTarget: number;
  efTargetMonths: number;
  payroll: Payroll;
}
