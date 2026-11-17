/**
 * Money moved between spending money and a fund (or a savings account) with the
 * "Transfer" kind counts as neither saving nor spending, so it never reaches the
 * budget. These helpers find such moves and turn them into proper savings records.
 */
import type { Category, Pot, Transaction } from './schemas';
import { isSavingsPlace, legs, type FlowContext } from './ledger';

type TransferTx = Extract<Transaction, { kind: 'transfer' }>;
type SavingsTx = Extract<Transaction, { kind: 'savings' }>;

/** The Savings category that matches whose money it is: Hers → "Savings - Hers…", otherwise "Mine". */
export function savingsCategoryFor(categories: Category[], owner?: Pot['owner']): Category | undefined {
  const cats = categories.filter((c) => c.group === 'Savings' && !c.archived);
  return (owner === 'hers' && cats.find((c) => /hers|her\b|ella|loan fund/i.test(c.name)))
    || (owner !== 'hers' && cats.find((c) => /mine|mío|mio/i.test(c.name)))
    || cats[0];
}

/** Direction a move between these two places has, if it crosses spending ↔ savings. */
export function crossesSavings(from: TransferTx['from'], to: TransferTx['to'], ctx: FlowContext): 'deposit' | 'withdrawal' | null {
  const f = isSavingsPlace(from, ctx), t = isSavingsPlace(to, ctx);
  if (f === t) return null;
  return t ? 'deposit' : 'withdrawal';
}

/** Transfers that put money into (or take it out of) savings without counting it. Same-currency only. */
export function uncountedFundMoves(txs: Transaction[], ctx: FlowContext): TransferTx[] {
  return txs.filter((t): t is TransferTx => t.kind === 'transfer' && !t.toAmount && crossesSavings(t.from, t.to, ctx) !== null);
}

/** The same move, recorded as savings so the budget and "saved" totals see it. */
export function asSavings(t: TransferTx, ctx: FlowContext, categories: Category[], pots: Pot[]): SavingsTx | null {
  const direction = crossesSavings(t.from, t.to, ctx);
  if (!direction) return null;
  const savingsSide = direction === 'deposit' ? t.to : t.from;
  const owner = pots.find((p) => p.id === savingsSide.potId)?.owner;
  const cat = savingsCategoryFor(categories, owner);
  if (!cat) return null;
  const { toAmount: _a, rateId: _r, ...rest } = t;
  return { ...rest, kind: 'savings', direction, categoryId: cat.id, updatedAt: Date.now() };
}

type SavingsTxT = Extract<Transaction, { kind: 'savings' }>;
/** Which fund a Savings category belongs to: "Savings - Hers…" → hers, "Savings - Mine" → mine. */
export function ownerOfCategory(c?: Category): Pot['owner'] | undefined {
  if (!c || c.group !== 'Savings') return undefined;
  if (/hers|her\b|ella|loan fund/i.test(c.name)) return 'hers';
  if (/mine|mío|mio/i.test(c.name)) return 'mine';
  return undefined;
}

/** Savings that went into (or out of) an account that has funds, but not into any fund, while the category says whose it is. */
export function unfundedSavings(txs: Transaction[], pots: Pot[], categories: Category[]): { tx: SavingsTxT; pot: Pot }[] {
  const cat = new Map(categories.map((c) => [c.id, c]));
  const out: { tx: SavingsTxT; pot: Pot }[] = [];
  for (const t of txs) {
    if (t.kind !== 'savings') continue;
    const side = t.direction === 'deposit' ? t.to : t.from;
    if (side.potId) continue;
    const owner = ownerOfCategory(cat.get(t.categoryId));
    if (!owner) continue;
    const pot = pots.find((p) => p.accountId === side.accountId && p.owner === owner && !p.archived);
    if (pot) out.push({ tx: t, pot });
  }
  return out;
}

export function intoFund(t: SavingsTxT, pot: Pot): SavingsTxT {
  return t.direction === 'deposit' ? { ...t, to: { accountId: pot.accountId, potId: pot.id }, updatedAt: Date.now() } : { ...t, from: { accountId: pot.accountId, potId: pot.id }, updatedAt: Date.now() };
}

export interface FundEntry {
  tx: Transaction;
  /** Signed: + money came into the fund, − went out. */
  amount: number;
  /** The other side of the move, when there is one (where it came from / went to). */
  other?: { accountId: string; potId?: string };
  /** Fund balance right after this movement. */
  after: number;
}

/**
 * Every movement that touched one fund, newest first, with the fund balance after each.
 * Uses the same rule as the balances: movements dated before the account's opening date don't count.
 */
export function fundActivity(potId: string, txs: Transaction[], openingDate: string): FundEntry[] {
  const rows: Omit<FundEntry, 'after'>[] = [];
  for (const tx of txs) {
    if (tx.date < openingDate) continue;
    const ls = legs(tx);
    const mine = ls.filter((g) => g.potId === potId);
    if (!mine.length) continue;
    const amount = mine.reduce((n, g) => n + g.amount, 0);
    const o = ls.find((g) => g.potId !== potId);
    const other = o ? { accountId: o.accountId, potId: o.potId } : undefined;
    if (amount !== 0) rows.push({ tx, amount, other });
  }
  rows.sort((a, b) => a.tx.date.localeCompare(b.tx.date) || a.tx.createdAt - b.tx.createdAt);
  let run = 0;
  const out = rows.map((r) => ({ ...r, after: (run += r.amount) }));
  return out.reverse();
}

/**
 * Make one fund match the bank. `diff` = bank − app for the account (céntimos).
 * - 'saved': you moved it from an everyday account → a Savings record (counts as saved in the budget).
 * - 'correct': it's interest or a correction → an adjustment on the fund (not income, not spending).
 */
export function bankMatchTx(o: {
  diff: number; accountId: string; potId?: string; mode: 'saved' | 'correct';
  spendingAccountId?: string; categoryId?: string; date: string; currency: Transaction['currency']; id: string; now: number;
}): Transaction | null {
  if (!o.diff) return null;
  const base = { id: o.id, date: o.date, dateEstimated: false, currency: o.currency, tags: ['bank-match'], notes: '', createdAt: o.now, updatedAt: o.now };
  const fund = { accountId: o.accountId, ...(o.potId ? { potId: o.potId } : {}) };
  if (o.mode === 'saved' && o.spendingAccountId && o.categoryId) {
    const deposit = o.diff > 0;
    return { ...base, kind: 'savings', direction: deposit ? 'deposit' : 'withdrawal', categoryId: o.categoryId, amount: Math.abs(o.diff),
      from: deposit ? { accountId: o.spendingAccountId } : fund, to: deposit ? fund : { accountId: o.spendingAccountId },
      description: deposit ? 'Saved (matched to the bank)' : 'Taken out (matched to the bank)' } as Transaction;
  }
  return { ...base, kind: 'adjustment', side: fund, signedAmount: o.diff, reason: 'Matched to the bank balance', description: 'Matched to the bank' } as Transaction;
}
