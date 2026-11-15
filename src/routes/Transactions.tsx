import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLedger } from '../app/data';
import { useQuickAdd } from '../app/QuickAdd';
import { Money, Pill } from '../design/components';
import { Empty, PageHeader, Toast } from '../ui/Sheet';
import { formatDateCR, monthKey } from '../lib/dates';
import { deleteTransaction, lastAuditId, saveTransaction, undoAudit } from '../db/repo';
import type { Transaction } from '../domain/schemas';
import { formatMoney, type Minor } from '../lib/money';
import { StartFresh } from './Accounts';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (mk: string) => `${MONTH_NAMES[Number(mk.slice(5)) - 1]} ${mk.slice(0, 4)}`;

const KIND_LABEL: Record<Transaction['kind'], string> = {
  income: 'Income', expense: 'Expense', transfer: 'Transfer', savings: 'Savings', debt_payment: 'Debt payment', adjustment: 'Adjustment',
};

export default function Transactions() {
  const l = useLedger();
  const qa = useQuickAdd();
  // Filters can arrive in the URL from a chart click: ?month=2026-11&group=Living, ?date=2026-11-03, ?kind=income
  const [params, setParams] = useSearchParams();
  const pMonth = params.get('month') ?? '', pDate = params.get('date') ?? '', pGroup = params.get('group') ?? '';
  const [q, setQ] = useState('');
  const [kind, setKind] = useState(params.get('kind') ?? '');
  const [acc, setAcc] = useState('');
  const [cat, setCat] = useState(params.get('cat') ?? '');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null);

  const filtered = useMemo(() => l.transactions.filter((t) => {
    if (kind && t.kind !== kind) return false;
    if (pDate && t.date !== pDate) return false;
    if (pMonth && !t.date.startsWith(pMonth)) return false;
    if (pGroup && !('categoryId' in t && t.categoryId && l.category.get(t.categoryId)?.group === pGroup)) return false;
    if (acc && !(('from' in t && t.from.accountId === acc) || ('to' in t && t.to.accountId === acc) || (t.kind === 'adjustment' && t.side.accountId === acc))) return false;
    if (cat && !('categoryId' in t && t.categoryId === cat) && !(t.kind === 'expense' && t.splits?.some((s) => s.categoryId === cat))) return false;
    if (q) {
      const s = q.toLowerCase();
      const c = 'categoryId' in t && t.categoryId ? l.category.get(t.categoryId)?.name ?? '' : '';
      if (!`${t.description} ${t.notes} ${c} ${t.tags.join(' ')}`.toLowerCase().includes(s)) return false;
    }
    return true;
  }), [l, q, kind, acc, cat, pDate, pMonth, pGroup]);

  const months = useMemo(() => {
    const m = new Map<string, Transaction[]>();
    for (const t of filtered) { const k = monthKey(t.date); m.set(k, [...(m.get(k) ?? []), t]); }
    return [...m.entries()];
  }, [filtered]);

  if (l.ready && !l.accounts.length) {
    return (
      <>
        <PageHeader title="Transactions" />
        <Empty title="No data yet">
          <p className="muted" style={{ margin: 0 }}>Import your workbook to start with your full history, or start fresh.</p>
          <div style={{ display: 'flex', gap: 10 }}><Link className="btn btn-primary" to="/import">Import workbook</Link><StartFresh /></div>
        </Empty>
      </>
    );
  }

  const toggleMonth = (k: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function del(t: Transaction) {
    await deleteTransaction(t.id);
    const id = await lastAuditId();
    setToast({ msg: 'Movement deleted', undo: () => id && void undoAudit(id) });
  }
  async function bulkRecategorize(categoryId: string) {
    const target = l.category.get(categoryId);
    if (!target) return;
    let n = 0;
    for (const id of selected) {
      const t = l.transactions.find((x) => x.id === id);
      if (!t || t.kind === 'transfer' || t.kind === 'adjustment') continue;
      await saveTransaction(t.kind === 'expense' ? { ...t, categoryId, splits: undefined } : { ...t, categoryId });
      n++;
    }
    setSelected(new Set());
    setToast({ msg: `${n} movement(s) moved to ${target.name}` });
  }

  const placeName = (s: { accountId: string; potId?: string }) => `${l.account.get(s.accountId)?.name ?? '?'}${s.potId ? ` · ${l.pot.get(s.potId)?.name ?? ''}` : ''}`;

  return (
    <>
      <PageHeader title="Transactions" sub={`${filtered.length} of ${l.transactions.length} movements`}>
        <button className="btn btn-primary" onClick={() => qa.open()}>+ Add <kbd className="small" style={{ opacity: .7 }}>N</kbd></button>
      </PageHeader>

      {(pDate || pMonth || pGroup) && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <span className="small muted">From a chart:</span>
          {pDate && <span className="chip" aria-pressed>Day {formatDateCR(pDate)}</span>}
          {pMonth && <span className="chip" aria-pressed>{pMonth.split('-').reverse().join('/')}</span>}
          {pGroup && <span className="chip" aria-pressed>{pGroup}</span>}
          <button className="btn btn-sm btn-ghost" onClick={() => { setParams({}, { replace: true }); setKind(''); setCat(''); }}>Clear ✕</button>
        </div>
      )}

      <div className="glass" style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 16 }}>
        <input className="input" type="search" placeholder="Search description, notes, category…" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All kinds</option>{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input" aria-label="Account" value={acc} onChange={(e) => setAcc(e.target.value)}>
          <option value="">All accounts</option>{l.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className="input" aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>{l.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {selected.size > 0 && (
        <div className="glass glass-strong" style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, position: 'sticky', top: 12, zIndex: 5, flexWrap: 'wrap' }}>
          <b>{selected.size} selected</b>
          <select className="input" style={{ maxWidth: 280 }} aria-label="Move selected to category" defaultValue="" onChange={(e) => e.target.value && void bulkRecategorize(e.target.value)}>
            <option value="">Change category to…</option>{l.categories.map((c) => <option key={c.id} value={c.id}>{c.group} · {c.name}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <div style={{ display: 'grid', gap: 14 }}>
        {months.map(([mk, txs]) => {
          const f = l.flows.get(mk);
          const open = !collapsed.has(mk);
          return (
            <section key={mk} className="glass" style={{ padding: 0, overflow: 'hidden' }}>
              <button className="month-head" aria-expanded={open} onClick={() => toggleMonth(mk)}>
                <span className="chev" aria-hidden>{open ? '▾' : '▸'}</span>
                <span style={{ fontWeight: 700, fontSize: 17 }}>{monthLabel(mk)}</span>
                <span className="muted small">{txs.length}</span>
                {f && (
                  <span className="month-totals">
                    <span>In <Money amount={f.income} tone="income" /></span>
                    <span>Out <Money amount={f.expenses} tone="expense" /></span>
                    <span>Saved <Money amount={f.saved} tone="savings" /></span>
                    <span>Free <Money amount={f.freeCash} tone="auto" /></span>
                  </span>
                )}
              </button>
              {open && (
                <ul className="tx-list">
                  {txs.map((t) => {
                    const c = 'categoryId' in t && t.categoryId ? l.category.get(t.categoryId) : undefined;
                    const amt = t.kind === 'adjustment' ? t.signedAmount : t.amount;
                    const tone = t.kind === 'income' ? 'income' : t.kind === 'savings' ? 'savings' : t.kind === 'transfer' ? 'neutral' : t.kind === 'debt_payment' ? 'debt' : 'expense';
                    const where = t.kind === 'transfer' || t.kind === 'savings' ? `${placeName(t.from)} → ${placeName(t.to)}`
                      : t.kind === 'income' ? placeName(t.to) : t.kind === 'adjustment' ? placeName(t.side) : placeName(t.from);
                    return (
                      <li key={t.id} className="tx-row">
                        <input type="checkbox" aria-label={`Select ${t.description || c?.name}`} checked={selected.has(t.id)} onChange={() => toggleSel(t.id)} />
                        <button className="tx-main" onClick={() => qa.open(t)}>
                          <span className="tx-desc">{t.description || c?.name || KIND_LABEL[t.kind]}</span>
                          <span className="tx-meta small muted">
                            {formatDateCR(t.date)}{t.dateEstimated && <span title="No date in the workbook: placed on the last day of the month"> · est.</span>}
                            {' · '}{c?.name ?? KIND_LABEL[t.kind]}{' · '}{where}
                            {t.kind === 'debt_payment' && <> · {l.debts.find((d) => d.id === t.debtId)?.creditor}</>}
                            {t.fx && <> · <span title={`${t.fx.source === 'BCCR' ? 'BCCR' : t.fx.source === 'market' ? 'Market' : 'Your'} rate of ${formatDateCR(t.fx.rateDate)}`}>{formatMoney(t.fx.amount as Minor, 'USD')} @ ₡{(t.fx.rate / 100).toFixed(2)}</span></>}
                          </span>
                        </button>
                        {t.tags.includes('tasa-cero') && <Pill tone="debt">Tasa 0</Pill>}
                        {t.tags.includes('migrated-summary') && <Pill>summary</Pill>}
                        <span className="tx-amt"><Money amount={amt} tone={tone} signed={t.kind === 'income'} /></span>
                        <button className="btn btn-ghost btn-sm" aria-label="Delete" onClick={() => void del(t)}>✕</button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {toast && <Toast message={toast.msg} action={toast.undo ? 'Undo' : undefined} onAction={toast.undo} onDone={() => setToast(null)} />}
    </>
  );
}
