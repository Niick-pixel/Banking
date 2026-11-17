import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLedger } from '../app/data';
import { useCssVar } from '../app/theme';
import { Glass, Money, Pill, Segmented } from '../design/components';
import { PageHeader, Sheet } from '../ui/Sheet';
import { accountBalances, debtStatus, potsByMonth } from '../domain/ledger';
import { fundProgress } from '../domain/debts';
import { budgetFor } from '../domain/tracker';
import { newId, saveTransaction } from '../db/repo';
import type { Debt, Pot } from '../domain/schemas';
import { formatMoney, parseAmountInput } from '../lib/money';
import { formatDateCR, todayISO } from '../lib/dates';
import { PayDebtForm } from './PayDebt';
import { InfoTip } from '../design/components/InfoTip';
import { FundMovesFix } from './FundMovesFix';
import { asSavings, crossesSavings } from '../domain/fundmoves';
import type { FlowContext } from '../domain/ledger';
import { usePersisted } from '../app/persist';

const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const OWNER_LABEL = { hers: 'Her money', mine: 'My money', shared: 'Shared' } as const;

export default function Pots() {
  const l = useLedger();
  const today = todayISO();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [pay, setPay] = useState<Debt | null>(null);
  const [move, setMove] = useState(false);
  const [view, setView] = usePersisted<'chart' | 'table'>('view.funds', 'chart');
  const [hersC, mineC, grid, axis] = useCssVar(['--chart-hers', '--chart-mine', '--chart-grid', '--chart-axis']);

  const potBal = (p: Pot) => l.balances.get(p.accountId)?.pots.get(p.id) ?? 0;
  const byOwner = { hers: 0, mine: 0, shared: 0 };
  for (const p of l.pots) byOwner[p.owner] += potBal(p);
  const total = byOwner.hers + byOwner.mine + byOwner.shared;
  const months = useMemo(() => potsByMonth(l.pots, l.transactions, year), [l.pots, l.transactions, year]);
  const hasShared = l.pots.some((p) => p.owner === 'shared');
  const funded = l.debts.filter((d) => d.fundPotId && d.status !== 'paid');
  const data = months.map((m, i) => ({ month: M[i], Hers: m.byOwner.hers, Mine: m.byOwner.mine }));
  const fmtShort = (v: number) => `₡${Math.round(v / 100_000)}k`;

  if (!l.pots.length) {
    return (<><PageHeader title="Funds" /><Glass><p className="muted" style={{ margin: 0 }}>No funds yet. Create one from Accounts (+ Fund) to split an account into Her money / My money.</p></Glass></>);
  }

  return (
    <>
      <PageHeader title="Funds" sub="Money set aside inside your accounts, by whose it is. Fully automatic from your movements.">
        <button className="btn" onClick={() => setMove(true)}>Move between funds</button>
      </PageHeader>
      <FundMovesFix />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 16 }}>
        {(['hers', 'mine', ...(hasShared ? ['shared'] as const : [])] as const).map((o) => (
          <Glass key={o} pad={20}>
            <div style={{ color: `var(--${o})`, fontWeight: 750, fontSize: 13 }}>● {OWNER_LABEL[o].toUpperCase()}</div>
            <Money amount={byOwner[o]} size={32} weight={800} tone="auto" />
            <div className="small muted">{o === 'hers' ? 'Not yours to spend' : o === 'mine' ? 'Your own savings' : 'Shared'}</div>
          </Glass>
        ))}
        <Glass pad={20}><div style={{ fontWeight: 750, fontSize: 13 }} className="muted">TOTAL IN FUNDS</div><Money amount={total} size={32} weight={800} />
          <div className="small muted">{l.pots.map((p) => l.account.get(p.accountId)?.name).filter((v, i, a) => a.indexOf(v) === i).join(', ')}</div></Glass>
      </div>

      {funded.map((d) => {
        const pot = l.pot.get(d.fundPotId!)!;
        const st = debtStatus(d, l.transactions);
        const setAside = potBal(pot);
        const hersCat = l.categories.find((c) => c.group === 'Savings' && (pot.owner === 'hers' ? /hers|her /i : /mine/i).test(c.name));
        const plan = (hersCat ? budgetFor(l.budgets, hersCat.id, today.slice(0, 7)) : 0) || d.plannedMonthlyPayment || 0;
        const f = fundProgress(Math.max(0, st.balance), setAside, plan, today);
        return (
          <Glass key={d.id} strong style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>Paying back: {d.creditor}</h2>
              <button className="btn btn-primary" disabled={setAside <= 0} onClick={() => setPay(d)}>Pay from {pot.name}</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }} className="small">
              <div><div className="muted">Still owed</div><b className="money" style={{ fontSize: 18 }}>{formatMoney(f.owed, 'CRC')}</b></div>
              <div><div className="muted">Set aside</div><b className="money" style={{ fontSize: 18, color: `var(--${pot.owner})` }}>{formatMoney(f.setAside, 'CRC')}</b></div>
              <div><div className="muted">Still to set aside</div><b className="money" style={{ fontSize: 18 }}>{formatMoney(f.toSetAside, 'CRC')}</b></div>
              <div><div className="muted">Monthly set-aside</div><b className="money" style={{ fontSize: 18 }}>{plan ? formatMoney(plan, 'CRC') : '—'}</b></div>
              <div><div className="muted">Can pay in full by</div><b style={{ fontSize: 18 }}>{f.payInFullBy ? formatDateCR(f.payInFullBy) : '—'}</b></div>
            </div>
            <div className="bar" style={{ height: 12 }} role="img" aria-label={`${Math.round(f.covered * 100)}% covered`}><span style={{ width: `${f.covered * 100}%`, background: `var(--chart-${pot.owner === 'hers' ? 'hers' : 'mine'})` }} /></div>
            <div className="small muted">{Math.round(f.covered * 100)}% covered. Paying from the fund lowers both the fund and the debt in one step, so it's never counted as spending twice.</div>
          </Glass>
        );
      })}

      <div className="funds-charts">
      <Glass strong pad={16} style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 className="card-h" style={{ margin: 0 }}>Funds month by month</h2>
          <div style={{ display: 'flex', gap: 10 }}>
            <select className="input" style={{ width: 110, height: 36 }} aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[...new Set([...l.transactions.map((t) => Number(t.date.slice(0, 4))), Number(today.slice(0, 4))])].sort().map((y) => <option key={y}>{y}</option>)}
            </select>
            <Segmented label="View" value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />
          </div>
        </div>
        {view === 'chart' ? (
          <div style={{ height: 280 }} role="img" aria-label="Money added to funds each month, Hers and Mine stacked. Switch to Table for exact values.">
            <ResponsiveContainer>
              <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} stackOffset="sign">
                <CartesianGrid vertical={false} stroke={grid} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: axis, fontSize: 12 }} />
                <YAxis tickFormatter={fmtShort} tickLine={false} axisLine={false} width={52} tick={{ fill: axis, fontSize: 12 }} />
                <ReferenceLine y={0} stroke={axis} />
                <Tooltip formatter={(v: number) => formatMoney(v, 'CRC')} contentStyle={{ background: 'var(--solid-surface)', border: '1px solid var(--glass-border)', borderRadius: 12 }} cursor={{ fill: 'var(--accent-soft)' }} />
                <Legend iconType="circle" iconSize={10} wrapperStyle={{ fontSize: 13 }} />
                <Bar dataKey="Mine" stackId="a" fill={mineC} stroke="var(--solid-surface)" strokeWidth={1} />
                <Bar dataKey="Hers" stackId="a" fill={hersC} stroke="var(--solid-surface)" strokeWidth={1} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>Month</th><th className="num">Hers</th><th className="num">Mine</th>{hasShared && <th className="num">Shared</th>}<th className="num">Total</th><th className="num">Balance</th></tr></thead>
              <tbody>{months.map((m, i) => (
                <tr key={m.month}><td>{M[i]}</td><td className="num">{m.byOwner.hers ? formatMoney(m.byOwner.hers, 'CRC', { parens: true }) : '—'}</td><td className="num">{m.byOwner.mine ? formatMoney(m.byOwner.mine, 'CRC', { parens: true }) : '—'}</td>
                  {hasShared && <td className="num">{m.byOwner.shared ? formatMoney(m.byOwner.shared, 'CRC', { parens: true }) : '—'}</td>}
                  <td className="num">{m.net ? formatMoney(m.net, 'CRC', { parens: true }) : '—'}</td><td className="num">{formatMoney(m.endBalance, 'CRC')}</td></tr>))}</tbody>
            </table>
          </div>
        )}
      </Glass>

      <AssociationCard year={year} />
      </div>

      <Sheet open={!!pay} onClose={() => setPay(null)} title={pay ? `Pay ${pay.creditor}` : ''}>
        {pay && <PayDebtForm debt={pay} onDone={() => setPay(null)} />}
      </Sheet>
      <Sheet open={move} onClose={() => setMove(false)} title="Move money between funds">
        {move && <MoveForm onDone={() => setMove(false)} />}
      </Sheet>
    </>
  );
}

/** A transfer inside one account between pots (or from the unassigned part). Never income or expense. */
function MoveForm({ onDone }: { onDone: () => void }) {
  const l = useLedger();
  const accIds = [...new Set(l.pots.map((p) => p.accountId))];
  const opts = accIds.flatMap((a) => [{ key: `${a}|`, label: `${l.account.get(a)?.name} · Unassigned` }, ...l.pots.filter((p) => p.accountId === a).map((p) => ({ key: `${a}|${p.id}`, label: `${l.account.get(a)?.name} · ${p.name}` }))]);
  const [from, setFrom] = useState(opts[0]?.key ?? '');
  const [to, setTo] = useState(opts[1]?.key ?? '');
  const [raw, setRaw] = useState('');
  const [err, setErr] = useState('');
  const ctx: FlowContext = { accountType: (id) => l.account.get(id)?.type };
  const side = (k: string) => { const [a, p] = k.split('|'); return p ? { accountId: a!, potId: p } : { accountId: a! }; };
  const crosses = from && to && from !== to ? crossesSavings(side(from), side(to), ctx) : null;
  async function save() {
    const amount = parseAmountInput(raw, 'CRC');
    if (!amount) return setErr('Enter an amount');
    const [fa, fp] = from.split('|'); const [ta, tp] = to.split('|');
    if (fa !== ta) return setErr('Both sides must be in the same account (use a transfer for different accounts)');
    if (from === to) return setErr('Pick two different places');
    const now = Date.now();
    const tx = { id: newId(), kind: 'transfer' as const, date: todayISO(), dateEstimated: false, currency: 'CRC' as const, from: fp ? { accountId: fa!, potId: fp } : { accountId: fa! }, to: tp ? { accountId: ta!, potId: tp } : { accountId: ta! }, amount, description: 'Move between funds', tags: [], notes: '', createdAt: now, updatedAt: now };
    // Spending money → fund is saving (and fund → spending money is taking it back out): record it so the budget sees it.
    const sav = asSavings(tx, ctx, l.categories, l.pots);
    await saveTransaction(sav ? { ...sav, description: sav.direction === 'deposit' ? 'Set aside into fund' : 'Taken out of fund' } : tx);
    onDone();
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: 'grid', gap: 12 }}>
      <div className="field"><label htmlFor="mv-a">Amount</label><input id="mv-a" data-autofocus className="input input-amount" inputMode="decimal" value={raw} onChange={(e) => setRaw(e.target.value)} /></div>
      <div className="grid2">
        <div className="field"><label htmlFor="mv-f">From</label><select id="mv-f" className="input" value={from} onChange={(e) => setFrom(e.target.value)}>{opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></div>
        <div className="field"><label htmlFor="mv-t">To</label><select id="mv-t" className="input" value={to} onChange={(e) => setTo(e.target.value)}>{opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>{crosses === 'deposit' ? 'This moves spending money into a fund, so it counts as saving in your budget (Savings row of whose money it is).'
        : crosses === 'withdrawal' ? 'This takes money out of a fund back into spending money, so it counts as a savings withdrawal in your budget.'
        : 'Use this to assign the unassigned part of an account to a fund, e.g. money that was already in savings before you started tracking.'}</p>
      {err && <p role="alert" style={{ color: 'var(--expense)', margin: 0 }}>{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" type="submit">Move</button></div>
      <Pill tone="neutral">{crosses ? 'Counts as saving, not spending' : 'Not income or spending'}</Pill>
    </form>
  );
}

/** The Asociación Solidarista accounts (your savings plan and the cesantía reserve), month by month. */
function AssociationCard({ year }: { year: number }) {
  const l = useLedger();
  const today = todayISO();
  const [c1, c2, grid, axis] = useCssVar(['--chart-1', '--chart-3', '--chart-grid', '--chart-axis']);
  const accs = l.accounts.filter((a) => !a.archived && (a.type === 'association_voluntary' || a.type === 'association_cesantia'));
  const data = useMemo(() => M.map((m, i) => {
    const end = new Date(Date.UTC(year, i + 1, 0)).toISOString().slice(0, 10);
    if (end.slice(0, 7) > today.slice(0, 7)) return { month: m };
    const asOf = end > today ? today : end;
    const bal = accountBalances(l.accounts, l.transactions, asOf);
    const row: Record<string, number | string> = { month: m };
    for (const a of accs) {
      const snap = l.snapshots.filter((x) => x.accountId === a.id && x.date.slice(0, 7) === end.slice(0, 7)).at(-1);
      row[a.id] = snap ? snap.balance : a.openingDate <= asOf ? bal.get(a.id)?.total ?? 0 : 0;
    }
    return row;
  }), [l, year, today, accs]);
  if (!accs.length) return <Glass strong pad={16}><h2 className="card-h" style={{ margin: 0 }}>Association savings</h2><p className="small faint">No Asociación Solidarista accounts yet. Add them in Wealth → Accounts.</p></Glass>;
  const total = accs.reduce((s0, a) => s0 + (l.balances.get(a.id)?.total ?? 0), 0);
  const first = data.find((d) => accs.some((a) => typeof d[a.id] === 'number' && (d[a.id] as number) > 0));
  const start = first ? accs.reduce((s0, a) => s0 + ((first[a.id] as number) ?? 0), 0) : 0;
  const colors = [c1, c2];
  return (
    <Glass strong pad={16} style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
        <h2 className="card-h" style={{ margin: 0 }}>Association savings <span className="n">n {accs.length}</span><InfoTip text="Your Asociación Solidarista accounts: your savings plan and the cesantía reserve. Month-end statement figures where you have them; otherwise the app's balance. Payroll contributions add to them each quincena." /></h2>
        <span className="small faint">{year}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${accs.length + 1}, minmax(0, 1fr))`, gap: 12 }}>
        <div className="stat"><span className="stat-label">Total now</span><span className="stat-value money">{formatMoney(total, 'CRC')}</span>{start > 0 && <span className="stat-cap">{total >= start ? '+' : ''}{formatMoney(total - start, 'CRC')} since {first!.month as string} <span className="derived">· derived</span></span>}</div>
        {accs.map((a, k) => <div key={a.id} className="stat"><span className="stat-label"><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: colors[k % 2] }} /> {a.name.replace(/^Association\s*-\s*/i, '').replace(/\s*\(.*\)$/, '')}</span><span className="money" style={{ fontWeight: 650 }}>{formatMoney(l.balances.get(a.id)?.total ?? 0, 'CRC')}</span></div>)}
      </div>
      <div style={{ height: 170 }} role="img" aria-label={`Association balances by month: ${data.filter((d) => accs.some((a) => d[a.id] !== undefined)).map((d) => `${d.month} ${accs.map((a) => formatMoney((d[a.id] as number) ?? 0, 'CRC')).join(' + ')}`).join('; ')}`}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={grid} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: axis, fontSize: 11 }} />
            <YAxis tickFormatter={(v: number) => `₡${Math.round(v / 100_000)}k`} tickLine={false} axisLine={false} width={52} tick={{ fill: axis, fontSize: 11 }} />
            <Tooltip formatter={(v: number) => formatMoney(v, 'CRC')} contentStyle={{ background: 'var(--solid-surface)', border: '1px solid var(--glass-border)', borderRadius: 12 }} cursor={{ fill: 'var(--accent-soft)' }} />
            {accs.map((a, k) => <Bar key={a.id} dataKey={a.id} name={a.name} stackId="a" fill={colors[k % 2]} radius={k === accs.length - 1 ? [4, 4, 0, 0] : undefined} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Glass>
  );
}
