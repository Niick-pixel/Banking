import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLedger } from '../app/data';
import { useCssVar } from '../app/theme';
import { Glass, Pill, Segmented } from '../design/components';
import { PageHeader, Toast } from '../ui/Sheet';
import { computeTracker, budgetFor } from '../domain/tracker';
import { legs } from '../domain/ledger';
import { netWorthSeries } from '../domain/networth';
import { buildWorkbook } from '../export/xlsx';
import { transactionsCsv } from '../export/csv';
import { saveFile, XLSX_MIME } from '../export/download';
import { backupFileText } from '../sync/backup';
import { formatMoney } from '../lib/money';
import { formatDateCR, lastDayOfMonth, todayISO } from '../lib/dates';
import { usePersisted } from '../app/persist';

type Tab = 'pnl' | 'cash' | 'year' | 'trend' | 'where';
const MN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fm = (n: number) => formatMoney(n, 'CRC', { parens: true });

export default function Reports() {
  const l = useLedger();
  const today = todayISO();
  const [tab, setTab] = usePersisted<Tab>('reports.tab', 'pnl');
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)));
  const [scope, setScope] = usePersisted<'month' | 'year'>('reports.scope', 'month');
  const [catId, setCatId] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState('');
  const mk = `${year}-${String(month).padStart(2, '0')}`;
  const t = useMemo(() => computeTracker(year, l.transactions.filter((x) => x.currency === 'CRC'), l.categories, l.budgets, { accountType: (id) => l.account.get(id)?.type }), [l, year]);
  const years = [...new Set([...l.transactions.map((x) => Number(x.date.slice(0, 4))), Number(today.slice(0, 4))])].sort();
  const [c1, axis, grid] = useCssVar(['--chart-1', '--chart-axis', '--chart-grid']);

  async function exportXlsx() {
    setBusy('xlsx');
    try {
      const nw = netWorthSeries({ accounts: l.accounts, snapshots: l.snapshots, transactions: l.transactions, debts: l.debts, installments: l.installments }, year, today);
      const buf = await buildWorkbook({ year, accounts: l.accounts, pots: l.pots, categories: l.categories, transactions: l.transactions, budgets: l.budgets, debts: l.debts, netWorth: nw });
      setToast(`Saved ${await saveFile(`Aufwind_${year}.xlsx`, buf, XLSX_MIME)}`);
    } catch (e) { setToast(`Export failed: ${e instanceof Error ? e.message : e}`); } finally { setBusy(''); }
  }
  async function exportCsv() {
    const inRange = l.transactions.filter((x) => (scope === 'year' || tab === 'year' ? x.date.startsWith(`${year}-`) : x.date.startsWith(mk)));
    setToast(`Saved ${await saveFile(`Aufwind_${scope === 'year' || tab === 'year' ? year : mk}.csv`, transactionsCsv(inRange, l.accounts, l.pots, l.categories), 'text/csv')}`);
  }
  async function exportJson() { setToast(`Saved ${await saveFile(`Aufwind_backup_${today}.aufwind`, await backupFileText(), 'application/json')}`); }

  const monthPicker = (
    <>
      <select className="input" style={{ width: 140 }} aria-label="Month" value={month} onChange={(e) => setMonth(Number(e.target.value))}>{MN.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
    </>
  );

  return (
    <>
      <PageHeader title="Reports" sub="Print any report to PDF with the Print button (choose “Save as PDF”).">
        <span className="no-print" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-sm" disabled={!!busy} onClick={() => void exportXlsx()}>{busy === 'xlsx' ? 'Building…' : `Excel (${year})`}</button>
          <button className="btn btn-sm" onClick={() => void exportCsv()}>CSV</button>
          <button className="btn btn-sm" onClick={() => void exportJson()}>Full backup</button>
          <button className="btn btn-sm btn-primary" onClick={() => window.print()}>Print / PDF</button>
        </span>
      </PageHeader>

      <div className="no-print" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        <Segmented<Tab> label="Report" value={tab} onChange={setTab} options={[{ value: 'pnl', label: 'Monthly P&L' }, { value: 'cash', label: 'Cash flow' }, { value: 'year', label: 'Year in review' }, { value: 'trend', label: 'Category trends' }, { value: 'where', label: 'Where it went' }]} />
        <select className="input" style={{ width: 110 }} aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y}>{y}</option>)}</select>
        {(tab === 'pnl' || tab === 'cash' || (tab === 'where' && scope === 'month')) && monthPicker}
        {tab === 'where' && <Segmented label="Period" value={scope} onChange={setScope} options={[{ value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }]} />}
      </div>

      <div className="report">
        {tab === 'pnl' && <PnL t={t} month={month} year={year} />}
        {tab === 'cash' && <CashFlow year={year} month={month} />}
        {tab === 'year' && <YearReview t={t} year={year} />}
        {tab === 'trend' && (
          <Glass strong style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <h2 className="card-h">Category trend · {year}</h2>
              <select className="input no-print" style={{ maxWidth: 300 }} aria-label="Category" value={catId} onChange={(e) => setCatId(e.target.value)}>
                <option value="">Choose a category…</option>{l.categories.map((c) => <option key={c.id} value={c.id}>{c.group} · {c.name}</option>)}
              </select>
            </div>
            {(() => {
              const row = t.sections.flatMap((s) => s.rows).find((r) => r.category.id === catId);
              if (!row) return <p className="muted" style={{ margin: 0 }}>Pick a category to see its 12 months.</p>;
              const data = row.months.map((v, i) => ({ m: MS[i], v }));
              return (<>
                <div style={{ height: 240 }} role="img" aria-label={`${row.category.name} by month. Values in the table below.`}>
                  <ResponsiveContainer><BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={grid} />
                    <XAxis dataKey="m" tickLine={false} axisLine={false} tick={{ fill: axis, fontSize: 12 }} />
                    <YAxis tickFormatter={(v: number) => `₡${Math.round(v / 100_000)}k`} tickLine={false} axisLine={false} width={52} tick={{ fill: axis, fontSize: 12 }} />
                    {row.budget > 0 && <ReferenceLine y={row.budget} stroke={axis} strokeDasharray="4 4" label={{ value: 'budget', fill: axis, fontSize: 11, position: 'insideTopRight' }} />}
                    <Tooltip formatter={(v: number) => formatMoney(v, 'CRC')} contentStyle={{ background: 'var(--solid-surface)', border: '1px solid var(--glass-border)', borderRadius: 12 }} cursor={{ fill: 'var(--accent-soft)' }} />
                    <Bar dataKey="v" name={row.category.name} fill={c1} radius={[4, 4, 0, 0]} />
                  </BarChart></ResponsiveContainer>
                </div>
                <table className="table"><thead><tr>{MS.map((m) => <th key={m} className="num">{m}</th>)}<th className="num">YTD</th><th className="num">Avg</th></tr></thead>
                  <tbody><tr>{row.months.map((v, i) => <td key={i} className="num" style={{ color: row.over[i] ? 'var(--expense)' : undefined }}>{v ? fm(v) : '—'}</td>)}<td className="num">{fm(row.ytd)}</td><td className="num">{fm(row.avg)}</td></tr></tbody></table>
              </>);
            })()}
          </Glass>
        )}
        {tab === 'where' && <WhereItWent year={year} month={scope === 'month' ? month : null} />}
      </div>
      <p className="print-only small">Aufwind · generated {formatDateCR(today)}</p>
      {toast && <Toast message={toast} onDone={() => setToast('')} />}
    </>
  );
}

function PnL({ t, month, year }: { t: ReturnType<typeof computeTracker>; month: number; year: number }) {
  const l = useLedger();
  const m = month - 1;
  const mk = `${year}-${String(month).padStart(2, '0')}`;
  return (
    <Glass strong style={{ display: 'grid', gap: 12 }}>
      <h2 className="card-h">Profit & loss · {MN[m]} {year}</h2>
      <table className="table">
        <thead><tr><th>Line</th><th className="num">Actual</th><th className="num">Budget</th><th className="num">Difference</th><th className="num">% of income</th></tr></thead>
        {t.sections.map((s) => {
          const rows = s.rows.filter((r) => r.months[m] || budgetFor(l.budgets, r.category.id, mk));
          if (!rows.length) return null;
          const total = s.subtotal.months[m]!;
          return (
            <tbody key={s.group}>
              <tr className="group-row"><th colSpan={5} style={{ paddingTop: 14, textTransform: 'uppercase', fontSize: 12, letterSpacing: '.06em' }}>{s.group}</th></tr>
              {rows.map((r) => { const b = budgetFor(l.budgets, r.category.id, mk); const v = r.months[m]!; const bad = s.group === 'Income' || s.group === 'Savings' ? v < b : v > b; return (
                <tr key={r.category.id}><td>{r.category.name}</td><td className="num">{fm(v)}</td><td className="num">{b ? fm(b) : '—'}</td><td className="num" style={{ color: b && bad ? 'var(--expense)' : undefined }}>{b ? fm(v - b) : '—'}</td><td className="num">{t.income[m] ? `${((v / t.income[m]!) * 100).toFixed(1)}%` : '—'}</td></tr>); })}
              <tr style={{ fontWeight: 700 }}><td>Total {s.group.toLowerCase()}</td><td className="num">{fm(total)}</td><td /><td /><td className="num">{t.income[m] ? `${((total / t.income[m]!) * 100).toFixed(1)}%` : '—'}</td></tr>
            </tbody>
          );
        })}
        <tbody>
          <tr style={{ fontWeight: 750 }}><td>Net income (income − expenses)</td><td className="num" style={{ color: t.net[m]! < 0 ? 'var(--expense)' : undefined }}>{fm(t.net[m]!)}</td><td colSpan={3} /></tr>
          <tr style={{ fontWeight: 750 }}><td>Saved</td><td className="num">{fm(t.saved[m]!)}</td><td colSpan={3} /></tr>
          <tr style={{ fontWeight: 800 }}><td>Left after saving (free cash)</td><td className="num" style={{ color: t.freeCash[m]! < 0 ? 'var(--expense)' : undefined }}>{fm(t.freeCash[m]!)}</td><td colSpan={3} /></tr>
        </tbody>
      </table>
    </Glass>
  );
}

function CashFlow({ year, month }: { year: number; month: number }) {
  const l = useLedger();
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = lastDayOfMonth(year, month);
  const rows = l.accounts.filter((a) => !a.archived).map((a) => {
    let opening = a.openingDate < start ? a.openingBalance : 0, inflow = 0, outflow = 0;
    const startsHere = a.openingDate >= start && a.openingDate <= end;
    if (startsHere) inflow += a.openingBalance;
    for (const tx of l.transactions) {
      if (tx.date < a.openingDate) continue;
      for (const g of legs(tx)) {
        if (g.accountId !== a.id) continue;
        if (tx.date < start) opening += g.amount;
        else if (tx.date <= end) { if (g.amount > 0) inflow += g.amount; else outflow -= g.amount; }
      }
    }
    return { a, opening, inflow, outflow, closing: opening + inflow - outflow };
  }).filter((r) => r.opening || r.inflow || r.outflow);
  const tot = rows.reduce((s, r) => ({ opening: s.opening + r.opening, inflow: s.inflow + r.inflow, outflow: s.outflow + r.outflow, closing: s.closing + r.closing }), { opening: 0, inflow: 0, outflow: 0, closing: 0 });
  return (
    <Glass strong style={{ display: 'grid', gap: 12 }}>
      <h2 className="card-h">Cash flow by account · {MN[month - 1]} {year}</h2>
      <p className="small muted" style={{ margin: 0 }}>Money in and out of each account, transfers included (they cancel out in the total).</p>
      <table className="table">
        <thead><tr><th>Account</th><th className="num">Start</th><th className="num">In</th><th className="num">Out</th><th className="num">End</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.a.id}><td>{r.a.name}</td><td className="num">{fm(r.opening)}</td><td className="num" style={{ color: 'var(--income)' }}>{fm(r.inflow)}</td><td className="num" style={{ color: 'var(--expense)' }}>{fm(-r.outflow)}</td><td className="num"><b>{fm(r.closing)}</b></td></tr>)}
          <tr style={{ fontWeight: 750 }}><td>All accounts</td><td className="num">{fm(tot.opening)}</td><td className="num">{fm(tot.inflow)}</td><td className="num">{fm(-tot.outflow)}</td><td className="num">{fm(tot.closing)}</td></tr></tbody>
      </table>
    </Glass>
  );
}

function YearReview({ t, year }: { t: ReturnType<typeof computeTracker>; year: number }) {
  const l = useLedger();
  const withData = t.income.map((v, i) => ({ i, v, free: t.freeCash[i]!, saved: t.saved[i]! })).filter((x) => x.v > 0);
  const best = [...withData].sort((a, b) => b.free - a.free)[0];
  const worst = [...withData].sort((a, b) => a.free - b.free)[0];
  const cats = t.sections.filter((s) => !['Income', 'Savings'].includes(s.group)).flatMap((s) => s.rows).filter((r) => r.ytd > 0).sort((a, b) => b.ytd - a.ytd).slice(0, 8);
  const avoidable = t.sections.flatMap((s) => s.rows).filter((r) => r.category.discretionary || r.category.group === 'Discretionary').reduce((s, r) => s + r.ytd, 0);
  const debtPaid = l.transactions.filter((x) => x.kind === 'debt_payment' && x.date.startsWith(`${year}-`)).reduce((s, x) => s + (x.kind === 'debt_payment' ? x.amount : 0), 0);
  const rate = t.ytd.income ? t.ytd.saved / t.ytd.income : 0;
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Glass strong style={{ display: 'grid', gap: 10 }}>
        <h2 className="card-h">{year} in review</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          {[['Income', t.ytd.income, 'income'], ['Expenses', t.ytd.expenses, 'expense'], ['Saved', t.ytd.saved, 'savings'], ['Free cash', t.ytd.freeCash, t.ytd.freeCash < 0 ? 'expense' : 'income'], ['Debt paid', debtPaid, 'debt'], ['Avoidable spending', avoidable, 'expense']].map(([k, v, tone]) => (
            <div key={k as string}><div className="small muted">{k}</div><div className="money" style={{ fontSize: 22, fontWeight: 800, color: `var(--${tone})` }}>{formatMoney(v as number, 'CRC')}</div></div>
          ))}
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
          <li>Savings rate <b>{(rate * 100).toFixed(1)}%</b> over {t.monthsWithData} month(s) with income.</li>
          {best && <li>Best month: <b>{MN[best.i]}</b> ({formatMoney(best.free, 'CRC')} free cash).</li>}
          {worst && worst !== best && <li>Hardest month: <b>{MN[worst.i]}</b> ({formatMoney(worst.free, 'CRC')}).</li>}
          <li>Average month: income {formatMoney(Math.round(t.ytd.income / t.monthsWithData), 'CRC')}, spending {formatMoney(Math.round(t.ytd.expenses / t.monthsWithData), 'CRC')}.</li>
        </ul>
      </Glass>
      <Glass strong style={{ display: 'grid', gap: 10 }}>
        <h2 className="card-h">Month by month</h2>
        <div className="tracker-wrap"><table className="table tracker" style={{ minWidth: 900 }}>
          <thead><tr><th className="sticky">Line</th>{MS.map((m) => <th key={m} className="num">{m}</th>)}<th className="num">Year</th></tr></thead>
          <tbody>{([['Income', t.income, t.ytd.income], ['Expenses', t.expenses, t.ytd.expenses], ['Saved', t.saved, t.ytd.saved], ['Free cash', t.freeCash, t.ytd.freeCash]] as const).map(([k, arr, y]) => (
            <tr key={k}><th className="sticky">{k}</th>{arr.map((v, i) => <td key={i} className="num" style={{ color: v < 0 ? 'var(--expense)' : undefined }}>{v ? fm(v) : '—'}</td>)}<td className="num"><b>{fm(y)}</b></td></tr>))}</tbody>
        </table></div>
      </Glass>
      <Glass strong style={{ display: 'grid', gap: 8 }}>
        <h2 className="card-h">Biggest categories</h2>
        <table className="table"><tbody>{cats.map((r) => <tr key={r.category.id}><td>{r.category.name}{r.category.discretionary && <> <Pill tone="debt">avoidable</Pill></>}</td><td className="num">{formatMoney(r.ytd, 'CRC')}</td><td className="num">{(r.pctOfIncome * 100).toFixed(1)}% of income</td></tr>)}</tbody></table>
      </Glass>
    </div>
  );
}

function WhereItWent({ year, month }: { year: number; month: number | null }) {
  const l = useLedger();
  const prefix = month ? `${year}-${String(month).padStart(2, '0')}` : `${year}-`;
  const by = new Map<string, number>();
  for (const [mk, f] of l.flows) if (mk.startsWith(prefix)) for (const [id, v] of f.byCategory) by.set(id, (by.get(id) ?? 0) + v);
  const rows = [...by].map(([id, v]) => ({ c: l.category.get(id)!, v })).filter((x) => x.c && !['Income', 'Savings'].includes(x.c.group) && x.v > 0).sort((a, b) => b.v - a.v);
  const total = rows.reduce((s, x) => s + x.v, 0);
  const groups = ['Fixed', 'Living', 'Discretionary', 'Debt Service'].map((g) => ({ g, v: rows.filter((r) => r.c.group === g).reduce((s, r) => s + r.v, 0) }));
  return (
    <Glass strong style={{ display: 'grid', gap: 12 }}>
      <h2 className="card-h">Where the money went · {month ? `${MN[month - 1]} ` : ''}{year}</h2>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }} className="small">{groups.map((x) => <span key={x.g}>{x.g}: <b className="money">{formatMoney(x.v, 'CRC')}</b> ({total ? Math.round((x.v / total) * 100) : 0}%)</span>)}</div>
      {rows.length === 0 ? <p className="muted">No spending in this period.</p> : (
        <table className="table">
          <thead><tr><th>Category</th><th className="num">Amount</th><th className="num">Share</th><th style={{ width: '35%' }} aria-hidden /></tr></thead>
          <tbody>{rows.map((x) => (
            <tr key={x.c.id}><td>{x.c.name} <span className="muted small">· {x.c.group}</span>{x.c.discretionary && <> <Pill tone="debt">avoidable</Pill></>}</td><td className="num">{formatMoney(x.v, 'CRC')}</td><td className="num">{((x.v / total) * 100).toFixed(1)}%</td>
              <td aria-hidden><div className="bar"><span style={{ width: `${(x.v / rows[0]!.v) * 100}%`, background: 'var(--chart-1)' }} /></div></td></tr>))}
            <tr style={{ fontWeight: 750 }}><td>Total spending</td><td className="num">{formatMoney(total, 'CRC')}</td><td className="num">100%</td><td /></tr></tbody>
        </table>
      )}
    </Glass>
  );
}
