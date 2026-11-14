import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, Cell, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useHealth, useLedger } from '../app/data';
import { usePref } from '../app/prefs';
import { useCssVar } from '../app/theme';
import { useQuickAdd } from '../app/QuickAdd';
import { Glass, Money, Pill } from '../design/components';
import { GroupDonut, IncomeExpenseChart } from '../design/components/charts';
import { Empty, PageHeader } from '../ui/Sheet';
import { monthSummary } from '../domain/insights';
import { computeTracker, budgetFor } from '../domain/tracker';
import { debtStatus } from '../domain/ledger';
import { nextPaymentDate } from '../domain/debts';
import { planProgress } from '../domain/installments';
import { emergencyFund, netWorthSeries } from '../domain/networth';
import { selfLoanProgress } from '../domain/debts';
import { formatMoney } from '../lib/money';
import { daysBetween, formatDateCR, todayISO } from '../lib/dates';
import { useEssentials } from './NetWorth';

const MN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shift = (mk: string, d: number) => { const [y, m] = mk.split('-').map(Number) as [number, number]; const i = y * 12 + m - 1 + d; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; };

export default function Dashboard() {
  const l = useLedger();
  const qa = useQuickAdd();
  const health = useHealth();
  const today = todayISO();
  const [mk, setMk] = useState(today.slice(0, 7));
  const [target] = usePref('savingsRateTarget');
  const [efTarget] = usePref('efTargetMonths');
  const year = Number(mk.slice(0, 4)), month = Number(mk.slice(5, 7));
  const f = l.flows.get(mk);
  const sum = monthSummary(f, l.flows.get(shift(mk, -1)), l.categories, l.budgets, target);
  const tracker = useMemo(() => computeTracker(year, l.transactions.filter((t) => t.currency === 'CRC'), l.categories, l.budgets, { accountType: (id) => l.account.get(id)?.type }), [l, year]);
  const essentials = useEssentials(year);
  const nw = useMemo(() => netWorthSeries({ accounts: l.accounts, snapshots: l.snapshots, transactions: l.transactions, debts: l.debts, installments: l.installments }, Number(today.slice(0, 4)), today), [l, today]);
  const [inc, exp, axis, grid, c1] = useCssVar(['--chart-income', '--chart-expense', '--chart-axis', '--chart-grid', '--chart-1']);

  if (l.ready && !l.accounts.length) {
    return (<><PageHeader title="Aufwind" sub="Rise on what you already have." /><Empty title="Welcome"><p className="muted" style={{ margin: 0 }}>Import your workbook to see your month at a glance.</p><Link className="btn btn-primary" to="/import">Import workbook</Link></Empty></>);
  }

  // Last 6 months with any data, ending at the selected month.
  const months = Array.from({ length: 6 }, (_, i) => shift(mk, i - 5)).filter((m) => l.flows.has(m));
  const flowData = months.map((m) => ({ month: MS[Number(m.slice(5)) - 1]!, income: l.flows.get(m)!.income, expenses: l.flows.get(m)!.expenses }));
  const netData = months.map((m) => ({ month: MS[Number(m.slice(5)) - 1]!, net: l.flows.get(m)!.freeCash }));
  const groups = (['Fixed', 'Living', 'Discretionary', 'Debt Service'] as const).map((g) => ({ name: g, value: [...(f?.byCategory ?? [])].filter(([id]) => l.category.get(id)?.group === g).reduce((s, [, v]) => s + Math.max(0, v), 0) })).filter((x) => x.value > 0);
  const ranking = [...(f?.byCategory ?? [])].map(([id, v]) => ({ c: l.category.get(id)!, v })).filter((x) => x.c && !['Income', 'Savings'].includes(x.c.group) && x.v > 0).sort((a, b) => b.v - a.v).slice(0, 8);
  const maxRank = Math.max(1, ...ranking.map((x) => x.v));
  const budgetRows = tracker.sections.filter((s) => !['Income', 'Savings'].includes(s.group)).flatMap((s) => s.rows).map((r) => ({ r, b: budgetFor(l.budgets, r.category.id, mk), spent: r.months[month - 1]! })).filter((x) => x.b > 0 && x.spent > 0).map((x) => ({ ...x, pct: x.spent / x.b })).sort((a, b) => b.pct - a.pct).slice(0, 6);

  // Upcoming 30 days: Tasa Cero cuotas, debt payments, self-loan plans.
  const upcoming: { date: string; label: string; amount?: number; to: string }[] = [];
  for (const p of l.installments.filter((p) => p.status === 'active')) { const pr = planProgress(p, today); if (pr.nextDate && daysBetween(today, pr.nextDate) <= 30) upcoming.push({ date: pr.nextDate, label: `${p.description} · cuota ${pr.billedCount + 1}/${p.months}`, amount: pr.nextAmount, to: '/tasa-cero' }); }
  for (const d of l.debts.filter((d) => d.status !== 'paid' && d.plannedMonthlyPayment)) { const st = debtStatus(d, l.transactions); if (st.balance <= 0) continue; const dt = nextPaymentDate(d, today); if (daysBetween(today, dt) <= 30) upcoming.push({ date: dt, label: `Pay ${d.creditor}`, amount: Math.min(d.plannedMonthlyPayment!, st.balance), to: '/debts' }); }
  for (const p of selfLoanProgress(l.selfLoans, l.transactions, l.categories)) if (!p.done && p.loan.plannedDate && daysBetween(today, p.loan.plannedDate) <= 30) upcoming.push({ date: p.loan.plannedDate, label: `Replenish: ${p.loan.description}`, amount: p.remaining, to: '/debts' });
  upcoming.sort((a, b) => a.date.localeCompare(b.date));

  const current = nw.at(-1);
  const potBal = new Map(l.pots.map((p) => [p.id, l.balances.get(p.accountId)?.pots.get(p.id) ?? 0]));
  const ef = current ? emergencyFund(current, l.accounts, l.pots, potBal, essentials) : null;
  const activeDebts = l.debts.filter((d) => d.status !== 'paid');
  const errors = health.filter((h) => h.level !== 'info').length;

  return (
    <>
      <PageHeader title={`${MN[month - 1]} ${year}`} sub={mk === today.slice(0, 7) ? `Month so far · ${formatDateCR(today)}` : 'Month at a glance'}>
        <button className="btn btn-sm" aria-label="Previous month" onClick={() => setMk(shift(mk, -1))}>‹</button>
        <button className="btn btn-sm" aria-label="Next month" disabled={mk >= today.slice(0, 7)} onClick={() => setMk(shift(mk, 1))}>›</button>
        <Link to="/settings#health" className="btn btn-sm" aria-label={`Data health: ${errors} to check`}>{errors ? <><span className="dot" style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--debt)', display: 'inline-block' }} /> {errors} to check</> : <>✓ Data healthy</>}</Link>
        <button className="btn btn-primary btn-sm" onClick={() => qa.open()}>+ Add</button>
      </PageHeader>

      <div className="kpis">
        <Kpi label="Income" value={f?.income ?? 0} tone="income" />
        <Kpi label="Expenses" value={f?.expenses ?? 0} tone="expense" sub={f?.debtService ? `incl. ${formatMoney(f.debtService, 'CRC')} debt` : undefined} />
        <Kpi label="Net" value={f?.net ?? 0} tone="auto" />
        <Kpi label="Saved" value={f?.saved ?? 0} tone="savings" sub={f?.income ? <><b>{(sum.savingsRate * 100).toFixed(1)}%</b> of income · target {Math.round(target * 100)}%</> : undefined} />
        <Kpi label="Free cash after saving" value={f?.freeCash ?? 0} tone="auto" />
      </div>

      <div className="dash-grid">
        <Glass strong className="span-2" style={{ display: 'grid', gap: 8 }}>
          <h2 className="card-h">What happened</h2>
          {sum.insights.length === 0 ? <p className="muted" style={{ margin: 0 }}>No movements yet this month.</p> : (
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
              {sum.insights.map((i, k) => <li key={k} style={{ display: 'flex', gap: 8 }}><span aria-hidden style={{ color: i.tone === 'good' ? 'var(--income)' : i.tone === 'bad' ? 'var(--expense)' : 'var(--text-3)' }}>●</span><span>{i.text}</span></li>)}
            </ul>
          )}
        </Glass>

        <Glass strong style={{ display: 'grid', gap: 8 }}>
          <h2 className="card-h">Coming up (30 days)</h2>
          {upcoming.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Nothing scheduled. Recurring bills arrive in Phase 8.</p> : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
              {upcoming.slice(0, 6).map((u, k) => <li key={k}><Link to={u.to} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: 'inherit', textDecoration: 'none' }}><span><span className="muted small">{formatDateCR(u.date).slice(0, 5)}</span> {u.label}</span>{u.amount !== undefined && <span className="money">{formatMoney(u.amount, 'CRC')}</span>}</Link></li>)}
            </ul>
          )}
        </Glass>

        <Glass strong className="span-2"><IncomeExpenseChart title="Income vs expenses" data={flowData} /></Glass>
        <Glass strong><GroupDonut title="Spending by group" data={groups} /></Glass>

        <Glass strong style={{ display: 'grid', gap: 8 }}>
          <h2 className="card-h">Where it went</h2>
          {ranking.length === 0 ? <p className="muted small" style={{ margin: 0 }}>No spending yet.</p> : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }} aria-label="Top categories this month">
              {ranking.map((x) => (
                <li key={x.c.id} style={{ display: 'grid', gap: 3 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }} className="small"><span>{x.c.name}{x.c.discretionary && <span className="muted"> · avoidable</span>}</span><span className="money">{formatMoney(x.v, 'CRC')}</span></div>
                  <div className="bar" aria-hidden><span style={{ width: `${(x.v / maxRank) * 100}%`, background: 'var(--chart-1)' }} /></div>
                </li>
              ))}
            </ul>
          )}
        </Glass>

        <Glass strong style={{ display: 'grid', gap: 8 }}>
          <h2 className="card-h">Budget health</h2>
          {budgetRows.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Set budgets in the Tracker.</p> : budgetRows.map((x) => (
            <div key={x.r.category.id} style={{ display: 'grid', gap: 3 }}>
              <div className="small" style={{ display: 'flex', justifyContent: 'space-between' }}><span>{x.r.category.name}</span><span className="money" style={{ color: x.pct > 1 ? 'var(--expense)' : undefined }}>{Math.round(x.pct * 100)}%</span></div>
              <div className="bar" aria-hidden><span style={{ width: `${Math.min(1, x.pct) * 100}%`, background: x.pct > 1 ? 'var(--expense)' : x.pct >= 0.8 ? 'var(--debt)' : 'var(--income)' }} /></div>
            </div>
          ))}
          <Link to="/tracker" className="small">Full tracker →</Link>
        </Glass>

        <Glass strong style={{ display: 'grid', gap: 8 }}>
          <h2 className="card-h">Free cash by month</h2>
          <div style={{ height: 170 }} role="img" aria-label={`Free cash after saving: ${netData.map((d) => `${d.month} ${formatMoney(d.net, 'CRC')}`).join(', ')}`}>
            <ResponsiveContainer>
              <BarChart data={netData} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={grid} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: axis, fontSize: 11 }} />
                <YAxis hide />
                <ReferenceLine y={0} stroke={axis} />
                <Tooltip formatter={(v: number) => formatMoney(v, 'CRC')} contentStyle={{ background: 'var(--solid-surface)', border: '1px solid var(--glass-border)', borderRadius: 12 }} cursor={{ fill: 'var(--accent-soft)' }} />
                <Bar dataKey="net" name="Free cash" radius={[4, 4, 4, 4]}>{netData.map((d) => <Cell key={d.month} fill={d.net >= 0 ? inc : exp} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Glass>

        <Glass strong style={{ display: 'grid', gap: 8 }}>
          <h2 className="card-h">Net worth</h2>
          {current ? <>
            <Money amount={current.netWorth} size={26} weight={800} tone="auto" />
            <div style={{ height: 90 }} role="img" aria-label="Net worth trend this year">
              <ResponsiveContainer><LineChart data={nw.map((s) => ({ m: s.month, v: s.netWorth }))}><Line isAnimationActive={false} dataKey="v" stroke={c1} strokeWidth={2} dot={false} /><YAxis hide domain={['auto', 'auto']} /></LineChart></ResponsiveContainer>
            </div>
            {ef && essentials > 0 && <div className="small">Emergency fund <b>{ef.liquidMonths.toFixed(1)}</b> / {efTarget} months liquid · {ef.totalMonths.toFixed(1)} incl. cesantía</div>}
            <Link to="/net-worth" className="small">Balance sheet →</Link>
          </> : <p className="muted small">No data.</p>}
        </Glass>

        <Glass strong style={{ display: 'grid', gap: 10 }}>
          <h2 className="card-h">Debts</h2>
          {activeDebts.length === 0 ? <Pill tone="income">No active debts</Pill> : activeDebts.map((d) => {
            const st = debtStatus(d, l.transactions);
            const pct = Math.max(0, Math.min(1, 1 - st.balance / d.originalAmount));
            return (
              <div key={d.id} style={{ display: 'grid', gap: 3 }}>
                <div className="small" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{d.creditor}</span><span className="money">{formatMoney(st.balance, 'CRC')}</span></div>
                <div className="bar" aria-label={`${Math.round(pct * 100)}% paid`}><span style={{ width: `${pct * 100}%`, background: 'var(--debt)' }} /></div>
              </div>
            );
          })}
          <Link to="/debts" className="small">Payoff plans →</Link>
        </Glass>
      </div>
    </>
  );
}

function Kpi({ label, value, tone, sub }: { label: string; value: number; tone: 'income' | 'expense' | 'savings' | 'auto'; sub?: React.ReactNode }) {
  return (
    <Glass pad={16} style={{ display: 'grid', gap: 2 }}>
      <span className="small muted">{label}</span>
      <Money amount={value} size={24} weight={800} tone={tone} />
      {sub && <span className="small muted">{sub}</span>}
    </Glass>
  );
}
