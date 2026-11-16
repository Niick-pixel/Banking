import { useMemo, useState } from 'react';
import { useLedger } from '../app/data';
import { Glass, Pill } from '../design/components';
import { PageHeader } from '../ui/Sheet';
import { budgetAlerts, computeTracker, type TrackerRow } from '../domain/tracker';
import { formatMoney, parseAmountInput } from '../lib/money';
import { todayISO } from '../lib/dates';
import { saveBudget } from '../db/repo';
import { usePref } from '../app/prefs';
import { FundMovesFix } from './FundMovesFix';

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

  return (
    <>
      <PageHeader title="Tracker" sub="Budget vs actual. Same layout as your workbook, calculated from your movements.">
        <select className="input" style={{ width: 120 }} aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[...new Set([...years, Number(today.slice(0, 4))])].map((y) => <option key={y}>{y}</option>)}
        </select>
      </PageHeader>
      <FundMovesFix />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Stat label="Income YTD" value={t.ytd.income} tone="income" />
        <Stat label="Expenses YTD" value={t.ytd.expenses} tone="expense" />
        <Stat label="Saved YTD" value={t.ytd.saved} tone="savings" sub={`${(savingsRate * 100).toFixed(1)}% of income`} />
        <Stat label="Free cash YTD" value={t.ytd.freeCash} tone={t.ytd.freeCash < 0 ? 'expense' : 'income'} sub={`${t.monthsWithData} month(s) with data`} />
      </div>

      {alerts.length > 0 && (
        <Glass strong pad={16} style={{ marginBottom: 16 }} role="region" aria-label="Budget alerts this month">
          <b>This month</b>
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
    </>
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
