/**
 * Budget: a clean overview of the last months.
 *  1. Four numbers for the month: spent, budget, on track (ring), income.
 *  2. Monthly comparison: income, budget and spending side by side.
 *  3. One table: every category by month, how much of this month's budget is used, and its trend.
 * The full workbook-style year table is still one click away ("Year table").
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronRight } from 'lucide-react';
import { useLedger } from '../app/data';
import { useCssVar } from '../app/theme';
import { Glass, Pill, Segmented } from '../design/components';
import { InfoTip } from '../design/components/InfoTip';
import { usePersisted } from '../app/persist';
import { PageHeader } from '../ui/Sheet';
import { budgetAlerts, budgetFor, computeTracker, type TrackerRow } from '../domain/tracker';
import { CATEGORY_GROUPS, type Category } from '../domain/schemas';
import { formatMoney, parseAmountInput } from '../lib/money';
import { todayISO } from '../lib/dates';
import { saveBudget } from '../db/repo';
import { usePref } from '../app/prefs';
import { FundMovesFix } from './FundMovesFix';

const MS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const GROUP_LABEL: Record<string, string> = { Income: 'Income', Fixed: 'Fixed costs', Living: 'Living', Discretionary: 'Discretionary', 'Debt Service': 'Debt payments', Savings: 'Savings' };
const SPEND = ['Fixed', 'Living', 'Discretionary', 'Debt Service'];
const fmt = (v: number) => (v === 0 ? '—' : formatMoney(v, 'CRC', { parens: true }));
const short = (v: number) => { const a = Math.abs(v) / 100; const s = a >= 1_000_000 ? `${(a / 1_000_000).toFixed(1)}M` : a >= 1000 ? `${Math.round(a / 1000)}k` : `${Math.round(a)}`; return `${v < 0 ? '-' : ''}₡${s}`; };
const shiftMonth = (mk: string, d: number) => { const [y, m] = mk.split('-').map(Number) as [number, number]; const i = y * 12 + m - 1 + d; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; };
const SLOT = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5'];

export default function Tracker() {
  const [view, setView] = usePersisted<'overview' | 'year'>('budget.view2', 'overview');
  return (
    <>
      <PageHeader title="Budget" sub={view === 'overview' ? 'How your spending compares with your plan, month by month.' : 'The full year, laid out like your workbook.'}>
        <Segmented label="View" value={view} onChange={setView} options={[{ value: 'overview', label: 'Overview' }, { value: 'year', label: 'Year table' }]} />
      </PageHeader>
      <FundMovesFix />
      {view === 'overview' ? <Overview /> : <YearTable />}
    </>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────
function Overview() {
  const l = useLedger();
  const today = todayISO();
  const cur = today.slice(0, 7);
  const [span, setSpan] = usePersisted<number>('budget.span', 6);
  const [warnAt] = usePref('budgetWarnPct');
  const months = useMemo(() => Array.from({ length: span }, (_, i) => shiftMonth(cur, i - span + 1)), [cur, span]);
  const [income, spend, budgetLine, axis, grid] = useCssVar(['--chart-income', '--chart-2', '--chart-4', '--chart-axis', '--chart-grid']);
  const cats = l.categories.filter((c) => !c.archived);
  const spendCats = cats.filter((c) => SPEND.includes(c.group));
  const flow = (m: string) => l.flows.get(m);
  const spentIn = (m: string) => flow(m)?.expenses ?? 0;
  const budgetIn = (m: string) => spendCats.reduce((s, c) => s + budgetFor(l.budgets, c.id, m), 0);
  const prev = shiftMonth(cur, -1);
  const spent = spentIn(cur), budget = budgetIn(cur), inc = flow(cur)?.income ?? 0, incPrev = flow(prev)?.income ?? 0, spentPrev = spentIn(prev);
  const used = budget ? spent / budget : 0;
  const day = Number(today.slice(8, 10)), dim = new Date(Date.UTC(Number(cur.slice(0, 4)), Number(cur.slice(5, 7)), 0)).getUTCDate();
  const expectedByNow = budget * (day / dim);
  const status = !budget ? 'none' : spent > budget ? 'over' : spent > expectedByNow * 1.1 ? 'ahead' : 'ok';
  const chart = months.map((m) => ({ month: MS[Number(m.slice(5)) - 1], Income: flow(m)?.income ?? 0, Budget: budgetIn(m), Spending: spentIn(m) }));
  const alerts = useMemo(() => budgetAlerts(computeTracker(Number(cur.slice(0, 4)), l.transactions.filter((t) => t.currency === 'CRC'), l.categories, l.budgets, { accountType: (id) => l.account.get(id)?.type }), today, warnAt), [l, cur, today, warnAt]);
  const pctChange = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : null);
  const sc = pctChange(spent, spentPrev), ic = pctChange(inc, incPrev);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="bkpis">
        <Glass pad={18} className="bkpi">
          <span className="bkpi-label">Spent this month <InfoTip text="Everything you paid this month: fixed costs, living, discretionary and debt payments. Savings are not spending." /></span>
          <b className="money bkpi-val">{formatMoney(spent, 'CRC')}</b>
          {sc !== null && <span className="small" style={{ color: sc > 0 ? 'var(--expense)' : 'var(--income)' }}>{sc > 0 ? '↑' : '↓'} {Math.abs(sc)}% vs last month</span>}
        </Glass>
        <Glass pad={18} className="bkpi">
          <span className="bkpi-label">Budget <InfoTip text="The sum of this month's budgets for all spending categories. Change them in the table below (click an amount) or in Categories." /></span>
          <b className="money bkpi-val">{budget ? formatMoney(budget, 'CRC') : 'Not set'}</b>
          <span className="small muted">for {spendCats.filter((c) => budgetFor(l.budgets, c.id, cur) > 0).length} categories</span>
        </Glass>
        <Glass pad={18} className="bkpi bkpi-ring">
          <Ring pct={used} tone={status === 'over' ? 'var(--expense)' : status === 'ahead' ? 'var(--debt)' : 'var(--income)'} />
          <div style={{ display: 'grid', gap: 2 }}>
            <b style={{ fontSize: 20 }}>{status === 'over' ? 'Over budget' : status === 'ahead' ? 'Spending fast' : status === 'ok' ? 'On track' : 'No budget'} {status === 'ok' && <span style={{ color: 'var(--income)' }}>✓</span>}</b>
            <span className="small muted">{budget ? (spent <= budget ? `${formatMoney(budget - spent, 'CRC')} left for ${dim - day} days` : `${formatMoney(spent - budget, 'CRC')} over`) : 'Set budgets to track this'}
              <InfoTip text={`On track means you've used no more of the budget than the share of the month that has passed (${Math.round((day / dim) * 100)}% today), with a 10% margin.`} label="How on track is decided" /></span>
          </div>
        </Glass>
        <Glass pad={18} className="bkpi">
          <span className="bkpi-label">Income this month <InfoTip text="Salary and any other money that came in this month." /></span>
          <b className="money bkpi-val" style={{ color: 'var(--income)' }}>{formatMoney(inc, 'CRC')}</b>
          {ic !== null && <span className="small" style={{ color: ic >= 0 ? 'var(--income)' : 'var(--expense)' }}>{ic >= 0 ? '↑' : '↓'} {Math.abs(ic)}% vs last month</span>}
        </Glass>
      </div>

      <Glass strong pad={20} style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 className="card-h" style={{ margin: 0 }}>Monthly comparison <InfoTip text="For each month: what came in, what you planned to spend, and what you actually spent. Spending above the budget bar means that month went over." /></h2>
          <Segmented label="Period" value={String(span)} onChange={(v) => setSpan(Number(v))} options={[{ value: '3', label: '3 months' }, { value: '6', label: '6 months' }, { value: '12', label: '12 months' }]} />
        </div>
        <div style={{ height: 250 }} role="img" aria-label={`Income, budget and spending by month: ${chart.map((c) => `${c.month} income ${short(c.Income)}, budget ${short(c.Budget)}, spending ${short(c.Spending)}`).join('; ')}`}>
          <ResponsiveContainer>
            <BarChart data={chart} margin={{ top: 18, right: 4, left: 0, bottom: 0 }} barGap={4} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke={grid} />
              <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: axis, fontSize: 12 }} />
              <YAxis tickFormatter={short} tickLine={false} axisLine={false} width={56} tick={{ fill: axis, fontSize: 12 }} />
              <Tooltip formatter={(v: number) => formatMoney(v, 'CRC')} contentStyle={{ background: 'var(--solid-surface)', border: '1px solid var(--glass-border)', borderRadius: 12 }} cursor={{ fill: 'var(--accent-soft)' }} />
              <Legend iconType="circle" iconSize={9} wrapperStyle={{ fontSize: 13 }} align="right" verticalAlign="top" height={26} />
              <Bar isAnimationActive={false} dataKey="Income" fill={income} radius={[4, 4, 0, 0]} />
              <Bar isAnimationActive={false} dataKey="Budget" fill={budgetLine} radius={[4, 4, 0, 0]} />
              <Bar isAnimationActive={false} dataKey="Spending" fill={spend} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Glass>

      <CategoriesTable months={months} />

      {alerts.length > 0 && (
        <Glass strong pad={18} role="region" aria-label="Budget alerts this month">
          <h2 className="card-h" style={{ margin: '0 0 8px' }}>Watch this month <InfoTip text="Categories at 80% or more of their budget (change the threshold in Settings → Budgets). For living and discretionary spending it also projects where you'll end the month at today's pace." /></h2>
          <ul className="watch-list">
            {alerts.map((a) => (
              <li key={a.category.id}>
                <Pill tone={a.level === 'over' ? 'expense' : a.level === 'full' ? 'neutral' : 'debt'}>{a.level === 'over' ? 'Over' : a.level === 'full' ? 'At budget' : `${Math.round(a.pct * 100)}%`}</Pill>
                <span><b>{a.category.name}</b>: {formatMoney(a.spent, 'CRC')} of {formatMoney(a.budget, 'CRC')}{a.projected > a.spent && a.projected > a.budget ? <span className="muted">. At this pace: {formatMoney(a.projected, 'CRC')} by month end</span> : null}</span>
              </li>
            ))}
          </ul>
        </Glass>
      )}
    </div>
  );
}

function Ring({ pct, tone }: { pct: number; tone: string }) {
  const r = 30, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct));
  return (
    <svg width="76" height="76" viewBox="0 0 76 76" role="img" aria-label={`${Math.round(pct * 100)}% of the budget used`}>
      <circle cx="38" cy="38" r={r} fill="none" stroke="var(--input-bg)" strokeWidth="8" />
      <circle cx="38" cy="38" r={r} fill="none" stroke={tone} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${c * p} ${c}`} transform="rotate(-90 38 38)" />
      <text x="38" y="43" textAnchor="middle" fontSize="16" fontWeight="750" fill="var(--text)">{Math.round(pct * 100)}%</text>
    </svg>
  );
}

/** Every category by month, this month's use of its budget, and the trend. Grouped, with group totals. */
function CategoriesTable({ months }: { months: string[] }) {
  const l = useLedger();
  const cur = months.at(-1)!;
  const [open, setOpen] = usePersisted<string[]>('budget.groupsOpen', SPEND);
  const colors = useCssVar(SPEND.map((_, i) => SLOT[i % SLOT.length]!));
  const val = (c: Category, m: string) => l.flows.get(m)?.byCategory.get(c.id) ?? 0;
  const groups: Category['group'][] = [...CATEGORY_GROUPS.filter((g) => g !== 'Income'), 'Income'];
  return (
    <Glass strong pad={0} style={{ overflow: 'hidden' }}>
      <div className="btable-head">
        <h2 className="card-h" style={{ margin: 0 }}>Categories <InfoTip text="Each row is one category. Month columns show what you spent (or saved, or earned). The bar shows how much of this month's budget is used; click the budget to change it. Trend is the same months as a line. The arrow opens its movements." /></h2>
      </div>
      <div className="btable-wrap">
        <table className="btable">
          <thead>
            <tr>
              <th className="bt-name">Category</th>
              {months.map((m) => <th key={m} className={`num ${m === cur ? 'cur' : ''}`}>{MS[Number(m.slice(5)) - 1]}</th>)}
              <th className="bt-budget">This month vs budget</th>
              <th className="bt-trend">Trend</th>
              <th><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          {groups.map((g, gi) => {
            const rows = l.categories.filter((c) => c.group === g && !c.archived).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
            if (!rows.length) return null;
            const isOpen = open.includes(g);
            const totals = months.map((m) => rows.reduce((s, c) => s + val(c, m), 0));
            const gBudget = rows.reduce((s, c) => s + budgetFor(l.budgets, c.id, cur), 0);
            const color = g === 'Income' ? 'var(--income)' : g === 'Savings' ? 'var(--savings)' : colors[gi % colors.length]!;
            return (
              <tbody key={g}>
                <tr className="bt-group">
                  <th className="bt-name">
                    <button className="bt-toggle" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? open.filter((x) => x !== g) : [...open, g])}>
                      <ChevronRight size={15} className={isOpen ? 'rot' : ''} aria-hidden /><span className="bt-dot" style={{ background: color }} />{GROUP_LABEL[g]} <span className="muted small">· {rows.length}</span>
                    </button>
                  </th>
                  {totals.map((v, i) => <td key={i} className={`num ${months[i] === cur ? 'cur' : ''}`}>{fmt(v)}</td>)}
                  <td><UseBar spent={totals.at(-1)!} budget={gBudget} inverse={g === 'Income' || g === 'Savings'} /></td>
                  <td><Spark values={totals} color={color} /></td>
                  <td />
                </tr>
                {isOpen && rows.map((c) => <CatRow key={c.id} c={c} months={months} cur={cur} color={color} values={months.map((m) => val(c, m))} />)}
              </tbody>
            );
          })}
          <tbody className="bt-foot">
            {[
              ['Income', months.map((m) => l.flows.get(m)?.income ?? 0)],
              ['Spending', months.map((m) => l.flows.get(m)?.expenses ?? 0)],
              ['Saved', months.map((m) => l.flows.get(m)?.saved ?? 0)],
              ['Left after saving', months.map((m) => l.flows.get(m)?.freeCash ?? 0)],
            ].map(([label, vals]) => (
              <tr key={label as string}>
                <th className="bt-name">{label as string}</th>
                {(vals as number[]).map((v, i) => <td key={i} className={`num ${months[i] === cur ? 'cur' : ''}`} style={{ color: label === 'Left after saving' && v < 0 ? 'var(--expense)' : undefined }}>{fmt(v)}</td>)}
                <td colSpan={3} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Glass>
  );
}

function CatRow({ c, months, cur, color, values }: { c: Category; months: string[]; cur: string; color: string; values: number[] }) {
  const l = useLedger();
  const budget = budgetFor(l.budgets, c.id, cur);
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState('');
  const commit = async () => { const v = raw.trim() === '' ? 0 : parseAmountInput(raw, 'CRC'); if (v !== null) await saveBudget(c.id, '*', v); setEditing(false); };
  return (
    <tr>
      <th className="bt-name bt-cat" scope="row" title={c.name}>{c.name}{c.discretionary && <span className="bt-tag">avoidable</span>}</th>
      {values.map((v, i) => <td key={i} className={`num ${months[i] === cur ? 'cur' : ''}`}>{fmt(v)}</td>)}
      <td>
        <div className="bt-use">
          <UseBar spent={values.at(-1)!} budget={budget} inverse={c.group === 'Income' || c.group === 'Savings'} />
          {editing ? (
            <input className="input" style={{ height: 28, width: 110, fontSize: 13 }} autoFocus aria-label={`Budget for ${c.name}`} value={raw}
              onChange={(e) => setRaw(e.target.value)} onBlur={() => void commit()} onKeyDown={(e) => { if (e.key === 'Enter') void commit(); if (e.key === 'Escape') setEditing(false); }} />
          ) : (
            <button className="budget-btn small" onClick={() => { setRaw(budget ? String(budget / 100) : ''); setEditing(true); }} aria-label={`${budget ? `of ${short(budget)}` : 'set budget'}, edit the budget for ${c.name}`}>{budget ? `of ${short(budget)}` : 'set budget'}</button>
          )}
        </div>
      </td>
      <td><Spark values={values} color={color} /></td>
      <td><Link to={`/transactions?cat=${c.id}&month=${cur}`} className="bt-go" aria-label={`See ${c.name} movements`}><ChevronRight size={16} /></Link></td>
    </tr>
  );
}

function UseBar({ spent, budget, inverse }: { spent: number; budget: number; inverse?: boolean }) {
  if (!budget) return null;
  const pct = spent / budget;
  const color = inverse ? (pct >= 1 ? 'var(--income)' : 'var(--debt)') : pct > 1 ? 'var(--expense)' : pct >= 0.8 ? 'var(--debt)' : 'var(--income)';
  return (
    <span className="bt-bar" title={`${formatMoney(spent, 'CRC')} of ${formatMoney(budget, 'CRC')}`}>
      <span className="bar" aria-hidden><span style={{ width: `${Math.min(1, Math.max(0, pct)) * 100}%`, background: color }} /></span>
      <b className="small" style={{ color: !inverse && pct > 1 ? 'var(--expense)' : undefined }}>{Math.round(pct * 100)}%</b>
    </span>
  );
}

function Spark({ values, color }: { values: number[]; color: string }) {
  if (!values.some((v) => v !== 0)) return <span className="small muted">—</span>;
  return (
    <div className="bt-spark" aria-hidden>
      <ResponsiveContainer>
        <LineChart data={values.map((v, i) => ({ i, v }))} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Line dataKey="v" stroke={color} strokeWidth={2} dot={{ r: 2.2, strokeWidth: 0, fill: color }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Year table (the workbook layout) ──────────────────────────────────────
function YearTable() {
  const l = useLedger();
  const today = todayISO();
  const years = useMemo(() => [...new Set([...l.transactions.map((t) => Number(t.date.slice(0, 4))), Number(today.slice(0, 4))])].sort(), [l.transactions, today]);
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const t = useMemo(() => computeTracker(year, l.transactions.filter((x) => x.currency === 'CRC'), l.categories, l.budgets, { accountType: (id) => l.account.get(id)?.type }), [year, l]);
  const curMonth = year === Number(today.slice(0, 4)) ? Number(today.slice(5, 7)) - 1 : -1;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <label htmlFor="yt-year" className="small muted">Year</label>
        <select id="yt-year" className="input" style={{ width: 120, height: 38 }} value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y}>{y}</option>)}</select>
      </div>
      <Glass strong pad={0} style={{ overflow: 'hidden' }}>
        <div className="tracker-wrap" tabIndex={0} aria-label="Year table, scroll horizontally">
          <table className="table tracker">
            <thead>
              <tr>
                <th className="sticky">Category</th><th className="num">Budget</th>
                {MS.map((m, i) => <th key={m} className={`num ${i === curMonth ? 'cur' : ''}`}>{m}</th>)}
                <th className="num">YTD</th><th className="num">Avg / mo</th><th className="num">vs budget</th><th className="num">% income</th>
              </tr>
            </thead>
            {t.sections.map((s) => (
              <tbody key={s.group}>
                <tr className="group-row"><th className="sticky" colSpan={1}>{GROUP_LABEL[s.group]}</th><td colSpan={17} /></tr>
                {s.rows.map((r) => <YearRow key={r.category.id} r={r} income={s.group === 'Income'} curMonth={curMonth} />)}
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
      <p className="small muted" style={{ margin: 0 }}>Red cells: spending over budget, or saving under target. Averages count only months with income. Click a budget to edit it.</p>
    </div>
  );
}

function YearRow({ r, income, curMonth }: { r: TrackerRow; income: boolean; curMonth: number }) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState('');
  const commit = async () => { const v = raw.trim() === '' ? 0 : parseAmountInput(raw, 'CRC'); if (v !== null) await saveBudget(r.category.id, '*', v); setEditing(false); };
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
