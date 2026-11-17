/**
 * Funds → "Latest movements": for each fund, every movement that changed it, newest
 * first, with the balance right after. This is how you check that a deposit really
 * landed in Mine or Hers. Tap a row to open it.
 */
import { useMemo, useState } from 'react';
import { useLedger } from '../app/data';
import { useQuickAdd } from '../app/QuickAdd';
import { Glass } from '../design/components';
import { InfoTip } from '../design/components/InfoTip';
import { fundActivity, unfundedSavings, type FundEntry } from '../domain/fundmoves';
import type { Transaction } from '../domain/schemas';
import { formatMoney } from '../lib/money';
import { formatDateCR } from '../lib/dates';

const KIND: Record<Transaction['kind'], string> = { income: 'Income', expense: 'Spent', transfer: 'Moved', savings: 'Saved', debt_payment: 'Debt payment', adjustment: 'Adjustment' };
const SHOW = 6;

export function FundActivity() {
  const l = useLedger();
  const qa = useQuickAdd();
  const [open, setOpen] = useState<string | null>(null);
  const RANK = { mine: 0, hers: 1, shared: 2 } as const;
  const pots = l.pots.filter((p) => !p.archived).sort((a, b) => RANK[a.owner] - RANK[b.owner] || a.name.localeCompare(b.name));
  const lists = useMemo(() => {
    const missed = unfundedSavings(l.transactions, l.pots, l.categories);
    return pots.map((p) => ({
      pot: p,
      rows: fundActivity(p.id, l.transactions, l.account.get(p.accountId)?.openingDate ?? '0000-01-01'),
      missed: missed.filter((m) => m.pot.id === p.id).length,
    }));
  }, [l]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pots.length) return null;

  const place = (s?: FundEntry['other']) => {
    if (!s) return '';
    const a = l.account.get(s.accountId)?.name.replace(/\s*\((checking|savings)\)$/i, '').replace(/^Association\s*-\s*/i, 'Assoc. ') ?? '?';
    return s.potId ? `${a} · ${l.pot.get(s.potId)?.name ?? '?'}` : a;
  };
  const label = (e: FundEntry) => {
    const t = e.tx;
    const cat = 'categoryId' in t && t.categoryId ? l.category.get(t.categoryId)?.name : undefined;
    const kind = t.kind === 'savings' ? (t.direction === 'deposit' ? 'Saved' : 'Taken out') : KIND[t.kind];
    return t.description || cat || kind;
  };

  return (
    <Glass strong pad={16} style={{ display: 'grid', gap: 12, marginBottom: 16 }} role="region" aria-label="Latest movements by fund">
      <h2 className="card-h" style={{ margin: 0 }}>Latest movements by fund
        <InfoTip text="Everything that changed each fund, newest first, with the fund's balance right after. If a deposit you made isn't here, it went into the account but not into the fund: the banner above (or the note under a fund) fixes it. Tap a row to open or edit it." />
      </h2>
      <div className="fund-acts" style={{ ['--cols' as string]: Math.min(lists.length, 3) }}>
        {lists.map(({ pot, rows, missed }) => {
          const all = open === pot.id;
          const shown = all ? rows : rows.slice(0, SHOW);
          return (
            <section key={pot.id} className="fund-act" aria-label={`${pot.name} movements`}>
              <header className="fund-act-head">
                <b style={{ color: `var(--${pot.owner})` }}>● {pot.name}</b>
                <span className="n">n {rows.length}</span>
                <span className="money" style={{ marginLeft: 'auto', fontWeight: 650 }}>{formatMoney(rows[0]?.after ?? 0, 'CRC')}</span>
              </header>
              <div className={all ? 'scroll-box fund-act-list open' : 'fund-act-list'} tabIndex={all ? 0 : undefined}>
                {shown.length === 0 && <p className="small faint" style={{ margin: '6px 0' }}>Nothing has gone into {pot.name} yet.</p>}
                {shown.map((e) => (
                  <button key={e.tx.id} type="button" className="fund-act-row" onClick={() => qa.open(e.tx)} title="Open this movement">
                    <span className="small faint fund-act-date">{formatDateCR(e.tx.date).slice(0, 5)}</span>
                    <span className="fund-act-what">
                      <span className="fund-act-label">{label(e)}</span>
                      <span className="small faint fund-act-other">{e.other ? `${e.amount > 0 ? 'from' : 'to'} ${place(e.other)}` : KIND[e.tx.kind]}</span>
                    </span>
                    <span className="fund-act-amt">
                      <b className="money" style={{ color: e.amount > 0 ? 'rgb(var(--win))' : 'rgb(var(--loss))' }}>{e.amount > 0 ? '+' : '−'}{formatMoney(Math.abs(e.amount), 'CRC')}</b>
                      <span className="small faint money">{formatMoney(e.after, 'CRC')}</span>
                    </span>
                  </button>
                ))}
              </div>
              <footer className="fund-act-foot">
                {rows.length > SHOW && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(all ? null : pot.id)}>{all ? 'Show latest only' : `Show all ${rows.length}`}</button>}
                {missed > 0 && <span className="small" style={{ color: 'rgb(var(--amber))' }}>{missed} saving{missed > 1 ? 's' : ''} for {pot.name} not in the fund yet · use Fix above</span>}
              </footer>
            </section>
          );
        })}
      </div>
    </Glass>
  );
}
