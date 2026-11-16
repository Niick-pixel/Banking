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
import { usePersisted, usePersistedSet } from '../app/persist';
import { ChipGroup } from '../design/components/ChipGroup';

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
  const pMonth = params.get('month') ?? '', pDate = params.get('date') ?? '', pGroup = params.get('group') ?? '', pUncat = params.get('uncat') === '1';
  const [q, setQ] = usePersisted('tx.q', '');
  // Multi-select chip filters (remembered); a ?kind= from a chart click overrides them.
  const [kindsSaved, setKinds] = usePersisted<string[]>('tx.kinds', []);
  const kinds = params.get('kind') ? [params.get('kind')!] : kindsSaved;
  const setKind = (k: string) => setKinds(k ? [k] : []);
  const [accs, setAccs] = usePersisted<string[]>('tx.accs', []);
  const [groups, setGroups] = usePersisted<string[]>('tx.groups', []);
  const [catSaved, setCat] = usePersisted('tx.cat', '');
  const cat = params.get('cat') ?? catSaved;
  const [collapsed, toggleMonth] = usePersistedSet('tx.collapsed');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null);

  const filtered = useMemo(() => l.transactions.filter((t) => {
    if (kinds.length && !kinds.includes(t.kind)) return false;
    if (pDate && t.date !== pDate) return false;
    if (pUncat && !(t.kind === 'expense' && !t.categoryId && !t.splits?.length)) return false;
    if (pMonth && !t.date.startsWith(pMonth)) return false;
    if (pGroup && !('categoryId' in t && t.categoryId && l.category.get(t.categoryId)?.group === pGroup)) return false;
    if (accs.length && !accs.some((acc) => ('from' in t && t.from.accountId === acc) || ('to' in t && t.to.accountId === acc) || (t.kind === 'adjustment' && t.side.accountId === acc))) return false;
    if (groups.length && !('categoryId' in t && t.categoryId && groups.includes(l.category.get(t.categoryId)?.group ?? ''))) return false;
    if (cat && !('categoryId' in t && t.categoryId === cat) && !(t.kind === 'expense' && t.splits?.some((s) => s.categoryId === cat))) return false;
    if (q) {
      const s = q.toLowerCase();
      const c = 'categoryId' in t && t.categoryId ? l.category.get(t.categoryId)?.name ?? '' : '';
      if (!`${t.description} ${t.notes} ${c} ${t.tags.join(' ')}`.toLowerCase().includes(s)) return false;
    }
    return true;
  }), [l, q, kinds, accs, groups, cat, pDate, pMonth, pGroup, pUncat]);

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

  const selectedTx = l.transactions.filter((t) => selected.has(t.id));
  const selectedTotal = selectedTx.reduce((s, t) => s + (t.kind === 'income' ? t.amount : t.kind === 'adjustment' ? t.signedAmount : t.kind === 'expense' || t.kind === 'debt_payment' ? -t.amount : 0), 0);
  async function bulkAccount(accountId: string) {
    let n = 0;
    for (const t of selectedTx) {
      // Moves the spending side: where an expense or payment came from, where income landed.
      if (t.kind === 'expense' || t.kind === 'debt_payment') await saveTransaction({ ...t, from: { accountId } });
      else if (t.kind === 'income') await saveTransaction({ ...t, to: { accountId } });
      else continue;
      n++;
    }
    setSelected(new Set());
    setToast({ msg: `${n} movement(s) moved to ${l.account.get(accountId)?.name}` });
  }
  async function bulkDate(date: string) {
    if (!date) return;
    for (const t of selectedTx) await saveTransaction({ ...t, date, dateEstimated: false });
    setSelected(new Set());
    setToast({ msg: `${selectedTx.length} movement(s) now dated ${formatDateCR(date)}` });
  }
  async function bulkDelete() {
    if (!window.confirm(`Delete ${selectedTx.length} movement(s)? You can undo it right after.`)) return;
    const ids: number[] = [];
    for (const t of selectedTx) { await deleteTransaction(t.id); const id = await lastAuditId(); if (id) ids.push(id); }
    setSelected(new Set());
    setToast({ msg: `${selectedTx.length} movement(s) deleted`, undo: () => void (async () => { for (const id of ids.reverse()) await undoAudit(id); })() });
  }

  const placeName = (s: { accountId: string; potId?: string }) => `${l.account.get(s.accountId)?.name ?? '?'}${s.potId ? ` · ${l.pot.get(s.potId)?.name ?? ''}` : ''}`;

  return (
    <>
      <PageHeader title="Transactions" sub={`${filtered.length} of ${l.transactions.length} movements`}>
        <button className="btn btn-primary" onClick={() => qa.open()}>+ Add <kbd className="small" style={{ opacity: .7 }}>N</kbd></button>
      </PageHeader>

      {(pDate || pMonth || pGroup || pUncat) && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <span className="small muted">From a chart:</span>
          {pDate && <span className="chip" aria-pressed>Day {formatDateCR(pDate)}</span>}
          {pMonth && <span className="chip" aria-pressed>{pMonth.split('-').reverse().join('/')}</span>}
          {pGroup && <span className="chip" aria-pressed>{pGroup}</span>}
          {pUncat && <span className="chip" aria-pressed>No category</span>}
          <button className="btn btn-sm btn-ghost" onClick={() => { setParams({}, { replace: true }); setKind(''); setCat(''); }}>Clear ✕</button>
        </div>
      )}

      <div className="glass tx-filters" style={{ padding: 16, display: 'grid', gap: 14, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(200px, 1fr) auto', gap: 10, alignItems: 'center' }}>
          <input className="input" type="search" placeholder="Search description, notes, category…" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">All categories</option>{l.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" disabled={!q && !kinds.length && !accs.length && !groups.length && !cat} onClick={() => { setQ(''); setKinds([]); setAccs([]); setGroups([]); setCat(''); }}>Clear filters</button>
        </div>
        <div className="tx-chip-row">
          <ChipGroup<Transaction['kind']> multi size="sm" label="Kind" note="any" value={kinds as Transaction['kind'][]} onChange={setKinds}
            options={(Object.entries(KIND_LABEL) as [Transaction['kind'], string][]).map(([k, v]) => ({ value: k, label: v }))} />
          <ChipGroup<string> multi size="sm" label="Spending group" note="any" value={groups} onChange={setGroups}
            options={['Income', 'Fixed', 'Living', 'Discretionary', 'Debt Service', 'Savings'].map((g) => ({ value: g, label: g }))} />
          <ChipGroup<string> multi size="sm" label="Accounts" note="any" value={accs} onChange={setAccs}
            options={l.accounts.filter((a) => !a.archived).map((a) => ({ value: a.id, label: a.name.replace(/\s*\(.*\)$/, '') }))} />
        </div>
      </div>

      {selected.size > 0 && (
        <div className="glass glass-strong" style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, position: 'sticky', top: 12, zIndex: 5, flexWrap: 'wrap' }}>
          <b>{selected.size} selected</b>
          <span className="small muted">net <Money amount={selectedTotal} tone="auto" /></span>
          <select className="input" style={{ maxWidth: 240, height: 38 }} aria-label="Change category of the selected movements" value="" onChange={(e) => e.target.value && void bulkRecategorize(e.target.value)}>
            <option value="">Category…</option>{l.categories.filter((c) => !c.archived).map((c) => <option key={c.id} value={c.id}>{c.group} · {c.name}</option>)}
          </select>
          <select className="input" style={{ maxWidth: 220, height: 38 }} aria-label="Move the selected movements to another account" value="" onChange={(e) => e.target.value && void bulkAccount(e.target.value)}>
            <option value="">Account…</option>{l.accounts.filter((a) => !a.archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>Date <input type="date" className="input" style={{ height: 38, width: 160 }} aria-label="Set the date of the selected movements" onChange={(e) => void bulkDate(e.target.value)} /></label>
          <button className="btn btn-sm" style={{ color: 'var(--expense)' }} onClick={() => void bulkDelete()}>Delete</button>
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}

      <div style={{ display: 'grid', gap: 14 }}>
        {months.map(([mk, txs]) => {
          const f = l.flows.get(mk);
          const open = !collapsed.has(mk);
          return (
            <section key={mk} className="glass" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="month-head-row">
              <input type="checkbox" className="month-check" aria-label={`Select all of ${monthLabel(mk)}`} checked={txs.length > 0 && txs.every((t) => selected.has(t.id))}
                onChange={(e) => setSelected((s0) => { const n = new Set(s0); for (const t of txs) { if (e.target.checked) n.add(t.id); else n.delete(t.id); } return n; })} />
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
              </div>
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
