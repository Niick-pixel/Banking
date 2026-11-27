import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { useLedger } from '../app/data';
import { Glass, Money, Pill } from '../design/components';
import { PageHeader, Sheet } from '../ui/Sheet';
import { useQuickAdd } from '../app/QuickAdd';
import { commitmentForMonth, planProgress, schedule, splitCuotas } from '../domain/installments';
import { newId, saveAccount, saveInstallmentPlan } from '../db/repo';
import { formatMoney, parseAmountInput } from '../lib/money';
import { formatDateCR, parseISO, todayISO, cuotaFirstDefault } from '../lib/dates';
import type { InstallmentPlan } from '../domain/schemas';
import { usePersisted } from '../app/persist';

const TERMS = [3, 6, 10, 12, 18, 24, 36];

export default function TasaCero() {
  const qa = useQuickAdd();
  const l = useLedger();
  const today = todayISO();
  const [raw, setRaw] = useState('');
  const [months, setMonths] = usePersisted('tasa.months', 6);
  const [first, setFirst] = useState(cuotaFirstDefault(today));
  const [showSchedule, setShowSchedule] = useState(false);
  const [adding, setAdding] = useState<InstallmentPlan | null>(null);
  const total = parseAmountInput(raw, 'CRC');

  const plans = l.installments.filter((p) => p.status !== 'cancelled');
  const avgIncome = useMemo(() => {
    const withData = [...l.flows.values()].filter((f) => f.income > 0);
    return withData.length ? Math.round(withData.reduce((s, f) => s + f.income, 0) / withData.length) : 0;
  }, [l.flows]);

  const split = total ? splitCuotas(total, months) : null;
  const rows = total ? schedule(total, months, first) : [];
  const { year, month } = parseISO(first);
  const existingThatMonth = commitmentForMonth(plans, year, month);
  const newMonthly = split ? split.regular : 0;
  const pctIncome = avgIncome ? (existingThatMonth + newMonthly) / avgIncome : 0;
  const verdict = pctIncome > 0.2 ? { t: 'Too tight', tone: 'expense' as const } : pctIncome > 0.1 ? { t: 'Aggressive', tone: 'debt' as const } : { t: 'Comfortable', tone: 'income' as const };

  const outlook = Array.from({ length: 12 }, (_, i) => {
    const t = parseISO(today);
    const idx = t.month - 1 + i;
    const y = t.year + Math.floor(idx / 12), m = (idx % 12) + 1;
    return { label: `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${String(y).slice(2)}`, amount: commitmentForMonth(plans, y, m) };
  });
  const maxOut = Math.max(1, ...outlook.map((o) => o.amount));

  function startAdd() {
    if (!total) return;
    const now = Date.now();
    const card = l.accounts.find((a) => a.type === 'credit_card' && !a.archived);
    setAdding({ id: newId(), cardAccountId: card?.id ?? '', description: '', merchant: '', categoryId: '', currency: 'CRC', total, months, purchaseDate: today, firstChargeDate: first, status: 'active', notes: '', createdAt: now, updatedAt: now });
  }

  return (
    <>
      <PageHeader title="Tasa Cero" sub="0% interest card purchases split into monthly cuotas. Each cuota posts to Activity by itself on its date, and the bell reminds you a week before.">
        <Link className="btn" to="/transactions">← Activity</Link>
        <button className="btn btn-primary" onClick={() => qa.open(undefined, 'tasa_cero')}>+ Tasa Cero purchase</button>
      </PageHeader>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 16, alignItems: 'start' }}>
        <Glass strong style={{ display: 'grid', gap: 14 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Calculator</h2>
          <div className="field">
            <label htmlFor="tc-amt">Purchase price</label>
            <input id="tc-amt" className="input input-amount" inputMode="decimal" placeholder="₡0" value={raw} onChange={(e) => setRaw(e.target.value)} aria-invalid={!!raw && !total} />
          </div>
          <div className="field">
            <label id="tc-months-l">Months</label>
            <div className="chips" role="group" aria-labelledby="tc-months-l">
              {TERMS.map((m) => <button key={m} type="button" className="chip" aria-pressed={months === m} onClick={() => setMonths(m)}>{m}</button>)}
              <input className="input" style={{ width: 90, height: 30 }} type="number" min={1} max={60} aria-label="Custom months" value={months} onChange={(e) => setMonths(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />
            </div>
          </div>
          <div className="field"><label htmlFor="tc-first">First cuota billed on</label><input id="tc-first" className="input" type="date" value={first} onChange={(e) => setFirst(e.target.value)} /></div>

          {split && (
            <div style={{ display: 'grid', gap: 10 }}>
              <div className="glass" style={{ padding: 18, display: 'grid', gap: 4 }}>
                <span className="muted small">Monthly cuota</span>
                <Money amount={split.regular} size={38} weight={800} />
                {split.last !== split.regular && <span className="small muted">Last cuota {formatMoney(split.last, 'CRC', { decimals: split.last % 100 ? 2 : 0 })} (absorbs the rounding)</span>}
                <span className="small">Ends {formatDateCR(rows.at(-1)!.date)} · total {formatMoney(total!, 'CRC')} · interest ₡0</span>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="small">All Tasa Cero cuotas in {formatDateCR(first).slice(3)}: <b className="money">{formatMoney(existingThatMonth + newMonthly, 'CRC')}</b></span>
                {avgIncome > 0 && <Pill tone={verdict.tone}>{(pctIncome * 100).toFixed(1)}% of avg income · {verdict.t}</Pill>}
              </div>
              <div className="small muted">Every term at this price:</div>
              <div style={{ overflowX: 'auto' }}>
                <table className="table"><thead><tr><th>Months</th><th className="num">Cuota</th><th className="num">% of income</th></tr></thead>
                  <tbody>{TERMS.map((m) => { const s = splitCuotas(total!, m); return (
                    <tr key={m} style={m === months ? { background: 'var(--accent-soft)' } : undefined}><td>{m}</td><td className="num">{formatMoney(s.regular, 'CRC')}</td><td className="num">{avgIncome ? `${((s.regular / avgIncome) * 100).toFixed(1)}%` : '—'}</td></tr>
                  ); })}</tbody></table>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn" onClick={() => setShowSchedule((s) => !s)} aria-expanded={showSchedule}>{showSchedule ? 'Hide' : 'Show'} schedule</button>
                <button className="btn btn-primary" onClick={startAdd}>Add this purchase…</button>
              </div>
              {showSchedule && (
                <table className="table"><thead><tr><th>#</th><th>Billed</th><th className="num">Cuota</th><th className="num">Still owed</th></tr></thead>
                  <tbody>{rows.map((r) => <tr key={r.n}><td>{r.n}</td><td>{formatDateCR(r.date)}</td><td className="num">{formatMoney(r.amount, 'CRC', { decimals: r.amount % 100 ? 2 : 0 })}</td><td className="num">{formatMoney(r.remainingAfter, 'CRC')}</td></tr>)}</tbody></table>
              )}
            </div>
          )}
          {avgIncome === 0 && <p className="small muted" style={{ margin: 0 }}>Import or log income to see each cuota as a % of your income.</p>}
        </Glass>

        <div style={{ display: 'grid', gap: 16 }}>
          <Glass strong>
            <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>Next 12 months of cuotas</h2>
            {plans.length === 0 ? <p className="muted" style={{ margin: 0 }}>No Tasa Cero purchases yet.</p> : (
              <div role="img" aria-label="Monthly Tasa Cero commitment, next 12 months. Exact values in the list below." style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 6, alignItems: 'end', height: 120 }}>
                {outlook.map((o) => (
                  <div key={o.label} title={`${o.label}: ${formatMoney(o.amount, 'CRC')}`} style={{ display: 'grid', gap: 4, justifyItems: 'center', height: '100%', alignContent: 'end' }}>
                    <div style={{ width: '100%', maxWidth: 22, height: `${(o.amount / maxOut) * 90}px`, minHeight: o.amount ? 4 : 0, background: 'var(--chart-4)', borderRadius: '4px 4px 0 0' }} />
                    <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{o.label.slice(0, 3)}</span>
                  </div>
                ))}
              </div>
            )}
          </Glass>
          {plans.map((p) => {
            const pr = planProgress(p, today);
            const card = l.account.get(p.cardAccountId);
            return (
              <Glass key={p.id} style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div><div style={{ fontWeight: 700 }}>{p.description}</div><div className="small muted">{card?.name} · {l.category.get(p.categoryId)?.name} · bought {formatDateCR(p.purchaseDate)}</div></div>
                  <Money amount={p.total} weight={700} />
                </div>
                <div className="bar" role="img" aria-label={`${pr.billedCount} of ${p.months} cuotas billed`}><span style={{ width: `${(pr.billedCount / p.months) * 100}%`, background: 'var(--chart-4)' }} /></div>
                <div className="small" style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <span>{pr.billedCount}/{p.months} billed</span>
                  <span>Still to bill <b className="money">{formatMoney(pr.pending, 'CRC')}</b></span>
                  {pr.nextDate && <span>Next {formatDateCR(pr.nextDate)} · {formatMoney(pr.nextAmount!, 'CRC')}</span>}
                  <span className="muted">Ends {formatDateCR(pr.endDate)}</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-sm" onClick={() => setAdding(p)}>Edit</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => void saveInstallmentPlan({ ...p, status: 'cancelled' })}>Cancel plan</button>
                </div>
              </Glass>
            );
          })}
        </div>
      </div>

      <Sheet open={!!adding} onClose={() => setAdding(null)} title="Tasa Cero purchase">
        {adding && <PlanForm initial={adding} onDone={() => setAdding(null)} />}
      </Sheet>
    </>
  );
}

function PlanForm({ initial, onDone }: { initial: InstallmentPlan; onDone: () => void }) {
  const l = useLedger();
  const [p, setP] = useState(initial);
  const [raw, setRaw] = useState(String(initial.total / 100));
  const [err, setErr] = useState('');
  const cards = l.accounts.filter((a) => a.type === 'credit_card' && !a.archived);
  const cats = l.categories.filter((c) => ['Fixed', 'Living', 'Discretionary'].includes(c.group));

  async function addCard() {
    const now = Date.now();
    const a = await saveAccount({ id: newId(), name: 'BAC credit card', institution: 'BAC Credomatic', type: 'credit_card', currency: 'CRC', openingBalance: 0, openingDate: todayISO(), isLiquid: false, archived: false, createdAt: now, updatedAt: now });
    setP({ ...p, cardAccountId: a.id });
  }
  async function save() {
    const total = parseAmountInput(raw, 'CRC');
    if (!total) return setErr('Enter the purchase price');
    if (!p.cardAccountId) return setErr('Pick the card');
    if (!p.categoryId) return setErr('Pick a category');
    try { await saveInstallmentPlan({ ...p, total }); onDone(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: 'grid', gap: 12 }}>
      <div className="field"><label htmlFor="pf-desc">What did you buy?</label><input id="pf-desc" className="input" required value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} placeholder="PC upgrade, fridge…" /></div>
      <div className="grid2">
        <div className="field"><label htmlFor="pf-total">Price</label><input id="pf-total" className="input" inputMode="decimal" value={raw} onChange={(e) => setRaw(e.target.value)} /></div>
        <div className="field"><label htmlFor="pf-months">Months</label><input id="pf-months" className="input" type="number" min={1} max={60} value={p.months} onChange={(e) => setP({ ...p, months: Number(e.target.value) || 1 })} /></div>
      </div>
      <div className="field"><label htmlFor="pf-card">Card</label>
        {cards.length ? (
          <select id="pf-card" className="input" value={p.cardAccountId} onChange={(e) => setP({ ...p, cardAccountId: e.target.value })}><option value="">Choose…</option>{cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        ) : <button type="button" className="btn" onClick={() => void addCard()}>+ Add my BAC credit card</button>}
      </div>
      <div className="field"><label htmlFor="pf-cat">Category</label>
        <select id="pf-cat" className="input" value={p.categoryId} onChange={(e) => setP({ ...p, categoryId: e.target.value })}><option value="">Choose…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.group} · {c.name}</option>)}</select></div>
      <div className="grid2">
        <div className="field"><label htmlFor="pf-bought">Bought on</label><input id="pf-bought" className="input" type="date" value={p.purchaseDate} onChange={(e) => setP({ ...p, purchaseDate: e.target.value })} /></div>
        <div className="field"><label htmlFor="pf-first">First cuota billed</label><input id="pf-first" className="input" type="date" value={p.firstChargeDate} onChange={(e) => setP({ ...p, firstChargeDate: e.target.value })} /></div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Each cuota is recorded as an expense on the card in the month it's billed. Paying the card from checking is a transfer, so the purchase is never counted twice.</p>
      {err && <p role="alert" style={{ color: 'var(--expense)', margin: 0 }}>{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" type="submit">Save purchase</button></div>
    </form>
  );
}
