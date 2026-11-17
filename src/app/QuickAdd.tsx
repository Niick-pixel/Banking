import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Sheet, Toast } from '../ui/Sheet';
import { Segmented } from '../design/components';
import { useLedger, suggestCategories, type Ledger } from './data';
import { convert, formatMoney, parseAmountInput, type Minor } from '../lib/money';
import { rateForDay } from './fx';
import { crossesSavings, savingsCategoryFor } from '../domain/fundmoves';
import { useCoach } from './coach';
import { ChipGroup } from '../design/components/ChipGroup';
import { InfoTip } from '../design/components/InfoTip';
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
  const [state, setState] = useState<{ open: boolean; edit?: Transaction; n: number }>({ open: false, n: 0 });
  const open = useCallback((tx?: Transaction) => setState((x) => ({ open: true, edit: tx, n: x.n + 1 })), []);
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
      <QuickAddForm key={state.n} open={state.open} edit={state.edit} onDone={() => setState((x) => ({ ...x, open: false }))} />
    </QuickAddCtx.Provider>
  );
}

function QuickAddForm({ open, edit, onDone }: { open: boolean; edit?: Transaction; onDone: () => void }) {
  const l = useLedger();
  const plc = useMemo(() => places(l), [l]);
  const spending = plc.find((p) => !p.savings && l.account.get(p.key.split('|')[0]!)?.type === 'checking')?.key ?? plc.find((p) => !p.savings)?.key ?? plc[0]?.key ?? '';
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
  const [flash, setFlash] = useState(false);
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

  // A transfer between spending money and a fund/savings account is really saving: offer to record it as such.
  const keepPlaces = useRef<string | null>(null);
  const splitKey = (k: string) => { const [a, p] = k.split('|'); return p ? { accountId: a!, potId: p } : { accountId: a! }; };
  const crosses = kind === 'transfer' && from && to && from !== to ? crossesSavings(splitKey(from), splitKey(to), { accountType: (id) => l.account.get(id)?.type }) : null;
  function recordAsSavings() {
    if (!crosses) return;
    const fundSide = splitKey(crosses === 'deposit' ? to : from);
    keepPlaces.current = savingsCategoryFor(l.categories, l.pots.find((p) => p.id === fundSide.potId)?.owner)?.id ?? '';
    if (direction === crosses) { setKind('savings'); } else { setDirection(crosses); setKind('savings'); }
  }

  // Keep from/to sensible when switching kind.
  useEffect(() => {
    if (edit) return;
    if (keepPlaces.current !== null) { setCategoryId(keepPlaces.current); keepPlaces.current = null; return; }
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

  // What's still unanswered, in the order you'd answer it.
  const needsCategory = kind !== 'transfer' && !(kind === 'expense');
  const missing = [
    !amount ? (usdMode ? 'amount in dollars' : 'amount') : null,
    usdMode && !rate ? 'rate' : null,
    kind !== 'transfer' && !categoryId && (needsCategory || kind === 'expense') ? 'category' : null,
    kind === 'debt_payment' && !debtId ? 'debt' : null,
    (kind === 'transfer' || kind === 'savings') && (!to || to === from) ? 'where it goes' : null,
  ].filter(Boolean) as string[];
  const tryCommit = (again: boolean) => {
    if (missing.length) { setFlash(true); setTimeout(() => setFlash(false), 1900); setError(''); }
    void submit(again);
  };
  const dirty = !!(amountRaw || usdRaw || description || (categoryId && !edit));
  const dayChip = (n: number) => { const d = new Date(Date.parse(`${todayISO()}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10); return d; };
  const dateChoice = date === dayChip(0) ? 'today' : date === dayChip(1) ? 'yesterday' : date === dayChip(2) ? 'two' : 'other';
  const accounts = plc.filter((p) => !p.key.split('|')[1]);
  const placeLabel = (p: (typeof plc)[number]) => p.label.replace(/\s*\((checking|savings)\)/i, '');
  const ORDER = ['Income', 'Fixed', 'Living', 'Discretionary', 'Debt Service', 'Savings'];
  const groups = [...new Set(cats.map((c) => c.group))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const similar = description.trim().length >= 3 ? l.transactions.filter((t) => t.kind === kind && t.description.toLowerCase().includes(description.trim().toLowerCase()) && t.id !== edit?.id) : [];
  const simAvg = similar.length ? Math.round(similar.reduce((s0, t) => s0 + ('amount' in t ? t.amount : 0), 0) / similar.length) : 0;
  const KINDS: { value: Kind; label: string; tone: 'loss' | 'win' | 'save' | 'accent' | 'amber' }[] = [
    { value: 'expense', label: 'Expense', tone: 'loss' }, { value: 'income', label: 'Income', tone: 'win' }, { value: 'savings', label: 'Savings', tone: 'save' },
    { value: 'transfer', label: 'Transfer', tone: 'accent' }, { value: 'debt_payment', label: 'Debt payment', tone: 'amber' },
  ];
  const kindLabel = KINDS.find((k) => k.value === kind)!.label;

  const strip = l.accounts.length ? (
    <div className="qa-strip">
      <ChipGroup<string> inline size="sm" label={kind === 'income' ? 'Into' : 'From'}
        info={kind === 'income' ? 'The account the money landed in.' : 'Where the money came out of. Funds inside an account are offered in the right column for savings and transfers.'}
        value={`${from.split('|')[0]}|`} onChange={(v) => v && setFrom(v)}
        options={accounts.map((p) => ({ value: p.key, label: placeLabel(p) }))} />
      <ChipGroup<string> inline size="sm" compact label="Date" value={dateChoice} onChange={(v) => { if (v === 'today') setDate(dayChip(0)); else if (v === 'yesterday') setDate(dayChip(1)); else if (v === 'two') setDate(dayChip(2)); }}
        options={[{ value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }, { value: 'two', label: '2 days ago' }, ...(dateChoice === 'other' ? [{ value: 'other', label: date.split('-').reverse().join('/') }] : [])]} />
      <input className="input qa-date" type="date" aria-label="Another date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
    </div>
  ) : undefined;

  const footer = (
    <>
      <span className={`status ${missing.length ? 'todo' : ''}`} role="status">
        {error ? <span style={{ color: 'var(--expense)' }}>{error}</span>
          : missing.length ? <>Still to tap: {missing.slice(0, 3).join(', ')}{missing.length > 3 ? `, +${missing.length - 3}` : ''}.</>
          : <>Ready: {kindLabel.toLowerCase()} of {formatMoney(amount!, 'CRC')}{categoryId ? ` · ${l.category.get(categoryId)?.name}` : ''}.</>}
      </span>
      {!edit && <button type="button" className="btn" onClick={() => tryCommit(true)}>Save & add another <kbd>⇧↵</kbd></button>}
      <button type="button" className="btn btn-primary" onClick={() => tryCommit(false)}>{edit ? 'Save changes' : 'Save'} <kbd style={{ color: 'inherit', borderColor: 'currentColor', background: 'transparent', opacity: .8 }}>↵</kbd></button>
    </>
  );

  return (
    <Sheet open={open} onClose={onDone} wide dirty={dirty} title={edit ? 'Edit movement' : 'Add a movement'} caption={kindLabel}
      actions={<span className="small faint" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><kbd>Tab</kbd> next <kbd>1–9</kbd> pick <kbd>Esc</kbd> close</span>}
      strip={strip} footer={footer}>
      {!l.accounts.length ? <p className="muted">Add an account or import your workbook first.</p> : (
      <form className="qa-grid" onSubmit={(e) => { e.preventDefault(); tryCommit(false); }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          if (e.shiftKey && !edit) { e.preventDefault(); tryCommit(true); return; }
          // Enter confirms from anywhere (Space toggles a chip).
          if ((e.target as HTMLElement).tagName === 'BUTTON') { e.preventDefault(); tryCommit(false); }
        }}>
        {/* Column 1: what and how much */}
        <div className="qa-col">
          <ChipGroup<Kind> label="Kind" value={kind} onChange={(v) => v && setKind(v)} options={KINDS} info="Expense: money spent. Income: money in. Savings: into or out of savings. Transfer: between your own accounts, not counted. Debt payment: lowers a loan." />
          {kind === 'savings' && <ChipGroup<'deposit' | 'withdrawal'> label="Direction" compact value={direction} onChange={(v) => v && setDirection(v)} options={[{ value: 'deposit', label: 'Put in', tone: 'win' }, { value: 'withdrawal', label: 'Take out', tone: 'loss' }]} />}
          <div className={`field ${flash && !amount ? 'missing-flash' : ''}`}>
            <label htmlFor="qa-amount">{usdMode ? 'Amount in dollars' : 'Amount'} {!amount && <span className="req">required</span>}<InfoTip text="Type the amount. Shortcuts work: 70k is 70,000 and 1.5m is 1,500,000." />
              {kind === 'expense' && <span style={{ marginLeft: 'auto' }}><CurrencySwitch value={cur} onChange={setCur} /></span>}</label>
            {usdMode ? (
              <input id="qa-amount" ref={amountRef} data-autofocus className="input input-amount" inputMode="decimal" autoComplete="off" placeholder="19.99"
                value={usdRaw} onChange={(e) => setUsdRaw(e.target.value)} aria-invalid={!!usdRaw && !usd} />
            ) : (
              <input id="qa-amount" ref={amountRef} data-autofocus className="input input-amount" inputMode="decimal" autoComplete="off" placeholder="12,500 or 70k"
                value={amountRaw} onChange={(e) => setAmountRaw(e.target.value)} aria-invalid={!!amountRaw && !amount} aria-describedby="qa-amt-hint" />
            )}
            <span id="qa-amt-hint" className="small" style={{ color: (usdMode ? usdRaw && !usd : amountRaw && !amount) ? 'var(--expense)' : 'var(--text-faint)' }}>
              {usdMode ? (converted ? <>= {formatMoney(converted, 'CRC', { decimals: 2 })} <span className="derived">· derived</span></> : 'In dollars, e.g. 19.99')
                : amount ? formatMoney(amount as Minor, 'CRC', { decimals: amount % 100 ? 2 : 0 }) : amountRaw ? 'Can’t read that amount' : 'In colones'}
            </span>
          </div>
          {usdMode && (
            <div className={`field ${flash && !rate ? 'missing-flash' : ''}`}>
              <label htmlFor="qa-rate">Rate, ₡ per $1 <InfoTip text="The exchange rate of the purchase day, from BCCR or the market (Settings → Exchange rates). Type the one on your statement to override it." /></label>
              <input id="qa-rate" className="input" inputMode="decimal" value={rateRaw} placeholder={rateState === 'loading' ? 'Getting the rate…' : '506.43'}
                onChange={(e) => { setRateRaw(e.target.value); setRateState('idle'); setQuote({ source: 'manual', rateDate: date, side: quote?.side ?? 'sell' }); }} />
              <span className="small faint">{rateState === 'loading' ? 'Getting the rate for that day…' : rateState === 'none' && !rateRaw ? 'No rate offline: type it from your statement.'
                : quote ? (quote.source === 'manual' ? 'Typed by you' : <span className="guess">{quote.source === 'BCCR' ? `BCCR ${quote.side}` : 'Market'} rate of {quote.rateDate.split('-').reverse().join('/')} · a guess until your statement</span>) : ''}</span>
            </div>
          )}
          <div className="field">
            <label htmlFor="qa-desc">Description <InfoTip text="A few words to recognise it later, like the shop. It also teaches the app which category to suggest." /></label>
            <input id="qa-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Walmart, Uber, rent…" />
          </div>
          <div className="qa-context group">
            <span className="label">Context</span>
            {similar.length ? <span className="small">“{description.trim()}” before: <b>{similar.length}</b> time{similar.length > 1 ? 's' : ''} · avg {formatMoney(simAvg, 'CRC')} · last {similar[0]!.date.split('-').reverse().join('/')} <span className="n">n {similar.length}</span></span>
              : <span className="small faint">Type a description to see how often you've logged it.</span>}
            {(() => {
              const c = l.category.get(categoryId);
              const run = coach?.run;
              if (kind !== 'expense' || !amount || !run || !c || amount < run.ctx.prefs.hoursNoteMin) return null;
              const h = hoursOfWork(run.ctx, amount);
              const cap = coach.state.caps.find((x) => x.categoryId === categoryId && x.month === date.slice(0, 7));
              return <span className="small">≈ {h.toFixed(1)} hours of work <span className="derived">· derived</span>{cap ? ` · your cap ${formatMoney(cap.dailyCap as Minor, 'CRC', { decimals: 0 })}/day` : ''}</span>;
            })()}
          </div>
        </div>

        {/* Column 2: category */}
        <div className={`qa-col qa-cats ${flash && !categoryId && kind !== 'transfer' ? 'missing-flash' : ''}`}>
          {kind === 'transfer' ? (
            <div className="qa-note group"><span className="label">Category · derived</span><span className="small">Transfers between your own accounts are neither income nor spending, so they have no category.</span>
              {crosses && <><span className="small">{crosses === 'deposit' ? 'This one puts spending money into savings, so it would be missing from your budget.' : 'This one takes money out of savings, so it would be missing from your budget.'}</span><button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} onClick={recordAsSavings}>Record as savings</button></>}
            </div>
          ) : (<>
            <div className="chipgroup-head">
              <span className="chipgroup-label">Category</span>
              {!categoryId && <span className="req">required</span>}
              <InfoTip text="What it was for. The first row is what you usually pick for this description; tap any other below." />
              {guess && guess.mode !== 'ask' && cats.some((c) => c.id === guess.categoryId) && <span className="chipgroup-aside guess">{guess.mode === 'auto' && categoryId === guess.categoryId ? 'picked for you' : 'suggested'} · {Math.round(guess.confidence * 100)}% · n {guess.similar}</span>}
            </div>
            <div className="qa-cat-box scroll-box">
              {suggested.length > 0 && <ChipGroup<string> size="sm" label="Usually" value={categoryId || null} onChange={(v) => { setCategoryId(v ?? ''); setAutoPicked(false); }} allowNone
                options={suggested.map((id) => ({ value: id, label: l.category.get(id)?.name ?? '' }))} />}
              {groups.map((g) => (
                <ChipGroup<string> key={g} size="sm" label={g === 'Debt Service' ? 'Debt payments' : g} value={categoryId || null} onChange={(v) => { setCategoryId(v ?? ''); setAutoPicked(false); }} allowNone
                  options={cats.filter((c) => c.group === g).map((c) => ({ value: c.id, label: c.name }))} />
              ))}
            </div>
          </>)}
        </div>

        {/* Column 3: where it goes */}
        <div className="qa-col">
          {(kind === 'transfer' || kind === 'savings' || kind === 'debt_payment') && l.pots.some((p) => p.accountId === from.split('|')[0]) && (
            <ChipGroup<string> size="sm" label="From fund" info="Which part of the account the money comes from. Unassigned is the part not set aside in any fund."
              value={from} onChange={(v) => v && setFrom(v)}
              options={[{ value: `${from.split('|')[0]}|`, label: 'Unassigned' }, ...l.pots.filter((p) => p.accountId === from.split('|')[0] && !p.archived).map((p) => ({ value: `${p.accountId}|${p.id}`, label: p.name }))]} />
          )}
          {(kind === 'transfer' || kind === 'savings') && (
            <ChipGroup<string> size="sm" label={kind === 'savings' && direction === 'withdrawal' ? 'Back into' : 'To'} value={to || null} onChange={(v) => v && setTo(v)} flash={flash}
              required info="Where the money went. Funds (Mine, Hers…) are parts of an account." hiddenNote={from ? 'the account it comes from is not offered' : undefined}
              options={plc.map((p) => ({ value: p.key, label: placeLabel(p), hidden: p.key === from }))} />
          )}
          {kind === 'debt_payment' && (
            <ChipGroup<string> size="sm" label="Debt" required value={debtId || null} onChange={(v) => setDebtId(v ?? '')} flash={flash}
              info="Paying from a fund (e.g. Hers) takes it out of the fund and lowers the debt in one step, counted once."
              options={l.debts.filter((d) => d.status !== 'paid').map((d) => ({ value: d.id, label: d.creditor }))} hiddenNote={l.debts.some((d) => d.status === 'paid') ? 'paid-off debts are not offered' : undefined} />
          )}
          {(kind === 'expense' || kind === 'income') && (
            <div className="qa-note group">
              <span className="label">{kind === 'income' ? 'Into' : 'Paid from'} · from the strip</span>
              <span className="small">{plc.find((p) => p.key === from)?.label ?? '—'}</span>
              <span className="small faint">Change it in the row above. Card purchases: pick the card, so its balance stays right.</span>
            </div>
          )}
          <div className="qa-summary group fill">
            <span className="label">This movement</span>
            <span className="qa-big money" style={{ color: kind === 'income' ? 'var(--income)' : kind === 'expense' ? 'var(--expense)' : kind === 'savings' ? 'var(--savings)' : kind === 'debt_payment' ? 'var(--debt)' : 'var(--text)' }}>{amount ? formatMoney(amount, 'CRC') : '₡—'}</span>
            <span className="small faint">{kindLabel} · {date.split('-').reverse().join('/')} · {plc.find((p) => p.key === from)?.label ?? '—'}{(kind === 'transfer' || kind === 'savings') && to ? ` → ${plc.find((p) => p.key === to)?.label}` : ''}</span>
            <span className="small faint">{categoryId ? l.category.get(categoryId)?.name : kind === 'transfer' ? 'No category · derived' : 'No category yet'}</span>
          </div>
        </div>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
        {toast && <Toast message={toast.msg} action={toast.auditId ? 'Undo' : undefined} onAction={() => toast.auditId && void undoAudit(toast.auditId)} onDone={() => setToast(null)} />}
      </form>)}
    </Sheet>
  );
}

function CurrencySwitch({ value, onChange }: { value: 'CRC' | 'USD'; onChange: (v: 'CRC' | 'USD') => void }) {
  return <Segmented<'CRC' | 'USD'> label="Currency" value={value} onChange={onChange} options={[{ value: 'CRC', label: '₡' }, { value: 'USD', label: '$' }]} />;
}
