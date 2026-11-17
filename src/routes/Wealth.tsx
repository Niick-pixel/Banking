/**
 * Wealth overview: what you own, what you owe, and how it moved, on one screen.
 *  - five numbers (net worth, own, owe, emergency fund, change this year), each with its n
 *  - net worth month by month (own vs owe, with the net line)
 *  - where it is: every kind of account and debt as a share, each a link to fix it
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLedger } from '../app/data';
import { useCssVar } from '../app/theme';
import { usePref } from '../app/prefs';
import { Glass } from '../design/components';
import { ChipGroup } from '../design/components/ChipGroup';
import { InfoTip } from '../design/components/InfoTip';
import { PageHeader, Sheet } from '../ui/Sheet';
import { emergencyFund, netWorthSeries } from '../domain/networth';
import { cardsSummary } from '../domain/cards';
import { formatMoney } from '../lib/money';
import { todayISO } from '../lib/dates';
import { SnapshotForm, useEssentials } from './NetWorth';

const MS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (v: number) => { const a = Math.abs(v) / 100; const s = a >= 1_000_000 ? `${(a / 1_000_000).toFixed(1)}M` : a >= 1000 ? `${Math.round(a / 1000)}k` : `${Math.round(a)}`; return `${v < 0 ? '-' : ''}₡${s}`; };
const KIND: Record<string, string> = { checking: 'Everyday', cash: 'Everyday', savings: 'Savings', goal_savings: 'Savings', loan_fund: 'Savings', association_voluntary: 'Association', association_cesantia: 'Association', investment: 'Investments' };

export default function Wealth() {
  const l = useLedger();
  const today = todayISO();
  const years = useMemo(() => [...new Set([...l.transactions.map((t) => Number(t.date.slice(0, 4))), Number(today.slice(0, 4))])].sort(), [l.transactions, today]);
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [entry, setEntry] = useState(false);
  const [efTarget] = usePref('efTargetMonths');
  const [own, owe, net, grid, axis] = useCssVar(['--chart-3', '--chart-2', '--chart-1', '--chart-grid', '--chart-axis']);
  const series = useMemo(() => netWorthSeries({ accounts: l.accounts, snapshots: l.snapshots, transactions: l.transactions, debts: l.debts, installments: l.installments }, year, today), [l, year, today]);
  const essentials = useEssentials(year);
  const cards = useMemo(() => cardsSummary(l.accounts, l.balances, l.snapshots, today), [l, today]);
  const current = series.at(-1);
  const potBal = new Map(l.pots.map((p) => [p.id, l.balances.get(p.accountId)?.pots.get(p.id) ?? 0]));
  const ef = current ? emergencyFund(current, l.accounts, l.pots, potBal, essentials) : null;
  const first = series[0];
  const liveAccounts = l.accounts.filter((a) => !a.archived);
  const fromStatements = current?.accounts.filter((a) => a.source === 'statement').length ?? 0;

  // Where it is (today, from the latest month's balance sheet).
  const groups = useMemo(() => {
    const m = new Map<string, { amount: number; n: number }>();
    for (const a of current?.accounts ?? []) {
      const acc = l.account.get(a.accountId);
      if (!acc || acc.type === 'credit_card') continue;
      const k = KIND[acc.type] ?? 'Other';
      const g = m.get(k) ?? { amount: 0, n: 0 };
      g.amount += a.balance; g.n++; m.set(k, g);
    }
    return [...m.entries()].map(([name, g]) => ({ name, ...g })).sort((a, b) => b.amount - a.amount);
  }, [current, l.account]);
  const owed = [
    { name: 'Credit cards', amount: cards.totalOwed, n: cards.cards.filter((c) => c.owed > 0).length, to: '/debts' },
    { name: 'Loans', amount: current?.debts.reduce((s, d) => s + Math.max(0, d.balance), 0) ?? 0, n: current?.debts.filter((d) => d.balance > 0).length ?? 0, to: '/debts' },
    { name: 'Tasa Cero still to pay', amount: current?.tasaCeroPending ?? 0, n: l.installments.filter((p) => p.status === 'active').length, to: '/tasa-cero' },
  ].filter((x) => x.amount > 0);
  const assets = groups.reduce((s, g) => s + Math.max(0, g.amount), 0);
  const debts = owed.reduce((s, x) => s + x.amount, 0);
  const maxBar = Math.max(1, assets, debts);
  const chart = series.map((s) => ({ month: MS[Number(s.month.slice(5)) - 1], Own: s.assets, Owe: -s.liabilities, 'Net worth': s.netWorth }));

  return (
    <div className="fit">
      <PageHeader title="Wealth" sub="What you own minus what you owe. Statement balances you enter win over the app's own figures.">
        <ChipGroup<number> inline size="sm" label="Year" value={year} onChange={(v) => v && setYear(v)} options={years.map((y) => ({ value: y, label: String(y) }))} />
        <Link className="btn" to="/accounts">Accounts</Link>
        <button className="btn btn-primary" onClick={() => setEntry(true)}>Enter statement balances</button>
      </PageHeader>

      <div className="wealth-kpis">
        <Glass pad={14} className="stat">
          <span className="stat-label">Net worth <InfoTip text="Everything you own (accounts, association, investments) minus everything you owe (loans, credit cards, Tasa Cero still to pay)." /><span className="n" style={{ marginLeft: 'auto' }}>n {liveAccounts.length}</span></span>
          <span className="stat-value money" style={{ color: (current?.netWorth ?? 0) < 0 ? 'var(--expense)' : 'var(--text)' }}>{formatMoney(current?.netWorth ?? 0, 'CRC')}</span>
          <span className="stat-cap">{current?.change !== undefined ? <>{current.change >= 0 ? '▲' : '▼'} {formatMoney(Math.abs(current.change), 'CRC')} vs last month</> : 'first month tracked'}</span>
        </Glass>
        <Glass pad={14} className="stat">
          <span className="stat-label">You own <span className="n" style={{ marginLeft: 'auto' }}>n {groups.reduce((s, g) => s + g.n, 0)}</span></span>
          <span className="stat-value money" style={{ color: 'var(--income)' }}>{formatMoney(assets, 'CRC')}</span>
          <span className="stat-cap">{fromStatements} from statements, the rest from the app</span>
        </Glass>
        <Glass pad={14} className="stat">
          <span className="stat-label">You owe <span className="n" style={{ marginLeft: 'auto' }}>n {owed.reduce((s, x) => s + x.n, 0)}</span></span>
          <span className="stat-value money" style={{ color: 'var(--debt)' }}>{formatMoney(debts, 'CRC')}</span>
          <span className="stat-cap">{owed.map((x) => `${x.name.toLowerCase().replace(' still to pay', '')} ${short(x.amount)}`).join(' · ') || 'nothing owed'}</span>
        </Glass>
        <Glass pad={14} className="stat">
          <span className="stat-label">Emergency fund <span className="derived" style={{ textTransform: 'none', letterSpacing: 0 }}>· derived</span><InfoTip text="Months of essential spending (fixed + living, average) your liquid money covers. Money set aside for her loan is not counted. Cesantía is shown separately because you can't take it out freely." /></span>
          <span className="stat-value">{ef && essentials ? `${ef.liquidMonths.toFixed(1)}` : '—'} <span className="small faint">/ {efTarget} months</span></span>
          <span className="stat-cap">{ef && essentials ? `${ef.totalMonths.toFixed(1)} incl. cesantía · essentials ${short(essentials)}/mo` : 'needs a few months of spending'}</span>
        </Glass>
        <Glass pad={14} className="stat">
          <span className="stat-label">Change in {year} <span className="derived" style={{ textTransform: 'none', letterSpacing: 0 }}>· derived</span><span className="n" style={{ marginLeft: 'auto' }}>n {series.length} mo</span></span>
          <span className="stat-value money" style={{ color: current && first && current.netWorth - first.netWorth < 0 ? 'var(--expense)' : 'var(--income)' }}>{current && first ? `${current.netWorth - first.netWorth >= 0 ? '+' : ''}${formatMoney(current.netWorth - first.netWorth, 'CRC')}` : '—'}</span>
          <span className="stat-cap">since {first ? MS[Number(first.month.slice(5)) - 1] : '—'}</span>
        </Glass>
      </div>

      <div className="wealth-main">
        <Glass strong pad={16} className="wealth-chart">
          <h2 className="card-h" style={{ margin: 0 }}>Month by month <span className="n">n {series.length}</span><InfoTip text="Green: what you owned at each month end. Orange: what you owed. The line is your net worth. Months with a statement balance use it; the others use the app's figure." /></h2>
          {series.length < 2 ? <div className="ghost fill">Needs {2 - series.length} more month{series.length === 1 ? '' : 's'} of history to draw a trend.</div> : (
            <div className="chart-fill" role="img" aria-label={`Net worth by month: ${chart.map((c) => `${c.month} ${short(c['Net worth'])}`).join(', ')}`}>
              <ResponsiveContainer>
                <ComposedChart data={chart} margin={{ top: 8, right: 6, left: 0, bottom: 0 }} stackOffset="sign">
                  <CartesianGrid vertical={false} stroke={grid} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: axis, fontSize: 11 }} />
                  <YAxis tickFormatter={short} tickLine={false} axisLine={false} width={56} tick={{ fill: axis, fontSize: 11 }} />
                  <ReferenceLine y={0} stroke={axis} />
                  <Tooltip formatter={(v: number) => formatMoney(Math.abs(v), 'CRC')} contentStyle={{ background: 'var(--solid-surface)', border: '1px solid var(--glass-border)', borderRadius: 12 }} cursor={{ fill: 'var(--accent-soft)' }} />
                  <Bar dataKey="Own" stackId="a" fill={own} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Owe" stackId="a" fill={owe} radius={[0, 0, 4, 4]} />
                  <Line dataKey="Net worth" stroke={net} strokeWidth={2.5} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </Glass>

        <Glass strong pad={16} className="wealth-where">
          <h2 className="card-h" style={{ margin: 0 }}>Where it is <InfoTip text="Your balances today, grouped. Tap a row to see or fix those accounts." /></h2>
          <div className="scroll-box fill" style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
            <span className="label">You own</span>
            {groups.map((g) => (
              <Link key={g.name} to="/accounts" className="where-row">
                <span className="where-top"><span>{g.name} <span className="n">n {g.n}</span></span><b className="money">{formatMoney(g.amount, 'CRC')}</b></span>
                <span className="bar" aria-hidden><span style={{ width: `${Math.max(0, g.amount / maxBar) * 100}%`, background: 'var(--income)' }} /></span>
              </Link>
            ))}
            {owed.length > 0 && <span className="label" style={{ marginTop: 6 }}>You owe</span>}
            {owed.map((x) => (
              <Link key={x.name} to={x.to} className="where-row">
                <span className="where-top"><span>{x.name} <span className="n">n {x.n}</span></span><b className="money" style={{ color: 'var(--debt)' }}>{formatMoney(x.amount, 'CRC')}</b></span>
                <span className="bar" aria-hidden><span style={{ width: `${(x.amount / maxBar) * 100}%`, background: 'var(--debt)' }} /></span>
              </Link>
            ))}
            <span className="label" style={{ marginTop: 6 }}>Each account <span className="n">n {liveAccounts.length}</span></span>
            {liveAccounts.map((a) => (
              <Link key={a.id} to="/accounts" className="where-row">
                <span className="where-top"><span className="small">{a.name}</span><span className="money small" style={{ color: (l.balances.get(a.id)?.total ?? 0) < 0 ? 'var(--expense)' : 'var(--text-dim)' }}>{formatMoney(l.balances.get(a.id)?.total ?? 0, a.currency)}</span></span>
              </Link>
            ))}
          </div>
        </Glass>
      </div>

      <Sheet wide open={entry} onClose={() => setEntry(false)} title="Statement balances" caption="Type what each statement says">
        {entry && <SnapshotForm onDone={() => setEntry(false)} />}
      </Sheet>
    </div>
  );
}
