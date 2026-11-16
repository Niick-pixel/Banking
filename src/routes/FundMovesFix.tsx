/** Lists transfers into/out of savings that the budget can't see, with a one-tap fix. */
import { useMemo, useState } from 'react';
import { useLedger } from '../app/data';
import { Glass } from '../design/components';
import { asSavings, uncountedFundMoves } from '../domain/fundmoves';
import type { FlowContext } from '../domain/ledger';
import { saveTransaction } from '../db/repo';
import { formatMoney } from '../lib/money';
import { formatDateCR } from '../lib/dates';

export function useFundMoves() {
  const l = useLedger();
  return useMemo(() => {
    const ctx: FlowContext = { accountType: (id) => l.account.get(id)?.type };
    const place = (s: { accountId: string; potId?: string }) => `${l.account.get(s.accountId)?.name ?? '?'}${s.potId ? ` · ${l.pot.get(s.potId)?.name ?? '?'}` : ''}`;
    const items = uncountedFundMoves(l.transactions, ctx).map((t) => ({ tx: t, fixed: asSavings(t, ctx, l.categories, l.pots), label: `${place(t.from)} → ${place(t.to)}` }));
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
        <b>{items.length} move{items.length > 1 ? 's' : ''} into or out of savings {items.length > 1 ? "don't" : "doesn't"} show in your budget</b>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void run()}>Count {items.length > 1 ? 'all' : 'it'} as savings</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>They were saved as transfers, which count as neither saving nor spending. That's why the fund changed but the Budget's Savings rows didn't.</p>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
        {items.slice(0, 8).map((i) => (
          <li key={i.tx.id} className="small">
            <b className="money">{formatMoney(i.tx.amount, 'CRC')}</b> on {formatDateCR(i.tx.date)} · {i.label}{i.tx.description ? ` · “${i.tx.description}”` : ''}
            {i.fixed && <> → <span className="muted">{i.fixed.direction === 'deposit' ? 'saved' : 'taken out'} under {categoryName(i.fixed.categoryId)}</span> <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void run([i.tx.id])}>Fix</button></>}
          </li>
        ))}
      </ul>
    </Glass>
  );
}
