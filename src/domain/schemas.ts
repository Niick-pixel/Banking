/**
 * Domain schema (Zod). Every entity written to IndexedDB and every import row
 * is validated against these.
 *
 * Integrity-by-construction decisions (see docs/PLAN.md §Schema):
 *  - Amounts are positive integer minor units. Direction comes from `kind`,
 *    never from a sign — except `adjustment`, the one explicitly signed kind.
 *  - A transfer is ONE record with both sides (from/to). A missing side is a
 *    validation error, not a data-health warning.
 *  - No stored totals or balances anywhere. Balances are derived from
 *    transactions + opening balance; snapshots are statements to reconcile against.
 */
import { z } from 'zod';
import { CURRENCIES } from '../lib/money';
import { isISODate } from '../lib/dates';

export const Id = z.string().min(1);
export const ISODateSchema = z.string().refine(isISODate, 'Expected a valid YYYY-MM-DD date');
export const CurrencySchema = z.enum(CURRENCIES);
/** Positive integer minor units. */
export const PositiveMinor = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const SignedMinor = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const Timestamps = { createdAt: z.number().int(), updatedAt: z.number().int() };

// ── Accounts ────────────────────────────────────────────────────────────────
export const ACCOUNT_TYPES = [
  'checking', 'savings', 'goal_savings', 'cash', 'credit_card',
  'association_voluntary', 'association_cesantia', 'investment', 'loan_fund',
] as const;
export const AccountType = z.enum(ACCOUNT_TYPES);

export const AccountSchema = z.object({
  id: Id,
  name: z.string().min(1),
  institution: z.string().default(''),
  type: AccountType,
  currency: CurrencySchema,
  /** Signed: a credit card opens with a negative (owed) balance. */
  openingBalance: SignedMinor,
  openingDate: ISODateSchema,
  isLiquid: z.boolean(),
  archived: z.boolean().default(false),
  color: z.string().optional(),
  icon: z.string().optional(),
  /** Ledger is confirmed to match the statement up to and including this date. */
  reconciledThrough: ISODateSchema.optional(),
  /** Credit cards: day the statement closes and day payment is due. */
  cardStatementDay: z.number().int().min(1).max(31).optional(),
  cardDueDay: z.number().int().min(1).max(31).optional(),
  ...Timestamps,
});
export type Account = z.infer<typeof AccountSchema>;

// ── Pots (virtual sub-balances inside an account) ──────────────────────────
export const PotOwner = z.enum(['mine', 'hers', 'shared']);
export const PotSchema = z.object({
  id: Id,
  accountId: Id,
  name: z.string().min(1),
  owner: PotOwner,
  purpose: z.string().default(''),
  archived: z.boolean().default(false),
  ...Timestamps,
});
export type Pot = z.infer<typeof PotSchema>;

// ── Categories ─────────────────────────────────────────────────────────────
export const CATEGORY_GROUPS = ['Income', 'Fixed', 'Living', 'Discretionary', 'Debt Service', 'Savings'] as const;
export const CategoryGroup = z.enum(CATEGORY_GROUPS);
export const CategorySchema = z.object({
  id: Id,
  name: z.string().min(1),
  group: CategoryGroup,
  /** Counted as "avoidable" in insights. */
  discretionary: z.boolean().default(false),
  icon: z.string().optional(),
  sortOrder: z.number().int().default(0),
  archived: z.boolean().default(false),
  ...Timestamps,
});
export type Category = z.infer<typeof CategorySchema>;

// ── Transactions ───────────────────────────────────────────────────────────
/** One side of a movement: an account, optionally narrowed to a pot inside it. */
export const Side = z.object({ accountId: Id, potId: Id.optional() });
export type Side = z.infer<typeof Side>;

export const SplitSchema = z.object({ categoryId: Id, amount: PositiveMinor, note: z.string().optional() });

/** The original foreign-currency amount of a movement saved in colones, and the rate used. */
export const FxInfoSchema = z.object({
  currency: z.literal('USD'),
  /** USD cents. */
  amount: PositiveMinor,
  /** CRC céntimos per 1 USD. */
  rate: z.number().int().positive(),
  /** The day the rate is from (may be before the movement's date on weekends/holidays). */
  rateDate: ISODateSchema,
  source: z.enum(['BCCR', 'market', 'manual']),
  side: z.enum(['sell', 'buy']).default('sell'),
});
export type FxInfo = z.infer<typeof FxInfoSchema>;

const TxBase = {
  id: Id,
  date: ISODateSchema,
  /** True when the date was inferred (e.g. undated workbook row → last day of month). */
  dateEstimated: z.boolean().default(false),
  currency: CurrencySchema,
  description: z.string().default(''),
  tags: z.array(z.string()).default([]),
  notes: z.string().default(''),
  attachmentId: Id.optional(),
  recurringId: Id.optional(),
  importBatchId: Id.optional(),
  /** Groups records created by one user action (e.g. pay-from-pot + debt repayment). */
  linkId: Id.optional(),
  /** Set when you entered the amount in dollars: `amount` is the colón conversion. */
  fx: FxInfoSchema.optional(),
  ...Timestamps,
};

export const IncomeTx = z.object({
  ...TxBase, kind: z.literal('income'), to: Side, amount: PositiveMinor, categoryId: Id,
});

export const ExpenseTx = z.object({
  ...TxBase, kind: z.literal('expense'), from: Side, amount: PositiveMinor,
  categoryId: Id.optional(), splits: z.array(SplitSchema).optional(),
  /** Set on monthly cuotas generated from a Tasa Cero plan. */
  installmentPlanId: Id.optional(),
  installmentNumber: z.number().int().positive().optional(),
});

/** Between two of MY accounts/pots. Never income, never expense. */
export const TransferTx = z.object({
  ...TxBase, kind: z.literal('transfer'), from: Side, to: Side, amount: PositiveMinor,
  /** Only when the two accounts are in different currencies: amount landing in `to`. */
  toAmount: PositiveMinor.optional(),
  rateId: Id.optional(),
});

/**
 * Money moved into (deposit) or out of (withdrawal) savings. Shaped like a
 * transfer — it moves money between my own places — but tagged with a Savings
 * category so the Tracker's "Total saved" line can count it.
 */
export const SavingsTx = z.object({
  ...TxBase, kind: z.literal('savings'), direction: z.enum(['deposit', 'withdrawal']),
  from: Side, to: Side, amount: PositiveMinor, categoryId: Id,
  /** A deposit that puts back money borrowed from my own savings. */
  selfLoanId: Id.optional(),
});

export const DebtPaymentTx = z.object({
  ...TxBase, kind: z.literal('debt_payment'), from: Side, amount: PositiveMinor, debtId: Id,
  categoryId: Id,
  /** Portion of `amount` that was interest (the rest reduces principal). */
  interestPortion: z.number().int().nonnegative().default(0),
});

/** Correction to match reality. The only signed kind; excluded from income/expense. */
export const AdjustmentTx = z.object({
  ...TxBase, kind: z.literal('adjustment'), side: Side, signedAmount: SignedMinor.refine((n) => n !== 0),
  reason: z.string().min(1),
});

export const TransactionSchema = z
  .discriminatedUnion('kind', [IncomeTx, ExpenseTx, TransferTx, SavingsTx, DebtPaymentTx, AdjustmentTx])
  .superRefine((tx, ctx) => {
    if ('from' in tx && 'to' in tx && tx.from.accountId === tx.to.accountId && tx.from.potId === tx.to.potId) {
      ctx.addIssue({ code: 'custom', message: 'From and to are the same place' });
    }
    if (tx.kind === 'expense') {
      const hasCat = !!tx.categoryId;
      const hasSplits = !!tx.splits?.length;
      if (hasCat === hasSplits) {
        ctx.addIssue({ code: 'custom', message: 'Expense needs exactly one of: category, or splits' });
      }
      if (hasSplits && tx.splits!.reduce((s, x) => s + x.amount, 0) !== tx.amount) {
        ctx.addIssue({ code: 'custom', message: 'Splits must add up exactly to the amount' });
      }
    }
    if (tx.kind === 'debt_payment' && tx.interestPortion > tx.amount) {
      ctx.addIssue({ code: 'custom', message: 'Interest portion exceeds payment' });
    }
  });
export type Transaction = z.infer<typeof TransactionSchema>;
export type TransactionKind = Transaction['kind'];

// ── Debts & self-loans ─────────────────────────────────────────────────────
export const DebtSchema = z.object({
  id: Id,
  creditor: z.string().min(1),
  kind: z.enum(['family', 'bank', 'credit_card', 'financing']),
  currency: CurrencySchema,
  originalAmount: PositiveMinor,
  /** Annual rate in basis points (12.5% → 1250). 0 is valid and handled exactly. */
  annualRateBps: z.number().int().nonnegative(),
  startDate: ISODateSchema,
  plannedMonthlyPayment: PositiveMinor.optional(),
  categoryId: Id.optional(),
  status: z.enum(['active', 'paid', 'paused']).default('active'),
  /** Family-loan checklist */
  checklist: z
    .object({ writtenAgreement: z.boolean(), transferOnly: z.boolean(), fixedPaymentDay: z.number().int().min(1).max(31).optional() })
    .partial()
    .default({}),
  notes: z.string().default(''),
  /** Last balance confirmed with the creditor/statement. Health panel flags any gap vs derived. */
  confirmedBalance: z.object({ date: ISODateSchema, amount: z.number().int().nonnegative() }).optional(),
  /** Principal changes that didn't move money in the ledger (paid before tracking, forgiven, added). Positive = reduces the debt. */
  adjustments: z.array(z.object({ id: Id, date: ISODateSchema, amount: SignedMinor, note: z.string().default('') })).default([]),
  /** Pot where money is set aside to pay this debt (e.g. her loan fund). */
  fundPotId: Id.optional(),
  ...Timestamps,
});
export type Debt = z.infer<typeof DebtSchema>;

/** Borrowed from my own savings. NOT a liability in net worth — a "to replenish" obligation. */
export const SelfLoanSchema = z.object({
  id: Id,
  description: z.string().min(1),
  currency: CurrencySchema,
  amount: PositiveMinor,
  fromAccountId: Id.optional(),
  borrowedOn: ISODateSchema.optional(),
  plannedSource: z.string().default(''),
  plannedDate: ISODateSchema.optional(),
  status: z.enum(['open', 'replenished']).default('open'),
  notes: z.string().default(''),
  ...Timestamps,
});
export type SelfLoan = z.infer<typeof SelfLoanSchema>;

// ── Recurring ──────────────────────────────────────────────────────────────
export const ScheduleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('quincena') }), // 15th + last day
  z.object({ type: z.literal('monthly'), day: z.number().int().min(1).max(31) }), // clamps to month end
  z.object({ type: z.literal('weekly'), weekday: z.number().int().min(0).max(6) }),
  z.object({ type: z.literal('yearly'), month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31) }),
  /** Specific days every month, e.g. [1, 16] for BAC Ahorro Objetivo deductions. 31 = last day. */
  z.object({ type: z.literal('days'), days: z.array(z.number().int().min(1).max(31)).min(1).max(8) }),
]);

export const RecurringRuleSchema = z.object({
  id: Id,
  name: z.string().min(1),
  /** A transaction minus id/date/timestamps, used as the template for each occurrence. */
  template: z.record(z.unknown()),
  schedule: ScheduleSchema,
  mode: z.enum(['auto_post', 'remind']),
  startDate: ISODateSchema,
  endDate: ISODateSchema.optional(),
  /** Last occurrence auto-posted, so a deleted posting is never recreated. */
  lastHandledDate: ISODateSchema.optional(),
  /** Reminder occurrences the user chose to skip. */
  skipped: z.array(ISODateSchema).default([]),
  informational: z.boolean().default(false), // e.g. aporte patronal: tracked, not my cash
  active: z.boolean().default(true),
  ...Timestamps,
});
export type RecurringRule = z.infer<typeof RecurringRuleSchema>;

// ── Snapshots, budgets, goals, rates ───────────────────────────────────────
export const BalanceSnapshotSchema = z.object({
  id: Id, accountId: Id, date: ISODateSchema, balance: SignedMinor,
  source: z.enum(['statement', 'import', 'manual']), importBatchId: Id.optional(), ...Timestamps,
});
export type BalanceSnapshot = z.infer<typeof BalanceSnapshotSchema>;

export const BudgetSchema = z.object({
  id: Id, categoryId: Id,
  /** "2026-11", or "*" for the default monthly budget. */
  month: z.union([z.string().regex(/^\d{4}-\d{2}$/), z.literal('*')]),
  amount: z.number().int().nonnegative(), currency: CurrencySchema, rollover: z.boolean().default(false),
  ...Timestamps,
});
export type Budget = z.infer<typeof BudgetSchema>;

export const GoalSchema = z.object({
  id: Id, name: z.string().min(1), currency: CurrencySchema, target: PositiveMinor,
  targetDate: ISODateSchema.optional(), potId: Id.optional(), accountId: Id.optional(),
  plannedMonthly: PositiveMinor.optional(), archived: z.boolean().default(false), ...Timestamps,
});
export type Goal = z.infer<typeof GoalSchema>;

export const ExchangeRateSchema = z.object({
  id: Id, date: ISODateSchema,
  /** CRC céntimos per 1 USD. */
  buy: z.number().int().positive(), sell: z.number().int().positive(),
  source: z.enum(['BCCR', 'market', 'manual']), ...Timestamps,
});
export type ExchangeRate = z.infer<typeof ExchangeRateSchema>;

export const ImportBatchSchema = z.object({
  id: Id, fileName: z.string(), kind: z.enum(['workbook', 'statement', 'backup']),
  importedAt: z.number().int(),
  counts: z.record(z.number().int()),
  /** Ids created by this batch per table, so the whole batch can be undone. */
  created: z.record(z.array(z.string())).default({}),
  status: z.enum(['committed', 'undone']), ...Timestamps,
});
export type ImportBatch = z.infer<typeof ImportBatchSchema>;

export const AuditEntrySchema = z.object({
  id: z.number().int().optional(), at: z.number().int(),
  table: z.string(), recordId: z.string(), action: z.enum(['create', 'update', 'delete']),
  before: z.unknown().optional(), after: z.unknown().optional(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

// ── Tasa Cero (0% installment purchases on a credit card) ──────────────────
/**
 * One purchase split into N interest-free monthly cuotas. Each cuota posts as an
 * expense on the card account in the month it's billed (deterministic id, so it
 * can never be posted twice). Paying the card from checking is a transfer.
 * Not-yet-billed cuotas are a liability ("pending installments").
 */
export const InstallmentPlanSchema = z.object({
  id: Id,
  cardAccountId: Id,
  description: z.string().min(1),
  merchant: z.string().default(''),
  categoryId: Id,
  currency: CurrencySchema,
  total: PositiveMinor,
  months: z.number().int().min(1).max(60),
  purchaseDate: ISODateSchema,
  /** Date the first cuota is billed; later cuotas fall on the same day each month (clamped). */
  firstChargeDate: ISODateSchema,
  status: z.enum(['active', 'paid_off', 'cancelled']).default('active'),
  notes: z.string().default(''),
  ...Timestamps,
});
export type InstallmentPlan = z.infer<typeof InstallmentPlanSchema>;
