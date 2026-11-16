/**
 * Money moved between spending money and a fund (or a savings account) with the
 * "Transfer" kind counts as neither saving nor spending, so it never reaches the
 * budget. These helpers find such moves and turn them into proper savings records.
 */
import type { Category, Pot, Transaction } from './schemas';
import { isSavingsPlace, type FlowContext } from './ledger';

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
