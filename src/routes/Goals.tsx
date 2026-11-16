import { useMemo, useState } from 'react';
import { useLedger } from '../app/data';
import { usePref } from '../app/prefs';
import { Glass, Money, Pill } from '../design/components';
import { PageHeader, Sheet } from '../ui/Sheet';
import { goalProgress } from '../domain/goals';
import { computeTracker } from '../domain/tracker';
import { newId, saveGoal } from '../db/repo';
import type { Goal } from '../domain/schemas';
import type { Payroll } from '../domain/prefs';
import { formatMoney, parseAmountInput } from '../lib/money';
import { formatDateCR, todayISO } from '../lib/dates';
import { AutoSavings } from './AutoSavings';

export default function Goals() {
  const l = useLedger();
  const today = todayISO();
  const year = Number(today.slice(0, 4));
  const [rateTarget, setRateTarget] = usePref('savingsRateTarget');
  const [payroll, setPayroll] = usePref('payroll');
  const [edit, setEdit] = useState<Goal | 'new' | null>(null);
  const [editPayroll, setEditPayroll] = useState(false);
  const t = useMemo(() => computeTracker(year, l.transactions.filter((x) => x.currency === 'CRC'), l.categories, l.budgets, { accountType: (id) => l.account.get(id)?.type }), [l, year]);
  const rate = t.ytd.income ? t.ytd.saved / t.ytd.income : 0;
  const mk = today.slice(0, 7);
  const thisMonth = t.saved[Number(today.slice(5, 7)) - 1] ?? 0;
  const thisIncome = t.income[Number(today.slice(5, 7)) - 1] ?? 0;

  const mine = (payroll.mySavingsPerQuincena + payroll.associationPerQuincena) * 2 + payroll.aporteObreroMonthly;
  const employer = payroll.aportePatronalMonthly;
  const floor = mine + employer;

  const current = (g: Goal) => g.potId ? (l.balances.get(l.pot.get(g.potId)?.accountId ?? '')?.pots.get(g.potId) ?? 0) : g.accountId ? (l.balances.get(g.accountId)?.total ?? 0) : 0;

  return (
    <>
      <PageHeader title="Savings & goals" sub="How much you save, what's automatic, and what it's for.">
        <button className="btn btn-primary" onClick={() => setEdit('new')}>+ Goal</button>
      </PageHeader>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 16, marginBottom: 16 }}>
        <AutoSavings />
        <Glass strong style={{ display: 'grid', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Savings rate</h2>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 40, fontWeight: 800 }} className="money">{(rate * 100).toFixed(1)}%</span>
            <Pill tone={rate >= rateTarget ? 'income' : 'debt'}>{rate >= rateTarget ? 'On target' : `Below ${Math.round(rateTarget * 100)}%`}</Pill>
          </div>
          <div className="bar" aria-hidden><span style={{ width: `${Math.min(1, rate / rateTarget) * 100}%`, background: rate >= rateTarget ? 'var(--income)' : 'var(--savings)' }} /></div>
          <div className="small muted">{year} so far: saved {formatMoney(t.ytd.saved, 'CRC')} of {formatMoney(t.ytd.income, 'CRC')} income. This month: {thisIncome ? `${((thisMonth / thisIncome) * 100).toFixed(1)}%` : '—'} ({mk}).</div>
          <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>Target
            <input className="input" style={{ width: 80, height: 32 }} type="number" min={1} max={90} value={Math.round(rateTarget * 100)} onChange={(e) => void setRateTarget(Math.max(1, Number(e.target.value) || 20) / 100)} aria-label="Savings rate target %" /> % of income</label>
        </Glass>

        <Glass strong style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Automatic savings floor</h2>
            <button className="btn btn-sm btn-ghost" onClick={() => setEditPayroll(true)}>Edit</button>
          </div>
          <p className="small muted" style={{ margin: 0 }}>What leaves your pay into savings every month without you doing anything.</p>
          <table className="table small"><tbody>
            <tr><td>My savings (×2 quincenas)</td><td className="num">{formatMoney(payroll.mySavingsPerQuincena * 2, 'CRC')}</td></tr>
            <tr><td>Association voluntary plan (×2)</td><td className="num">{formatMoney(payroll.associationPerQuincena * 2, 'CRC')}</td></tr>
            <tr><td>Aporte obrero (cesantía)</td><td className="num">{formatMoney(payroll.aporteObreroMonthly, 'CRC')}</td></tr>
            <tr><td>Aporte patronal (your employer)</td><td className="num" style={{ color: 'var(--income)' }}>+{formatMoney(employer, 'CRC')}</td></tr>
            <tr style={{ fontWeight: 750 }}><td>Combined floor / month</td><td className="num">{formatMoney(floor, 'CRC')}</td></tr>
          </tbody></table>
          <div className="small">{formatMoney(floor * 12, 'CRC')} a year from payroll alone. Your employer adds <b>{floor ? ((employer / floor) * 100).toFixed(1) : 0}%</b> of it: free money for every colón you save.</div>
        </Glass>
      </div>

      <h2 style={{ fontSize: 15, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Goals</h2>
      {l.goals.filter((g) => !g.archived).length === 0 ? <Glass><p className="muted" style={{ margin: 0 }}>No goals yet. Link a goal to a fund (e.g. Marchamo, Emergency fund) and its progress updates by itself.</p></Glass> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))', gap: 14 }}>
          {l.goals.filter((g) => !g.archived).map((g) => {
            const p = goalProgress(g, current(g), today);
            const where = g.potId ? `${l.account.get(l.pot.get(g.potId)?.accountId ?? '')?.name} · ${l.pot.get(g.potId)?.name}` : g.accountId ? l.account.get(g.accountId)?.name : 'Not linked';
            return (
              <Glass key={g.id} style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div><b>{g.name}</b><div className="small muted">{where}</div></div>
                  <button className="btn btn-sm btn-ghost" onClick={() => setEdit(g)}>Edit</button>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}><Money amount={p.current} size={26} weight={800} /><span className="muted small">of {formatMoney(g.target, 'CRC')}</span></div>
                <div className="bar" role="img" aria-label={`${Math.round(p.pct * 100)}%`}><span style={{ width: `${p.pct * 100}%`, background: 'var(--savings)' }} /></div>
                <div className="small" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {p.reached ? <Pill tone="income">✓ Reached</Pill> : <>
                    <span>{Math.round(p.pct * 100)}%</span>
                    {g.targetDate && <span>by {formatDateCR(g.targetDate)}: needs <b className="money">{formatMoney(p.requiredMonthly ?? 0, 'CRC')}</b>/mo</span>}
                    {p.onTrack !== undefined && <Pill tone={p.onTrack ? 'income' : 'debt'}>{p.onTrack ? 'On track' : 'Behind'}</Pill>}
                    {p.projectedDate && <span className="muted">At {formatMoney(g.plannedMonthly!, 'CRC')}/mo: {formatDateCR(p.projectedDate)}</span>}
                  </>}
                </div>
              </Glass>
            );
          })}
        </div>
      )}

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'New goal' : 'Edit goal'}>
        {edit && <GoalForm goal={edit === 'new' ? undefined : edit} onDone={() => setEdit(null)} />}
      </Sheet>
      <Sheet open={editPayroll} onClose={() => setEditPayroll(false)} title="Payroll savings">
        {editPayroll && <PayrollForm value={payroll} onSave={async (v) => { await setPayroll(v); setEditPayroll(false); }} />}
      </Sheet>
    </>
  );
}

function GoalForm({ goal, onDone }: { goal?: Goal; onDone: () => void }) {
  const l = useLedger();
  const now = Date.now();
  const [g, setG] = useState<Goal>(goal ?? { id: newId(), name: '', currency: 'CRC', target: 0, archived: false, createdAt: now, updatedAt: now });
  const [target, setTarget] = useState(g.target ? String(g.target / 100) : '');
  const [monthly, setMonthly] = useState(g.plannedMonthly ? String(g.plannedMonthly / 100) : '');
  const [err, setErr] = useState('');
  const link = g.potId ? `pot:${g.potId}` : g.accountId ? `acc:${g.accountId}` : '';
  async function save() {
    const t = parseAmountInput(target, 'CRC');
    if (!t) return setErr('Enter a target amount');
    const m = monthly.trim() ? parseAmountInput(monthly, 'CRC') : undefined;
    if (m === null) return setErr("Can't read the monthly amount");
    try { await saveGoal({ ...g, target: t, plannedMonthly: m ?? undefined }); onDone(); } catch (e) { setErr(String(e)); }
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: 'grid', gap: 12 }}>
      <div className="field"><label htmlFor="g-n">Goal</label><input id="g-n" data-autofocus className="input" required placeholder="Emergency fund, Marchamo 2027…" value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} /></div>
      <div className="grid2">
        <div className="field"><label htmlFor="g-t">Target</label><input id="g-t" className="input" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} /></div>
        <div className="field"><label htmlFor="g-d">By</label><input id="g-d" className="input" type="date" value={g.targetDate ?? ''} onChange={(e) => setG({ ...g, targetDate: e.target.value || undefined })} /></div>
      </div>
      <div className="grid2">
        <div className="field"><label htmlFor="g-l">Progress comes from</label>
          <select id="g-l" className="input" value={link} onChange={(e) => { const [k, id] = e.target.value.split(':'); setG({ ...g, potId: k === 'pot' ? id : undefined, accountId: k === 'acc' ? id : undefined }); }}>
            <option value="">Not linked</option>
            <optgroup label="Funds">{l.pots.map((p) => <option key={p.id} value={`pot:${p.id}`}>{l.account.get(p.accountId)?.name} · {p.name}</option>)}</optgroup>
            <optgroup label="Accounts">{l.accounts.map((a) => <option key={a.id} value={`acc:${a.id}`}>{a.name}</option>)}</optgroup>
          </select></div>
        <div className="field"><label htmlFor="g-m">I'll put in per month</label><input id="g-m" className="input" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} /></div>
      </div>
      {goal && <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={g.archived} onChange={(e) => setG({ ...g, archived: e.target.checked })} /> Archive</label>}
      {err && <p role="alert" style={{ color: 'var(--expense)', margin: 0 }}>{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" type="submit">Save goal</button></div>
    </form>
  );
}

function PayrollForm({ value, onSave }: { value: Payroll; onSave: (v: Payroll) => Promise<void> }) {
  const fields: [keyof Payroll, string][] = [
    ['mySavingsPerQuincena', 'My savings per quincena'], ['associationPerQuincena', 'Association voluntary plan per quincena'],
    ['aporteObreroMonthly', 'Aporte obrero per month'], ['aportePatronalMonthly', 'Aporte patronal per month (employer)'],
  ];
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(fields.map(([k]) => [k, String(value[k] / 100)])));
  const [err, setErr] = useState('');
  async function save() {
    const out = { ...value };
    for (const [k, label] of fields) { const n = parseAmountInput(v[k] ?? '', 'CRC'); if (n === null) return setErr(`Can't read "${label}"`); out[k] = n; }
    await onSave(out);
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: 'grid', gap: 12 }}>
      <p className="small muted" style={{ margin: 0 }}>Check these against your payslip. The aporte figures are approximate until you confirm them.</p>
      {fields.map(([k, label]) => (
        <div key={k} className="field"><label htmlFor={`pr-${k}`}>{label}</label><input id={`pr-${k}`} className="input" inputMode="decimal" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></div>
      ))}
      {err && <p role="alert" style={{ color: 'var(--expense)', margin: 0 }}>{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" type="submit">Save</button></div>
    </form>
  );
}
