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
import { emergencyFund, netWorthSeries } from '../domain/networth';
import { formatMoney } from '../lib/money';
import { formatDateCR, todayISO } from '../lib/dates';
import { useEssentials } from './NetWorth';
import { useCalendar, usePendingReminders } from '../app/useRecurring';
import { useCoach } from '../app/coach';
import { CoachTop } from './Coach';
import { CardsWidget } from './CardsWidget';
import { SetupChecklist, useSetup } from './Setup';
import { InfoTip } from '../design/components/InfoTip';
import { Deck, type DeckView } from '../design/components/Deck';
import { MonthWaterfall, SpendingCalendar, SpendingPace } from '../design/components/insightCharts';
import { SPEND_GROUPS, cumulative, dailySpending, monthWaterfall } from '../domain/spending';

const addDays = (d: string, n: number) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

const MN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shift = (mk: string, d: number) => { const [y, m] = mk.split('-').map(Number) as [number, number]; const i = y * 12 + m - 1 + d; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; };

export default function Dashboard() {
  const l = useLedger();
  const qa = useQuickAdd();
  const coach = useCoach();
  const health = useHealth();
  const today = todayISO();
  const [mk, setMk] = useState(today.slice(0, 7));
  const [target] = usePref('savingsRateTarget');
  const [efTarget] = usePref('efTargetMonths');
  const [hidden] = usePref('dashHidden');
  const show = (id: string) => !hidden.includes(id);
  const year = Number(mk.slice(0, 4)), month = Number(mk.slice(5, 7));
  const f = l.flows.get(mk);
  const sum = monthSummary(f, l.flows.get(shift(mk, -1)), l.categories, l.budgets, target);
  const tracker = useMemo(() => computeTracker(year, l.transactions.filter((t) => t.currency === 'CRC'), l.categories, l.budgets, { accountType: (id) => l.account.get(id)?.type }), [l, year]);
  const essentials = useEssentials(year);
  const nw = useMemo(() => netWorthSeries({ accounts: l.accounts, snapshots: l.snapshots, transactions: l.transactions, debts: l.debts, installments: l.installments }, Number(today.slice(0, 4)), today), [l, today]);
  const calendar = useCalendar(addDays(today, 0), addDays(today, 30));
  const pending = usePendingReminders();
  const [inc, exp, axis, grid, c1] = useCssVar(['--chart-income', '--chart-expense', '--chart-axis', '--chart-grid', '--chart-1']);

  if (l.ready && !l.accounts.length) {
    return (<><PageHeader title="Aufwind" sub="Rise on what you already have." /><Empty title="Welcome"><p className="muted" style={{ margin: 0 }}>Import your workbook to see your month at a glance.</p><Link className="btn btn-primary" to="/import">Import workbook</Link></Empty></>);
  }

  // Insight charts: daily spending for the calendar (30 weeks) and the pace lines (this + last month).
  const daysIn = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
  const dim = daysIn(mk);
  const paceDay = mk === today.slice(0, 7) ? Number(today.slice(8, 10)) : mk < today.slice(0, 7) ? dim : 0;
  const daily = dailySpending(l.transactions, `${shift(today.slice(0, 7), -13)}-01`, today);
  const spendBudget = l.categories.filter((c) => SPEND_GROUPS.includes(c.group as (typeof SPEND_GROUPS)[number])).reduce((s, c) => s + budgetFor(l.budgets, c.id, mk), 0);

  // Last 6 months with any data, ending at the selected month.
  const months = Array.from({ length: 6 }, (_, i) => shift(mk, i - 5)).filter((m) => l.flows.has(m));
  const flowData = months.map((m) => ({ month: MS[Number(m.slice(5)) - 1]!, income: l.flows.get(m)!.income, expenses: l.flows.get(m)!.expenses }));
  const netData = months.map((m) => ({ month: MS[Number(m.slice(5)) - 1]!, net: l.flows.get(m)!.freeCash }));
  const groups = (['Fixed', 'Living', 'Discretionary', 'Debt Service'] as const).map((g, slot) => ({ name: g, slot, value: [...(f?.byCategory ?? [])].filter(([id]) => l.category.get(id)?.group === g).reduce((s, [, v]) => s + Math.max(0, v), 0) })).filter((x) => x.value > 0);
  const ranking = [...(f?.byCategory ?? [])].map(([id, v]) => ({ c: l.category.get(id)!, v })).filter((x) => x.c && !['Income', 'Savings'].includes(x.c.group) && x.v > 0).sort((a, b) => b.v - a.v).slice(0, 12);
  const maxRank = Math.max(1, ...ranking.map((x) => x.v));
  const budgetRows = tracker.sections.filter((s) => !['Income', 'Savings'].includes(s.group)).flatMap((s) => s.rows).map((r) => ({ r, b: budgetFor(l.budgets, r.category.id, mk), spent: r.months[month - 1]! })).filter((x) => x.b > 0 && x.spent > 0).map((x) => ({ ...x, pct: x.spent / x.b })).sort((a, b) => b.pct - a.pct).slice(0, 6);

  // Upcoming 30 days: recurring items, Tasa Cero cuotas, debt payments, card due dates, self-loan plans.
  const upcoming = calendar.filter((e) => e.status === 'upcoming').map((e) => ({ date: e.date, label: e.title, amount: e.amount, to: e.to }));

  const current = nw.at(-1);
  const potBal = new Map(l.pots.map((p) => [p.id, l.balances.get(p.accountId)?.pots.get(p.id) ?? 0]));
  const ef = current ? emergencyFund(current, l.accounts, l.pots, potBal, essentials) : null;
  const activeDebts = l.debts.filter((d) => d.status !== 'paid');
  const errors = health.filter((h) => h.level !== 'info').length;
  const monthTx = l.transactions.filter((t) => t.date.startsWith(mk) && t.currency === 'CRC');
  const nOf = (k: string) => monthTx.filter((t) => t.kind === k).length;
  const setup = useSetup();
  // Views you've hidden in Settings → Dashboard drop out of their stack.
  const views = (list: [string, string, () => React.ReactNode][]): DeckView[] => list.filter(([id]) => show(id)).map(([key, label, render]) => ({ key, label, render }));

  return (
    <div className="fit">
      <PageHeader title={`${MN[month - 1]} ${year}`} sub={mk === today.slice(0, 7) ? `Month so far · ${formatDateCR(today)}` : 'Month at a glance'}>
        <button className="btn btn-sm" aria-label="Previous month" onClick={() => setMk(shift(mk, -1))}>‹</button>
        <button className="btn btn-sm" aria-label="Next month" disabled={mk >= today.slice(0, 7)} onClick={() => setMk(shift(mk, 1))}>›</button>
        <Link to="/settings#health" className="btn btn-sm" aria-label={`Data health: ${errors} to check`}>{errors ? <><span className="dot" style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--debt)', display: 'inline-block' }} /> {errors} to check</> : <>✓ Data healthy</>}</Link>
        <button className="btn btn-primary btn-sm" onClick={() => qa.open()}>+ Add</button>
      </PageHeader>

      <div className="kpis" data-tour="kpis">
        <Kpi label="Income" value={f?.income ?? 0} tone="income" n={nOf('income')} />
        <Kpi label="Expenses" value={f?.expenses ?? 0} tone="expense" n={nOf('expense') + nOf('debt_payment')} sub={f?.debtService ? `incl. ${formatMoney(f.debtService, 'CRC')} debt` : undefined} />
        <Kpi label="Net" value={f?.net ?? 0} tone="auto" derived sub="income − expenses" />
        <Kpi label="Saved" value={f?.saved ?? 0} tone="savings" n={nOf('savings')} sub={f?.income ? <>{(sum.savingsRate * 100).toFixed(1)}% of income · target {Math.round(target * 100)}%</> : undefined} />
        <Kpi label="Free cash" value={f?.freeCash ?? 0} tone="auto" derived sub="net − saved" />
      </div>

      <div className="dash-decks">
        <Deck id="coach" label="Coach" className="d-coach" views={views([
          ...(setup.done < setup.total ? [['setup', 'Get set up', () => <SetupChecklist />] as [string, string, () => React.ReactNode]] : []),
          ['coach', 'Coach: top alerts', () => coach.run ? <CoachTop /> : <p className="muted">The Coach starts once you have accounts.</p>],
          ['insights', 'What happened', () => (<div style={{ display: 'grid', gap: 8 }}>
            <h2 className="card-h">What happened</h2>
            {sum.insights.length === 0 ? <p className="muted" style={{ margin: 0 }}>No movements yet this month.</p> : (
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
                {sum.insights.map((i, k) => <li key={k} style={{ display: 'flex', gap: 8 }}><span aria-hidden style={{ color: i.tone === 'good' ? 'var(--income)' : i.tone === 'bad' ? 'var(--expense)' : 'var(--text-3)' }}>●</span><span>{i.text}</span></li>)}
              </ul>
            )}
          </div>)],
        ])} />

        <Deck id="story" label="This month" className="d-story" views={views([
          ['waterfall', 'Where the month’s money went', () => f ? <MonthWaterfall steps={monthWaterfall(f, l.category)} month={mk} /> : <p className="muted">No movements this month.</p>],
          ['pace', 'Spending pace', () => <SpendingPace month={mk} days={dim} today={paceDay} thisMonth={cumulative(daily.byDay, mk, dim, paceDay)} lastMonth={cumulative(daily.byDay, shift(mk, -1), daysIn(shift(mk, -1)))} budget={spendBudget} label="All spending this month" />],
          ['flow', 'Income vs expenses', () => <IncomeExpenseChart title="Income vs expenses" data={flowData} />],
          ['freecash', 'Free cash by month', () => (<div className="deck-fill">
            <h2 className="card-h">Free cash by month</h2>
            <div className="chart-fill" role="img" aria-label={`Free cash after saving: ${netData.map((d) => `${d.month} ${formatMoney(d.net, 'CRC')}`).join(', ')}`}>
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
          </div>)],
          ['calendar', 'Daily spending calendar', () => <SpendingCalendar byDay={daily.byDay} to={today} estimated={daily.estimated} weeks={30} />],
        ])} />

        <Deck id="upcoming" label="Coming up" className="d-up" views={views([
          ['upcoming', 'Coming up (30 days)', () => (<div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
            <h2 className="card-h">Coming up <span className="n">n {upcoming.length}</span></h2>
            {pending.length > 0 && <Link to="/bills" className="btn btn-sm" style={{ justifySelf: 'start' }}><Pill tone="debt">{pending.length}</Pill> to confirm</Link>}
            {upcoming.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Nothing scheduled. <Link to="/bills">Add recurring items</Link>.</p> : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
                {upcoming.slice(0, 6).map((u, k) => <li key={k}><Link to={u.to} style={{ display: 'grid', gap: 1, color: 'inherit', textDecoration: 'none' }}><span className="small muted">{formatDateCR(u.date).slice(0, 5)}</span><span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{u.label}</span>{u.amount !== undefined && <span className="money small">{formatMoney(u.amount, 'CRC')}</span>}</span></Link></li>)}
              </ul>
            )}
            <NextDays events={calendar} today={today} />
            <Link to="/bills" className="small">Calendar →</Link>
          </div>)],
          ['cards', 'Credit cards', () => <CardsWidget compact />],
          ['debts', 'Debts', () => (<div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
            <h2 className="card-h">Debts</h2>
            {activeDebts.length === 0 ? <Pill tone="income">No active debts</Pill> : activeDebts.map((d) => {
              const st = debtStatus(d, l.transactions);
              const pct = Math.max(0, Math.min(1, 1 - st.balance / d.originalAmount));
              return (
                <div key={d.id} style={{ display: 'grid', gap: 3 }}>
                  <div className="small" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{d.creditor}</span><span className="money">{formatMoney(st.balance, 'CRC')}</span></div>
                  <div className="bar" role="img" aria-label={`${Math.round(pct * 100)}% paid`}><span style={{ width: `${pct * 100}%`, background: 'var(--debt)' }} /></div>
                </div>
              );
            })}
            <Link to="/debts" className="small">Payoff plans →</Link>
          </div>)],
        ])} />

        <Deck id="spend" label="Spending" className="d-spend" views={views([
          ['where', 'Where it went', () => (<div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
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
          </div>)],
          ['budget', 'Budget health', () => (<div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
            <h2 className="card-h">Budget health</h2>
            {budgetRows.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Set budgets in Budget → Categories.</p> : budgetRows.map((x) => (
              <div key={x.r.category.id} style={{ display: 'grid', gap: 3 }}>
                <div className="small" style={{ display: 'flex', justifyContent: 'space-between' }}><span>{x.r.category.name}</span><span className="money" style={{ color: x.pct > 1 ? 'var(--expense)' : undefined }}>{formatMoney(x.spent, 'CRC')} · {Math.round(x.pct * 100)}%</span></div>
                <div className="bar" aria-hidden><span style={{ width: `${Math.min(1, x.pct) * 100}%`, background: x.pct > 1 ? 'var(--expense)' : x.pct >= 0.8 ? 'var(--debt)' : 'var(--income)' }} /></div>
              </div>
            ))}
            <Link to="/tracker" className="small">Budget →</Link>
          </div>)],
          ['groups', 'Spending by group', () => <GroupDonut title="Spending by group" data={groups} />],
        ])} />

        <Deck id="wealth" label="Wealth" className="d-wealth" views={views([
          ['networth', 'Net worth', () => (<div className="deck-fill">
            <h2 className="card-h">Net worth</h2>
            {current ? <>
              <Money amount={current.netWorth} size={26} weight={800} tone="auto" />
              <div className="chart-fill" role="img" aria-label="Net worth trend this year">
                <ResponsiveContainer><LineChart data={nw.map((s) => ({ m: s.month, v: s.netWorth }))}><Line isAnimationActive={false} dataKey="v" stroke={c1} strokeWidth={2} dot={false} /><YAxis hide domain={['auto', 'auto']} /></LineChart></ResponsiveContainer>
              </div>
              {ef && essentials > 0 && <div className="small">Emergency fund <b>{ef.liquidMonths.toFixed(1)}</b> / {efTarget} months liquid</div>}
              <Link to="/net-worth" className="small">Balance sheet →</Link>
            </> : <p className="muted small">No data.</p>}
          </div>)],
        ])} />
      </div>
    </div>
  );
}

const KPI_HELP: Record<string, string> = {
  Income: 'Salary and any other money that came in this month.',
  Expenses: 'Everything you paid this month, including debt and card payments counted as spending. Moving money to savings is not an expense.',
  Net: 'Income minus expenses: what was left before saving.',
  Saved: 'Money you moved into savings this month, minus what you took out of savings.',
  'Free cash': 'Net minus saved. Negative means you spent or saved more than you earned this month, so it came from money you already had or from credit.',
};
function Kpi({ label, value, tone, sub, n, derived }: { label: string; value: number; tone: 'income' | 'expense' | 'savings' | 'auto'; sub?: React.ReactNode; n?: number; derived?: boolean }) {
  return (
    <Glass pad={14} className="stat">
      <span className="stat-label">{label}{derived && <span className="derived" style={{ textTransform: 'none', letterSpacing: 0 }}>· derived</span>}{KPI_HELP[label] && <InfoTip text={KPI_HELP[label]!} label={`About ${label}`} />}{n !== undefined && <span className="n" style={{ marginLeft: 'auto' }}>n {n}</span>}</span>
      <Money amount={value} size={24} weight={650} tone={tone} />
      {sub && <span className="stat-cap">{sub}</span>}
    </Glass>
  );
}

/** The next 4 weeks as a small grid that takes the card's spare height: a dot per scheduled item. */
function NextDays({ events, today }: { events: { date: string; tone: string; title: string; amount?: number; status: string }[]; today: string }) {
  const days = Array.from({ length: 28 }, (_, i) => addDays(today, i));
  const by = new Map<string, typeof events>();
  for (const e of events) if (e.status !== 'posted' && e.status !== 'skipped') by.set(e.date, [...(by.get(e.date) ?? []), e]);
  const tone = (t: string) => (t === 'income' ? 'var(--income)' : t === 'savings' ? 'var(--savings)' : t === 'info' ? 'var(--text-faint)' : 'var(--debt)');
  return (
    <div className="nextdays" role="img" aria-label={`Next 4 weeks: ${[...by.entries()].map(([d, es]) => `${d.slice(8)} ${es.map((e) => e.title).join(', ')}`).join('; ') || 'nothing scheduled'}`}>
      {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="nd-dow">{d}</span>)}
      {Array.from({ length: (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7 }, (_, i) => <span key={`x${i}`} />)}
      {days.map((d) => {
        const es = by.get(d) ?? [];
        return (
          <span key={d} className={`nd-day ${d === today ? 'today' : ''}`} title={es.map((e) => `${e.title}${e.amount ? ` ${formatMoney(e.amount, 'CRC')}` : ''}`).join('\n') || undefined}>
            <span>{Number(d.slice(8))}</span>
            <span className="nd-dots">{es.slice(0, 3).map((e, k) => <i key={k} style={{ background: tone(e.tone) }} />)}</span>
          </span>
        );
      })}
    </div>
  );
}
