/** Lists transfers into/out of savings that the budget can't see, with a one-tap fix. */
import { useMemo, useState } from 'react';
import { useLedger } from '../app/data';
import { Glass } from '../design/components';
import { asSavings, intoFund, uncountedFundMoves, unfundedSavings } from '../domain/fundmoves';
import type { Transaction } from '../domain/schemas';
import type { FlowContext } from '../domain/ledger';
import { saveTransaction } from '../db/repo';
import { formatMoney } from '../lib/money';
import { formatDateCR } from '../lib/dates';

export function useFundMoves() {
  const l = useLedger();
  return useMemo(() => {
    const ctx: FlowContext = { accountType: (id) => l.account.get(id)?.type };
    const place = (s: { accountId: string; potId?: string }) => `${l.account.get(s.accountId)?.name ?? '?'}${s.potId ? ` · ${l.pot.get(s.potId)?.name ?? '?'}` : ''}`;
    const items = [
      ...uncountedFundMoves(l.transactions, ctx).map((t) => ({ tx: t as Transaction & { amount: number }, fixed: asSavings(t, ctx, l.categories, l.pots) as Transaction | null, label: `${place(t.from)} → ${place(t.to)}`, why: 'transfer' as const })),
      // Savings put into an account with funds but not into the fund its category belongs to.
      ...unfundedSavings(l.transactions, l.pots, l.categories).map(({ tx, pot }) => ({ tx: tx as Transaction & { amount: number }, fixed: intoFund(tx, pot) as Transaction | null, label: `${place(tx.direction === 'deposit' ? tx.to : tx.from)} → should be in ${pot.name}`, why: 'fund' as const })),
    ];
    const fix = async (ids?: string[]) => { for (const i of items) if (i.fixed && (!ids || ids.includes(i.tx.id))) await saveTransaction(i.fixed); };
    return { items, fix, categoryName: (id: string) => l.category.get(id)?.name ?? '' };
  }, [l]);
}

export function FundMovesFix() {
  const { items, fix, categoryName } = useFundMoves();
  const [busy, setBusy] = useState(false);
  if (!items.length) return null;
  const run = async (ids?: string[]) => { setBusy(true); try { await fix(ids); } finally { setBusy(false); } };
  return (
    <Glass strong pad={18} style={{ marginBottom: 16, display: 'grid', gap: 10, borderColor: 'var(--debt)' }} role="region" aria-label="Moves the budget can't see">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <b>{items.length} savings movement{items.length > 1 ? 's' : ''} {items.length > 1 ? 'are' : 'is'} not where {items.length > 1 ? 'they' : 'it'} should be</b>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void run()}>Fix {items.length > 1 ? 'all' : 'it'}</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>{items.some((i) => i.why === 'fund') ? 'Some went into the savings account but not into the fund their category belongs to (Mine, Hers), so the fund didn\'t grow. ' : ''}{items.some((i) => i.why === 'transfer') ? 'Some were saved as transfers, which count as neither saving nor spending, so the budget didn\'t see them.' : ''}</p>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
        {items.slice(0, 8).map((i) => (
          <li key={i.tx.id} className="small">
            <b className="money">{formatMoney(i.tx.amount, 'CRC')}</b> on {formatDateCR(i.tx.date)} · {i.label}{i.tx.description ? ` · “${i.tx.description}”` : ''}
            {i.fixed && i.why === 'transfer' && i.fixed.kind === 'savings' && <> → <span className="muted">{i.fixed.direction === 'deposit' ? 'saved' : 'taken out'} under {categoryName(i.fixed.categoryId)}</span></>}
            {i.fixed && <> <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void run([i.tx.id])}>Fix</button></>}
          </li>
        ))}
      </ul>
    </Glass>
  );
}
