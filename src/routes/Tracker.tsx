import { useMemo, useState } from 'react';
import { useLedger } from '../app/data';
import { Glass, Pill, Segmented } from '../design/components';
import { usePersisted } from '../app/persist';
import { PageHeader } from '../ui/Sheet';
import { budgetAlerts, budgetFor, computeTracker, type Tracker, type TrackerRow } from '../domain/tracker';
import { formatMoney, parseAmountInput } from '../lib/money';
import { todayISO } from '../lib/dates';
import { saveBudget } from '../db/repo';
import { usePref } from '../app/prefs';
import { FundMovesFix } from './FundMovesFix';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const GROUP_LABEL: Record<string, string> = { Income: 'Income', Fixed: 'Fixed costs', Living: 'Living / variable', Discretionary: 'Discretionary', 'Debt Service': 'Debt service', Savings: 'Savings' };
const fmt = (v: number) => (v === 0 ? '—' : formatMoney(v, 'CRC', { parens: true }));

export default function Tracker() {
  const l = useLedger();
  const today = todayISO();
  const years = useMemo(() => [...new Set(l.transactions.map((t) => Number(t.date.slice(0, 4))))].sort(), [l.transactions]);
  const [warnAt] = usePref('budgetWarnPct');
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const t = useMemo(() => computeTracker(year, l.transactions.filter((x) => x.currency === 'CRC'), l.categories, l.budgets, { accountType: (id) => l.account.get(id)?.type }), [year, l]);
  const alerts = budgetAlerts(t, today, warnAt);
  const curMonth = year === Number(today.slice(0, 4)) ? Number(today.slice(5, 7)) - 1 : -1;
  const savingsRate = t.ytd.income ? t.ytd.saved / t.ytd.income : 0;

  const [view, setView] = usePersisted<'month' | 'year'>('budget.view', 'month');
  const [mk, setMk] = useState(today.slice(0, 7));
  const shiftM = (d: number) => { const [yy, mm] = mk.split('-').map(Number) as [number, number]; const i = yy * 12 + mm - 1 + d; const n = `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; setMk(n); if (Number(n.slice(0, 4)) !== year) setYear(Number(n.slice(0, 4))); };
  const mIdx = Number(mk.slice(5, 7)) - 1;
  const statsBelow = (
    <>
      {alerts.length > 0 && (
        <Glass strong pad={16} style={{ marginTop: 16 }} role="region" aria-label="Budget alerts this month">
          <b>Pace this month</b>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, display: 'grid', gap: 4 }}>
            {alerts.map((a) => (
              <li key={a.category.id}>
                <Pill tone={a.level === 'over' ? 'expense' : 'debt'}>{a.level === 'over' ? 'Over' : `${Math.round(a.pct * 100)}%`}</Pill>{' '}
                {a.category.name}: {formatMoney(a.spent, 'CRC')} of {formatMoney(a.budget, 'CRC')}
                {a.projected > a.spent && <span className="muted">. At this pace you'll spend {formatMoney(a.projected, 'CRC')} this month</span>}
              </li>
            ))}
          </ul>
        </Glass>
      )}
      <h2 className="card-h" style={{ margin: '20px 0 10px' }}>{year} so far</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        <Stat label="Income YTD" value={t.ytd.income} tone="income" />
        <Stat label="Expenses YTD" value={t.ytd.expenses} tone="expense" />
        <Stat label="Saved YTD" value={t.ytd.saved} tone="savings" sub={`${(savingsRate * 100).toFixed(1)}% of income`} />
        <Stat label="Free cash YTD" value={t.ytd.freeCash} tone={t.ytd.freeCash < 0 ? 'expense' : 'income'} sub={`${t.monthsWithData} month(s) with data`} />
      </div>
    </>
  );

  return (
    <>
      <PageHeader title="Budget" sub={view === 'month' ? 'Each category against its budget for the month. Click a budget to change it.' : 'Budget vs actual for the whole year, like your workbook.'}>
        <Segmented label="View" value={view} onChange={setView} options={[{ value: 'month', label: 'Month' }, { value: 'year', label: 'Year table' }]} />
        {view === 'month' ? (<>
          <button className="btn btn-sm" aria-label="Previous month" onClick={() => shiftM(-1)}>‹</button>
          <b style={{ minWidth: 130, textAlign: 'center' }}>{MONTH_NAMES[mIdx]} {mk.slice(0, 4)}</b>
          <button className="btn btn-sm" aria-label="Next month" onClick={() => shiftM(1)}>›</button>
        </>) : (
          <select className="input" style={{ width: 120 }} aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[...new Set([...years, Number(today.slice(0, 4))])].map((y) => <option key={y}>{y}</option>)}
          </select>
        )}
      </PageHeader>
      <FundMovesFix />

      {view === 'month' ? <MonthBudget t={t} m={mIdx} month={mk} /> : (<>
      <Glass strong pad={0} style={{ overflow: 'hidden' }}>
        <div className="tracker-wrap" tabIndex={0} aria-label="Tracker table, scroll horizontally">
          <table className="table tracker">
            <thead>
              <tr>
                <th className="sticky">Category</th><th className="num">Budget</th>
                {M.map((m, i) => <th key={m} className={`num ${i === curMonth ? 'cur' : ''}`}>{m}</th>)}
                <th className="num">YTD</th><th className="num">Avg / mo</th><th className="num">vs budget</th><th className="num">% income</th>
              </tr>
            </thead>
            {t.sections.map((s) => (
              <tbody key={s.group}>
                <tr className="group-row"><th className="sticky" colSpan={1}>{GROUP_LABEL[s.group]}</th><td colSpan={17} /></tr>
                {s.rows.map((r) => <Row key={r.category.id} r={r} income={s.group === 'Income'} curMonth={curMonth} />)}
                <tr className="subtotal">
                  <th className="sticky">Total {GROUP_LABEL[s.group]!.toLowerCase()}</th>
                  <td className="num">{fmt(s.subtotal.budget)}</td>
                  {s.subtotal.months.map((v, i) => <td key={i} className="num">{fmt(v)}</td>)}
                  <td className="num">{fmt(s.subtotal.ytd)}</td><td className="num">{fmt(s.subtotal.avg)}</td><td /><td className="num">{t.ytd.income ? `${((s.subtotal.ytd / t.ytd.income) * 100).toFixed(1)}%` : '—'}</td>
                </tr>
              </tbody>
            ))}
            <tbody className="bottom">
              <BottomRow label="Total income" values={t.income} ytd={t.ytd.income} budget={t.budgetTotals.income} n={t.monthsWithData} />
              <BottomRow label="Total expenses" values={t.expenses} ytd={t.ytd.expenses} budget={t.budgetTotals.expenses} n={t.monthsWithData} />
              <BottomRow label="Net income" values={t.net} ytd={t.ytd.net} budget={t.budgetTotals.income - t.budgetTotals.expenses} n={t.monthsWithData} signed />
              <BottomRow label="Total saved" values={t.saved} ytd={t.ytd.saved} budget={t.budgetTotals.saved} n={t.monthsWithData} />
              <BottomRow label="Left after saving (free cash)" values={t.freeCash} ytd={t.ytd.freeCash} budget={t.budgetTotals.income - t.budgetTotals.expenses - t.budgetTotals.saved} n={t.monthsWithData} signed strong />
            </tbody>
          </table>
        </div>
      </Glass>
      <p className="small muted">Red cells: spending over budget, or saving under target. Averages count only months with income. Click a budget to edit it.</p>
      </>)}
      {statsBelow}
    </>
  );
}

/** One month, category by category: spent against budget with a bar, what's left, and the last 6 months as a mini trend. */
function MonthBudget({ t, m, month }: { t: Tracker; m: number; month: string }) {
  const totals = [
    { label: 'Income', value: t.income[m]!, budget: t.budgetTotals.income, tone: 'income', good: (v: number, b: number) => v >= b },
    { label: 'Spent', value: t.expenses[m]!, budget: t.budgetTotals.expenses, tone: 'expense', good: (v: number, b: number) => v <= b },
    { label: 'Saved', value: t.saved[m]!, budget: t.budgetTotals.saved, tone: 'savings', good: (v: number, b: number) => v >= b },
    { label: 'Free cash', value: t.freeCash[m]!, budget: t.budgetTotals.income - t.budgetTotals.expenses - t.budgetTotals.saved, tone: t.freeCash[m]! < 0 ? 'expense' : 'income', good: (v: number) => v >= 0 },
  ];
  return (
    <>
      <div className="budget-totals">
        {totals.map((x) => (
          <Glass key={x.label} pad={16} style={{ display: 'grid', gap: 6 }}>
            <span className="small muted">{x.label}</span>
            <span className="money" style={{ fontSize: 24, fontWeight: 750, color: `var(--${x.tone})` }}>{formatMoney(x.value, 'CRC')}</span>
            {x.budget !== 0 && <>
              <div className="bar" aria-hidden><span style={{ width: `${Math.max(0, Math.min(1, x.budget ? x.value / x.budget : 0)) * 100}%`, background: x.good(x.value, x.budget) ? 'var(--income)' : 'var(--expense)' }} /></div>
              <span className="small muted">of {formatMoney(x.budget, 'CRC')} planned</span>
            </>}
          </Glass>
        ))}
      </div>
      <div className="budget-groups">
        {t.sections.map((s) => {
          const spentGroup = s.subtotal.months[m]!;
          const budgetGroup = s.subtotal.budget;
          return (
            <Glass key={s.group} strong pad={18} className="budget-group">
              <div className="budget-group-head">
                <h2 className="card-h" style={{ margin: 0 }}>{GROUP_LABEL[s.group]}</h2>
                <span className="small"><b className="money">{formatMoney(spentGroup, 'CRC')}</b>{budgetGroup ? <span className="muted"> of {formatMoney(budgetGroup, 'CRC')}</span> : null}</span>
              </div>
              {s.rows.map((r) => <MonthRow key={r.category.id} r={r} m={m} group={s.group} month={month} />)}
            </Glass>
          );
        })}
      </div>
    </>
  );
}

function MonthRow({ r, m, group, month }: { r: TrackerRow; m: number; group: string; month: string }) {
  const l = useLedger();
  const budget = budgetFor(l.budgets, r.category.id, month);
  const v = r.months[m]!;
  const pct = budget ? v / budget : 0;
  const inverse = group === 'Income' || group === 'Savings'; // more is better
  const bad = budget > 0 && (inverse ? v < budget && Number(month.slice(5)) - 1 <= m : v > budget);
  const color = !budget ? 'var(--text-3)' : inverse ? (v >= budget ? 'var(--income)' : 'var(--debt)') : pct > 1 ? 'var(--expense)' : pct >= 0.8 ? 'var(--debt)' : 'var(--income)';
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState('');
  const commit = async () => { const n = raw.trim() === '' ? 0 : parseAmountInput(raw, 'CRC'); if (n !== null) await saveBudget(r.category.id, '*', n); setEditing(false); };
  const trend = r.months.slice(Math.max(0, m - 5), m + 1);
  const max = Math.max(1, ...trend.map((x) => Math.abs(x)), budget);
  const left = budget - v;
  return (
    <div className="budget-row">
      <span className="budget-name" title={r.category.name}>{r.category.name}</span>
      <svg className="budget-spark" viewBox={`0 0 ${trend.length * 8} 18`} aria-hidden>{trend.map((x, i) => <rect key={i} x={i * 8 + 1} width={6} y={18 - (Math.abs(x) / max) * 18} height={(Math.abs(x) / max) * 18} rx={1.5} fill={i === trend.length - 1 ? color : 'var(--text-3)'} opacity={i === trend.length - 1 ? 1 : 0.45} />)}</svg>
      <b className="money small budget-spent">{v ? formatMoney(v, 'CRC') : '—'}</b>
      <span className="small budget-of">
        {editing ? (
          <input className="input" style={{ height: 26, width: 110, fontSize: 13 }} autoFocus aria-label={`Budget for ${r.category.name}`} value={raw}
            onChange={(e) => setRaw(e.target.value)} onBlur={() => void commit()} onKeyDown={(e) => { if (e.key === 'Enter') void commit(); if (e.key === 'Escape') setEditing(false); }} />
        ) : (
          <button className="budget-btn" onClick={() => { setRaw(budget ? String(budget / 100) : ''); setEditing(true); }} aria-label={`${budget ? `of ${formatMoney(budget, 'CRC')}` : 'set budget'}, edit the budget for ${r.category.name}`}>{budget ? `of ${formatMoney(budget, 'CRC')}` : 'set budget'}</button>
        )}
      </span>
      <span className="small budget-status" style={{ color: bad ? 'var(--expense)' : 'var(--text-2)' }}>{budget > 0 ? (inverse ? (v >= budget ? '✓ reached' : `${formatMoney(budget - v, 'CRC')} to go`) : left >= 0 ? `${formatMoney(left, 'CRC')} left` : `${formatMoney(-left, 'CRC')} over`) : ''}</span>
      <div className="bar budget-bar" aria-hidden>{budget > 0 && <span style={{ width: `${Math.min(1, pct) * 100}%`, background: color }} />}</div>
    </div>
  );
}

function Stat({ label, value, tone, sub }: { label: string; value: number; tone: string; sub?: string }) {
  return (
    <Glass pad={16} style={{ display: 'grid', gap: 2 }}>
      <span className="small muted">{label}</span>
      <span className="money" style={{ fontSize: 24, fontWeight: 750, color: `var(--${tone})` }}>{formatMoney(value, 'CRC')}</span>
      {sub && <span className="small muted">{sub}</span>}
    </Glass>
  );
}

function Row({ r, income, curMonth }: { r: TrackerRow; income: boolean; curMonth: number }) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState('');
  const commit = async () => {
    const v = raw.trim() === '' ? 0 : parseAmountInput(raw, 'CRC');
    if (v !== null) await saveBudget(r.category.id, '*', v);
    setEditing(false);
  };
  const vsBad = income ? r.vsBudget > 0 : r.category.group === 'Savings' ? r.vsBudget > 0 : r.vsBudget < 0;
  return (
    <tr>
      <th className="sticky" scope="row">{r.category.name}</th>
      <td className="num">
        {editing ? (
          <input className="input" style={{ height: 30, width: 110, fontSize: 13 }} autoFocus aria-label={`Budget for ${r.category.name}`} value={raw}
            onChange={(e) => setRaw(e.target.value)} onBlur={() => void commit()} onKeyDown={(e) => { if (e.key === 'Enter') void commit(); if (e.key === 'Escape') setEditing(false); }} />
        ) : (
          <button className="budget-btn" onClick={() => { setRaw(r.budget ? String(r.budget / 100) : ''); setEditing(true); }} aria-label={`${r.budget ? formatMoney(r.budget, 'CRC') : 'set'}, edit budget for ${r.category.name}`}>{r.budget ? formatMoney(r.budget, 'CRC') : 'set'}</button>
        )}
      </td>
      {r.months.map((v, i) => <td key={i} className={`num ${r.over[i] ? 'over' : ''} ${i === curMonth ? 'cur' : ''}`} title={r.over[i] ? 'Over budget' : undefined}>{fmt(v)}</td>)}
      <td className="num">{fmt(r.ytd)}</td>
      <td className="num">{fmt(r.avg)}</td>
      <td className="num" style={{ color: r.budget && vsBad ? 'var(--expense)' : undefined }}>{r.budget ? formatMoney(r.vsBudget, 'CRC', { parens: true }) : '—'}</td>
      <td className="num">{r.ytd ? `${(r.pctOfIncome * 100).toFixed(1)}%` : '—'}</td>
    </tr>
  );
}

function BottomRow({ label, values, ytd, budget, n, signed, strong }: { label: string; values: number[]; ytd: number; budget: number; n: number; signed?: boolean; strong?: boolean }) {
  const c = (v: number) => (signed && v < 0 ? 'var(--expense)' : undefined);
  return (
    <tr style={strong ? { fontWeight: 750 } : undefined}>
      <th className="sticky" scope="row">{label}</th>
      <td className="num" style={{ color: c(budget) }}>{fmt(budget)}</td>
      {values.map((v, i) => <td key={i} className="num" style={{ color: c(v) }}>{fmt(v)}</td>)}
      <td className="num" style={{ color: c(ytd) }}>{fmt(ytd)}</td>
      <td className="num" style={{ color: c(Math.round(ytd / n)) }}>{fmt(Math.round(ytd / n))}</td>
      <td /><td />
    </tr>
  );
}
