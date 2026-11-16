import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLedger } from '../app/data';
import { usePref } from '../app/prefs';
import { useCssVar } from '../app/theme';
import { Glass, Money, Pill, Segmented } from '../design/components';
import { PageHeader, Sheet } from '../ui/Sheet';
import { emergencyFund, netWorthSeries } from '../domain/networth';
import { computeTracker } from '../domain/tracker';
import { saveSnapshot } from '../db/repo';
import { formatMoney, parseAmountInput } from '../lib/money';
import { formatDateCR, lastDayOfMonth, todayISO } from '../lib/dates';
import { usePersisted } from '../app/persist';

const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mLabel = (mk: string) => `${M[Number(mk.slice(5)) - 1]} ${mk.slice(2, 4)}`;

/** Average monthly Fixed + Living spending over months with data (same as the workbook). */
export function useEssentials(year: number) {
  const l = useLedger();
  return useMemo(() => {
    const t = computeTracker(year, l.transactions.filter((x) => x.currency === 'CRC'), l.categories, l.budgets, { accountType: (id) => l.account.get(id)?.type });
    return t.sections.filter((s) => s.group === 'Fixed' || s.group === 'Living').reduce((s, x) => s + x.subtotal.avg, 0);
  }, [l, year]);
}

export default function NetWorth() {
  const l = useLedger();
  const today = todayISO();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [view, setView] = usePersisted<'chart' | 'table'>('view.networth', 'chart');
  const [entry, setEntry] = useState(false);
  const [target, setTarget] = usePref('efTargetMonths');
  const [line, grid, axis] = useCssVar(['--chart-1', '--chart-grid', '--chart-axis']);
  const series = useMemo(() => netWorthSeries({ accounts: l.accounts, snapshots: l.snapshots, transactions: l.transactions, debts: l.debts, installments: l.installments }, year, today), [l, year, today]);
  const essentials = useEssentials(year);
  const current = series.at(-1);
  const potBal = new Map(l.pots.map((p) => [p.id, l.balances.get(p.accountId)?.pots.get(p.id) ?? 0]));
  const ef = current ? emergencyFund(current, l.accounts, l.pots, potBal, essentials) : null;
  const acc = l.account;
  const years = [...new Set([...l.transactions.map((t) => Number(t.date.slice(0, 4))), Number(today.slice(0, 4))])].sort();
  const accountIds = [...new Set(series.flatMap((s) => s.accounts.map((a) => a.accountId)))];
  const debtIds = [...new Set(series.flatMap((s) => s.debts.map((d) => d.debtId)))];
  const ledgerOnly = current?.accounts.filter((a) => a.source === 'ledger' && acc.get(a.accountId)?.type !== 'credit_card').length ?? 0;

  return (
    <>
      <PageHeader title="Net worth" sub="What you own minus what you owe, at each month end. Statements you enter win over the ledger.">
        <select className="input" style={{ width: 110 }} aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y}>{y}</option>)}</select>
        <button className="btn btn-primary" onClick={() => setEntry(true)}>Enter statement balances</button>
      </PageHeader>

      {!current ? <Glass><p className="muted" style={{ margin: 0 }}>No accounts yet for {year}.</p></Glass> : (
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
            <Glass pad={18}>
              <div className="small muted">Net worth · {mLabel(current.month)}</div>
              <Money amount={current.netWorth} size={30} weight={800} tone="auto" />
              {current.change !== undefined && <div className="small"><span style={{ color: current.change >= 0 ? 'var(--income)' : 'var(--expense)' }}>{current.change >= 0 ? '▲' : '▼'} {formatMoney(Math.abs(current.change), 'CRC')}</span> <span className="muted">vs last month</span></div>}
            </Glass>
            <Glass pad={18}><div className="small muted">Assets</div><Money amount={current.assets} size={24} weight={750} /><div className="small muted">Liabilities {formatMoney(current.liabilities, 'CRC')}</div></Glass>
            <Glass pad={18}>
              <div className="small muted">Emergency fund (liquid)</div>
              <div style={{ fontSize: 26, fontWeight: 800 }}>{ef && essentials ? `${ef.liquidMonths.toFixed(1)} months` : '—'}</div>
              {ef && essentials > 0 && <div className="bar" aria-hidden><span style={{ width: `${Math.min(1, ef.liquidMonths / target) * 100}%`, background: ef.liquidMonths >= target ? 'var(--income)' : 'var(--debt)' }} /></div>}
              <div className="small muted">{ef && formatMoney(ef.liquid, 'CRC')}{ef?.earmarkedExcluded ? ` (her fund ${formatMoney(ef.earmarkedExcluded, 'CRC')} excluded)` : ''}</div>
            </Glass>
            <Glass pad={18}>
              <div className="small muted">Total coverage incl. cesantía</div>
              <div style={{ fontSize: 26, fontWeight: 800 }}>{ef && essentials ? `${ef.totalMonths.toFixed(1)} months` : '—'}</div>
              <div className="small muted">Target <input type="number" min={1} max={24} aria-label="Emergency fund target in months" value={target} onChange={(e) => void setTarget(Math.max(1, Number(e.target.value) || 6))} style={{ width: 44, font: 'inherit', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 6, color: 'var(--text)', padding: '0 4px' }} /> months · essentials {formatMoney(essentials, 'CRC')}/mo</div>
            </Glass>
          </div>

          {ledgerOnly > 0 && <Glass pad={14}><Pill tone="debt">{ledgerOnly} account(s) use the ledger balance for {mLabel(current.month)}</Pill> <span className="small muted">Enter the real statement balance so this month's numbers are exact. Ledger figures are only as good as your opening balances.</span></Glass>}

          <Glass strong style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>Net worth by month</h2>
              <Segmented label="View" value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Balance sheet' }]} />
            </div>
            {view === 'chart' ? (
              <div style={{ height: 260 }} role="img" aria-label="Net worth by month. Switch to Balance sheet for exact values.">
                <ResponsiveContainer>
                  <LineChart data={series.map((s) => ({ month: mLabel(s.month), value: s.netWorth }))} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={grid} />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: axis, fontSize: 12 }} />
                    <YAxis tickFormatter={(v: number) => `₡${(v / 100_000_000).toFixed(1)}M`} tickLine={false} axisLine={false} width={56} tick={{ fill: axis, fontSize: 12 }} />
                    <ReferenceLine y={0} stroke={axis} />
                    <Tooltip formatter={(v: number) => formatMoney(v, 'CRC')} contentStyle={{ background: 'var(--solid-surface)', border: '1px solid var(--glass-border)', borderRadius: 12 }} />
                    <Line isAnimationActive={false} type="monotone" dataKey="value" name="Net worth" stroke={line} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: 'var(--solid-surface)' }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="tracker-wrap" tabIndex={0} aria-label="Balance sheet, scroll horizontally">
                <table className="table tracker" style={{ minWidth: 300 + series.length * 120 }}>
                  <thead><tr><th className="sticky">Account</th>{series.map((s) => <th key={s.month} className="num">{mLabel(s.month)}</th>)}</tr></thead>
                  <tbody>
                    <tr className="group-row"><th className="sticky">Assets</th><td colSpan={series.length} /></tr>
                    {accountIds.filter((id) => acc.get(id)?.type !== 'credit_card').map((id) => (
                      <tr key={id}><th className="sticky" scope="row">{acc.get(id)?.name}</th>
                        {series.map((s) => { const a = s.accounts.find((x) => x.accountId === id); return <td key={s.month} className="num" title={a?.source === 'statement' ? 'From your statement' : 'From the ledger'}>{a ? formatMoney(a.balance, 'CRC', { parens: true }) : '—'}{a?.source === 'statement' && <sup style={{ color: 'var(--income)' }}> S</sup>}</td>; })}</tr>
                    ))}
                    <tr className="subtotal"><th className="sticky">Total assets</th>{series.map((s) => <td key={s.month} className="num">{formatMoney(s.assets, 'CRC', { parens: true })}</td>)}</tr>
                    <tr className="group-row"><th className="sticky">Liabilities</th><td colSpan={series.length} /></tr>
                    {debtIds.map((id) => (
                      <tr key={id}><th className="sticky" scope="row">{l.debts.find((d) => d.id === id)?.creditor}</th>{series.map((s) => <td key={s.month} className="num">{formatMoney(s.debts.find((d) => d.debtId === id)?.balance ?? 0, 'CRC')}</td>)}</tr>
                    ))}
                    {series.some((s) => s.creditCards > 0) && <tr><th className="sticky">Credit cards</th>{series.map((s) => <td key={s.month} className="num">{formatMoney(Math.max(0, s.creditCards), 'CRC')}</td>)}</tr>}
                    {series.some((s) => s.tasaCeroPending > 0) && <tr><th className="sticky">Tasa Cero (not yet billed)</th>{series.map((s) => <td key={s.month} className="num">{formatMoney(s.tasaCeroPending, 'CRC')}</td>)}</tr>}
                    <tr className="subtotal"><th className="sticky">Total liabilities</th>{series.map((s) => <td key={s.month} className="num">{formatMoney(s.liabilities, 'CRC')}</td>)}</tr>
                    <tr style={{ fontWeight: 800 }}><th className="sticky">Net worth</th>{series.map((s) => <td key={s.month} className="num" style={{ color: s.netWorth < 0 ? 'var(--expense)' : undefined }}>{formatMoney(s.netWorth, 'CRC', { parens: true })}</td>)}</tr>
                    <tr><th className="sticky">Change vs prior month</th>{series.map((s) => <td key={s.month} className="num" style={{ color: (s.change ?? 0) < 0 ? 'var(--expense)' : 'var(--income)' }}>{s.change === undefined ? '—' : formatMoney(s.change, 'CRC', { signed: true })}</td>)}</tr>
                  </tbody>
                </table>
              </div>
            )}
            <p className="small muted" style={{ margin: 0 }}><sup style={{ color: 'var(--income)' }}>S</sup> = from your statement. Self-loans aren't counted as debt (your savings balance already shows the money is gone).</p>
          </Glass>
        </div>
      )}

      <Sheet open={entry} onClose={() => setEntry(false)} title="Statement balances" wide>
        {entry && <SnapshotForm onDone={() => setEntry(false)} />}
      </Sheet>
    </>
  );
}

function SnapshotForm({ onDone }: { onDone: () => void }) {
  const l = useLedger();
  const t = todayISO();
  const [y, m] = t.split('-').map(Number) as [number, number];
  const defaultDate = lastDayOfMonth(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1);
  const [date, setDate] = useState(defaultDate);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const accounts = l.accounts.filter((a) => !a.archived);
  async function save() {
    let n = 0;
    for (const a of accounts) {
      const raw = vals[a.id];
      if (raw === undefined || raw.trim() === '') continue;
      const neg = raw.trim().startsWith('-');
      const v = parseAmountInput(raw.replace(/^-/, ''), a.currency);
      if (v === null) return setErr(`Can't read the amount for ${a.name}`);
      await saveSnapshot(a.id, date, neg || a.type === 'credit_card' ? -v : v);
      n++;
    }
    if (!n) return setErr('Type at least one balance');
    onDone();
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: 'grid', gap: 12 }}>
      <p className="small muted" style={{ margin: 0 }}>Type what each statement or app says. Leave blank to skip. For association accounts use the association statement. Credit cards: type the amount owed.</p>
      <div className="field" style={{ maxWidth: 220 }}><label htmlFor="sn-d">Balance as of</label><input id="sn-d" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      <table className="table">
        <thead><tr><th>Account</th><th className="num">App says ({formatDateCR(date)})</th><th>Statement</th></tr></thead>
        <tbody>{accounts.map((a) => {
          const ledger = l.balances.get(a.id)?.total ?? 0;
          const existing = l.snapshots.find((s) => s.accountId === a.id && s.date === date);
          return (
            <tr key={a.id}>
              <td>{a.name}{existing && <div className="small muted">saved: {formatMoney(existing.balance, a.currency)}</div>}</td>
              <td className="num muted">{formatMoney(ledger, a.currency)}</td>
              <td><input className="input" style={{ height: 36 }} inputMode="decimal" aria-label={`Statement balance for ${a.name}`} value={vals[a.id] ?? ''} onChange={(e) => setVals({ ...vals, [a.id]: e.target.value })} /></td>
            </tr>
          );
        })}</tbody>
      </table>
      {err && <p role="alert" style={{ color: 'var(--expense)', margin: 0 }}>{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" type="submit">Save balances</button></div>
    </form>
  );
}
