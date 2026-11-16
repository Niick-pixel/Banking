import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Sheet, Toast } from '../ui/Sheet';
import { Segmented } from '../design/components';
import { useLedger, suggestCategories, type Ledger } from './data';
import { convert, formatMoney, parseAmountInput, type Minor } from '../lib/money';
import { rateForDay } from './fx';
import { useCoach } from './coach';
import { hoursOfWork } from '../coach/forecast';
import { guessCategory } from '../coach/autocat';
import type { RateSource } from '../fx/rates';
import { todayISO } from '../lib/dates';
import { TransactionSchema, type FxInfo, type Side, type Transaction } from '../domain/schemas';
import { lastAuditId, newId, saveTransaction, undoAudit } from '../db/repo';

type Kind = 'expense' | 'income' | 'transfer' | 'savings' | 'debt_payment';
interface Ctx { open: (tx?: Transaction) => void }
const QuickAddCtx = createContext<Ctx>({ open: () => {} });
export const useQuickAdd = () => useContext(QuickAddCtx);

const sideKey = (s?: Side) => (s ? `${s.accountId}|${s.potId ?? ''}` : '');
const keySide = (k: string): Side | undefined => {
  if (!k) return undefined;
  const [accountId, potId] = k.split('|');
  return potId ? { accountId: accountId!, potId } : { accountId: accountId! };
};

export function places(l: Ledger) {
  const out: { key: string; label: string; savings: boolean }[] = [];
  for (const a of l.accounts.filter((x) => !x.archived)) {
    const isSav = !['checking', 'cash', 'credit_card'].includes(a.type);
    out.push({ key: sideKey({ accountId: a.id }), label: a.name, savings: isSav });
    for (const p of l.pots.filter((p) => p.accountId === a.id && !p.archived)) {
      out.push({ key: sideKey({ accountId: a.id, potId: p.id }), label: `${a.name} · ${p.name}`, savings: true });
    }
  }
  return out;
}

export function QuickAddProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; edit?: Transaction }>({ open: false });
  const open = useCallback((tx?: Transaction) => setState({ open: true, edit: tx }), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); open(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <QuickAddCtx.Provider value={{ open }}>
      {children}
      <Sheet open={state.open} onClose={() => setState({ open: false })} title={state.edit ? 'Edit movement' : 'Quick add'}>
        {state.open && <QuickAddForm edit={state.edit} onDone={() => setState({ open: false })} />}
      </Sheet>
    </QuickAddCtx.Provider>
  );
}

function QuickAddForm({ edit, onDone }: { edit?: Transaction; onDone: () => void }) {
  const l = useLedger();
  const plc = useMemo(() => places(l), [l]);
  const spending = plc.find((p) => !p.savings)?.key ?? plc[0]?.key ?? '';
  const firstSavings = plc.find((p) => p.savings)?.key ?? '';

  const initKind: Kind = edit && edit.kind !== 'adjustment' ? edit.kind : 'expense';
  const [kind, setKind] = useState<Kind>(initKind);
  const [amountRaw, setAmountRaw] = useState(edit && 'amount' in edit ? String(edit.amount / 100) : '');
  const [description, setDescription] = useState(edit?.description ?? '');
  const [categoryId, setCategoryId] = useState(edit && 'categoryId' in edit ? edit.categoryId ?? '' : '');
  const [date, setDate] = useState(edit?.date ?? todayISO());
  const [direction, setDirection] = useState<'deposit' | 'withdrawal'>(edit?.kind === 'savings' ? edit.direction : 'deposit');
  const [from, setFrom] = useState(edit && 'from' in edit ? sideKey(edit.from) : spending);
  const [to, setTo] = useState(edit && 'to' in edit ? sideKey(edit.to) : firstSavings);
  const [debtId, setDebtId] = useState(edit?.kind === 'debt_payment' ? edit.debtId : l.debts.find((d) => d.status === 'active')?.id ?? '');
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ msg: string; auditId?: number } | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const coach = useCoach();

  // Dollar expenses: type dollars, convert at the rate of the expense's day.
  const [cur, setCur] = useState<'CRC' | 'USD'>(edit?.fx ? 'USD' : 'CRC');
  const [usdRaw, setUsdRaw] = useState(edit?.fx ? String(edit.fx.amount / 100) : '');
  const [rateRaw, setRateRaw] = useState(edit?.fx ? String(edit.fx.rate / 100) : '');
  const [quote, setQuote] = useState<{ source: RateSource; rateDate: string; side: 'sell' | 'buy' } | null>(edit?.fx ? { source: edit.fx.source, rateDate: edit.fx.rateDate, side: edit.fx.side } : null);
  const [rateState, setRateState] = useState<'idle' | 'loading' | 'none'>('idle');
  const usdMode = cur === 'USD' && kind === 'expense';
  const usd = parseAmountInput(usdRaw, 'USD');
  const rate = parseAmountInput(rateRaw, 'CRC');
  const converted = usd && rate ? convert(usd, 'USD', 'CRC', rate) : null;
  useEffect(() => {
    if (!usdMode) return;
    if (edit?.fx && edit.date === date && rateRaw) return; // keep the saved rate when editing
    let cancelled = false;
    setRateState('loading');
    void rateForDay(date).then((q) => {
      if (cancelled) return;
      if (q) { setRateRaw(String(q.rate / 100)); setQuote({ source: q.source, rateDate: q.rateDate, side: q.side }); setRateState('idle'); }
      else { setQuote(null); setRateState('none'); }
    }).catch(() => { if (!cancelled) { setQuote(null); setRateState('none'); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usdMode, date]);

  const amount = usdMode ? converted : parseAmountInput(amountRaw, 'CRC');
  const wantGroups: Record<Kind, string[]> = {
    expense: ['Fixed', 'Living', 'Discretionary', 'Debt Service'], income: ['Income'], transfer: [], savings: ['Savings'], debt_payment: ['Debt Service'],
  };
  const cats = l.categories.filter((c) => !c.archived && wantGroups[kind].includes(c.group));
  // Learned from your history: ≥ 90% sure → picked for you; 60–90% → suggested first.
  const guess = useMemo(() => (description.trim().length >= 3 ? guessCategory(l.transactions, description, kind) : null), [l.transactions, description, kind]);
  const [autoPicked, setAutoPicked] = useState(false);
  useEffect(() => {
    if (edit || !guess || guess.mode !== 'auto' || !cats.some((c) => c.id === guess.categoryId)) return;
    if (!categoryId || autoPicked) { setCategoryId(guess.categoryId); setAutoPicked(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guess?.categoryId, guess?.mode]);
  const suggested = suggestCategories(l.transactions, description, kind).filter((id) => cats.some((c) => c.id === id)).slice(0, 5);

  // Keep from/to sensible when switching kind.
  useEffect(() => {
    if (edit) return;
    if (kind === 'savings') { setFrom(direction === 'deposit' ? spending : firstSavings); setTo(direction === 'deposit' ? firstSavings : spending); }
    else if (kind === 'transfer') { setFrom(spending); setTo(plc.find((p) => p.key !== spending)?.key ?? ''); }
    else { setFrom(spending); }
    setCategoryId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, direction]);

  async function submit(again: boolean) {
    setError('');
    if (usdMode && !usd) { setError('Enter the amount in dollars, e.g. 19.99'); amountRef.current?.focus(); return; }
    if (usdMode && !rate) { setError('Enter the exchange rate (colones per dollar)'); return; }
    if (!amount) { setError('Enter an amount, e.g. 12500 or 12.5k'); amountRef.current?.focus(); return; }
    const fx: FxInfo | undefined = usdMode && usd && rate ? {
      currency: 'USD', amount: usd, rate,
      rateDate: quote && quote.source !== 'manual' ? quote.rateDate : date,
      source: quote?.source ?? 'manual', side: quote?.side ?? 'sell',
    } : undefined;
    // Spending cap set from a Coach alert: confirm before going over today's cap.
    const cap = kind === 'expense' && categoryId ? coach?.state.caps.find((c) => c.categoryId === categoryId && c.month === date.slice(0, 7)) : undefined;
    if (cap && !edit) {
      const todaySpent = l.transactions.filter((t) => t.kind === 'expense' && t.categoryId === categoryId && t.date === date).reduce((s, t) => s + (t.kind === 'expense' ? t.amount : 0), 0);
      const over = todaySpent + amount - cap.dailyCap;
      if (over > 0 && !confirm(`This puts you ${formatMoney(over as Minor, 'CRC', { decimals: 0 })} over your ${formatMoney(cap.dailyCap as Minor, 'CRC', { decimals: 0 })}/day cap for ${l.category.get(categoryId)?.name}. Continue?`)) return;
    }
    const now = Date.now();
    const base = {
      id: edit?.id ?? newId(), date, dateEstimated: edit && edit.date === date ? edit.dateEstimated : false, currency: 'CRC' as const,
      description: description.trim(), tags: edit?.tags ?? [], notes: edit?.notes ?? '', importBatchId: edit?.importBatchId,
      createdAt: edit?.createdAt ?? now, updatedAt: now, fx,
    };
    const f = keySide(from), t = keySide(to);
    let tx: unknown;
    switch (kind) {
      case 'expense': tx = { ...base, kind, from: f, amount, categoryId: categoryId || undefined }; break;
      case 'income': tx = { ...base, kind, to: f, amount, categoryId }; break;
      case 'transfer': tx = { ...base, kind, from: f, to: t, amount }; break;
      case 'savings': tx = { ...base, kind, direction, from: f, to: t, amount, categoryId }; break;
      case 'debt_payment': tx = { ...base, kind, from: f, amount, debtId, categoryId, interestPortion: 0 }; break;
    }
    const parsed = TransactionSchema.safeParse(tx);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => (i.path.join('.') === 'categoryId' ? 'Pick a category' : i.path[0] === 'debtId' ? 'Pick a debt' : i.message)).join(' · ');
      setError(msg); return;
    }
    await saveTransaction(parsed.data);
    const auditId = await lastAuditId();
    if (again) {
      setAmountRaw(''); setUsdRaw(''); setDescription(''); setCategoryId('');
      setToast({ msg: `Saved ${formatMoney(amount, 'CRC')}${fx ? ` (${formatMoney(fx.amount as Minor, 'USD')})` : ''}`, auditId });
      amountRef.current?.focus();
    } else onDone();
  }

  const placeSelect = (id: string, label: string, value: string, set: (v: string) => void, filter?: (p: (typeof plc)[number]) => boolean) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="input" value={value} onChange={(e) => set(e.target.value)}>
        {plc.filter(filter ?? (() => true)).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
      </select>
    </div>
  );

  if (!l.accounts.length) return <p className="muted">Add an account or import your workbook first.</p>;

  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(false); }} style={{ display: 'grid', gap: 14 }}>
      <Segmented<Kind> label="Kind" value={kind} onChange={setKind} options={[
        { value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }, { value: 'savings', label: 'Savings' },
        { value: 'transfer', label: 'Transfer' }, { value: 'debt_payment', label: 'Debt' },
      ]} />
      {usdMode ? (
        <div className="field">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end' }}>
            <label htmlFor="qa-amount">Amount in dollars</label>
            <CurrencySwitch value={cur} onChange={setCur} />
          </div>
          <input id="qa-amount" ref={amountRef} data-autofocus className="input input-amount" inputMode="decimal" autoComplete="off" placeholder="$0.00"
            value={usdRaw} onChange={(e) => setUsdRaw(e.target.value)} aria-invalid={!!usdRaw && !usd} />
          <div className="fx-calc" aria-live="polite">
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="qa-fx-date">Date of the purchase</label>
              <input id="qa-fx-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="qa-rate">Rate (₡ per $1)</label>
              <input id="qa-rate" className="input" inputMode="decimal" value={rateRaw} placeholder={rateState === 'loading' ? 'Getting the rate…' : 'e.g. 506.43'}
                onChange={(e) => { setRateRaw(e.target.value); setRateState('idle'); setQuote({ source: 'manual', rateDate: date, side: quote?.side ?? 'sell' }); }} />
            </div>
            <div className="fx-result">
              <span className="small muted">In colones</span>
              <b className="money" style={{ fontSize: 22 }}>{converted ? formatMoney(converted, 'CRC', { decimals: 2 }) : '—'}</b>
              <span className="small muted">{rateState === 'loading' ? 'Getting the rate for that day…'
                : rateState === 'none' && (!quote || quote.source === 'manual') && !rateRaw ? 'No rate available offline: type it from your statement.'
                : quote ? `${quote.source === 'BCCR' ? `BCCR ${quote.side === 'buy' ? 'buy' : 'sell'} rate` : quote.source === 'market' ? 'Market rate' : 'Your rate'}${quote.source !== 'manual' ? ` of ${quote.rateDate.split('-').reverse().join('/')}` : ''}` : ''}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="field">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end' }}>
            <label htmlFor="qa-amount">Amount</label>
            {kind === 'expense' && <CurrencySwitch value={cur} onChange={setCur} />}
          </div>
          <input id="qa-amount" ref={amountRef} data-autofocus className="input input-amount" inputMode="decimal" autoComplete="off" placeholder="₡0"
            value={amountRaw} onChange={(e) => setAmountRaw(e.target.value)} aria-invalid={!!amountRaw && !amount} aria-describedby="qa-amt-hint" />
          <span id="qa-amt-hint" className="small" style={{ color: amountRaw && !amount ? 'var(--expense)' : 'var(--text-2)' }}>
            {amount ? formatMoney(amount as Minor, 'CRC', { decimals: amount % 100 ? 2 : 0 }) : amountRaw ? 'Can’t read that amount' : 'Try 70k, 1.5m, 12,500'}
          </span>
        </div>
      )}
      <div className="field">
        <label htmlFor="qa-desc">Description</label>
        <input id="qa-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Walmart, Uber, rent…" />
      </div>
      {kind === 'savings' && (
        <Segmented label="Direction" value={direction} onChange={setDirection} options={[{ value: 'deposit', label: 'Put money in' }, { value: 'withdrawal', label: 'Take money out' }]} />
      )}
      {kind !== 'transfer' && (
        <div className="field">
          <label htmlFor="qa-cat">Category</label>
          {suggested.length > 0 && (
            <div className="chips" aria-label="Suggested categories">
              {suggested.map((id) => (
                <button type="button" key={id} className="chip" aria-pressed={categoryId === id} onClick={() => setCategoryId(id)}>{l.category.get(id)?.name}</button>
              ))}
            </div>
          )}
          {guess && guess.mode !== 'ask' && cats.some((c) => c.id === guess.categoryId) && (
            <span className="small muted">{guess.mode === 'auto' && categoryId === guess.categoryId ? 'Picked for you' : `Suggested (${Math.round(guess.confidence * 100)}% sure)`}: {l.category.get(guess.categoryId)?.name}, learned from {guess.similar} similar transaction{guess.similar > 1 ? 's' : ''}{guess.mode === 'suggest' && categoryId !== guess.categoryId ? <> · <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCategoryId(guess.categoryId)}>Use it</button></> : null}</span>
          )}
          <select id="qa-cat" className="input" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setAutoPicked(false); }}>
            <option value="">Choose…</option>
            {[...new Set(cats.map((c) => c.group))].map((g) => (
              <optgroup key={g} label={g}>{cats.filter((c) => c.group === g).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
            ))}
          </select>
        </div>
      )}
      {(() => {
        const c = l.category.get(categoryId);
        const run = coach?.run;
        if (kind !== 'expense' || !amount || !run || !c || !(c.group === 'Discretionary' || c.discretionary || c.group === 'Living') || amount < run.ctx.prefs.hoursNoteMin) return null;
        const h = hoursOfWork(run.ctx, amount);
        const cap = coach.state.caps.find((x) => x.categoryId === categoryId && x.month === date.slice(0, 7));
        return <p className="small muted" style={{ margin: '-6px 0 0' }}>≈ {h.toFixed(1)} hours of work{cap ? ` · cap ${formatMoney(cap.dailyCap as Minor, 'CRC', { decimals: 0 })}/day` : ''}{amount >= run.ctx.prefs.coolingMin && (c.group === 'Discretionary' || c.discretionary) ? <> · not sure? <a href="/coach/wants" onClick={(e) => { e.preventDefault(); void coach.addWant({ name: description || c.name, amount, categoryId }).then(onDone); }}>add it to your cooling-off list</a></> : null}</p>;
      })()}
      {kind === 'debt_payment' && (
        <div className="field">
          <label htmlFor="qa-debt">Debt</label>
          <select id="qa-debt" className="input" value={debtId} onChange={(e) => setDebtId(e.target.value)}>
            <option value="">Choose…</option>
            {l.debts.filter((d) => d.status !== 'paid').map((d) => <option key={d.id} value={d.id}>{d.creditor}</option>)}
          </select>
          <span className="small muted">Paying from a fund (e.g. Hers) takes it out of the fund and lowers the debt in one step. It's counted once.</span>
        </div>
      )}
      <div className="grid2">
        {kind === 'income' ? placeSelect('qa-to', 'Into', from, setFrom)
          : placeSelect('qa-from', kind === 'savings' && direction === 'withdrawal' ? 'Take from' : 'From', from, setFrom)}
        {(kind === 'transfer' || kind === 'savings') ? placeSelect('qa-to2', 'To', to, setTo) : usdMode ? <div /> : (
          <div className="field"><label htmlFor="qa-date">Date</label><input id="qa-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
        )}
      </div>
      {(kind === 'transfer' || kind === 'savings') && (
        <div className="field"><label htmlFor="qa-date2">Date</label><input id="qa-date2" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
      )}
      {error && <p role="alert" style={{ color: 'var(--expense)', margin: 0, fontWeight: 600 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {!edit && <button type="button" className="btn" onClick={() => void submit(true)}>Save & add another</button>}
        <button type="submit" className="btn btn-primary">Save</button>
      </div>
      {toast && <Toast message={toast.msg} action={toast.auditId ? 'Undo' : undefined} onAction={() => toast.auditId && void undoAudit(toast.auditId)} onDone={() => setToast(null)} />}
    </form>
  );
}

function CurrencySwitch({ value, onChange }: { value: 'CRC' | 'USD'; onChange: (v: 'CRC' | 'USD') => void }) {
  return (
    <div className="segmented segmented-sm" role="group" aria-label="Currency">
      <button type="button" aria-pressed={value === 'CRC'} onClick={() => onChange('CRC')}>₡ Colones</button>
      <button type="button" aria-pressed={value === 'USD'} onClick={() => onChange('USD')}>$ Dollars</button>
    </div>
  );
}
