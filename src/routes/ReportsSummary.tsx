/**
 * Reports → Summary: one page, plain answers. How did the month go, where did the money go,
 * what went over, what changed vs last month, and how this week looks. Exports top right.
 */
import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLedger } from '../app/data';
import { useCoach } from '../app/coach';
import { Glass, Pill } from '../design/components';
import { InfoTip } from '../design/components/InfoTip';
import { PageHeader, Toast } from '../ui/Sheet';
import { monthReport, weeklyCheckIn } from '../coach/reports';
import { shiftMonth } from '../coach/context';
import { netWorthSeries } from '../domain/networth';
import { buildWorkbook } from '../export/xlsx';
import { transactionsCsv } from '../export/csv';
import { saveFile, XLSX_MIME } from '../export/download';
import { formatMoney } from '../lib/money';
import { formatDateCR, todayISO } from '../lib/dates';

const crc = (n: number) => formatMoney(Math.round(n), 'CRC', { decimals: 0 });
const monthName = (mk: string) => new Date(`${mk}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const SPEND = ['Fixed', 'Living', 'Discretionary', 'Debt Service'];

export default function ReportsSummary() {
  const l = useLedger();
  const { run } = useCoach();
  const today = todayISO();
  const [mk, setMk] = useState(today.slice(0, 7));
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const f = l.flows.get(mk);
  const prev = l.flows.get(shiftMonth(mk, -1));
  const r = run ? monthReport(run.ctx, mk) : null;
  const w = run ? weeklyCheckIn(run.ctx, run.dispatch.inbox) : null;
  const firstMonth = [...l.flows.keys()].sort()[0] ?? mk;

  // Where it went: spending categories, biggest first.
  const spendRows = f ? [...f.byCategory].map(([id, v]) => ({ c: l.category.get(id), v })).filter((x) => x.c && SPEND.includes(x.c.group) && x.v > 0).sort((a, b) => b.v - a.v) : [];
  const spendTotal = spendRows.reduce((s, x) => s + x.v, 0);
  const top = spendRows.slice(0, 6);
  const rest = spendTotal - top.reduce((s, x) => s + x.v, 0);
  // What changed most vs last month.
  const changes = f && prev ? [...new Set([...f.byCategory.keys(), ...prev.byCategory.keys()])].map((id) => ({ c: l.category.get(id), d: (f.byCategory.get(id) ?? 0) - (prev.byCategory.get(id) ?? 0) }))
    .filter((x) => x.c && SPEND.includes(x.c.group) && Math.abs(x.d) >= 500_000).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 4) : [];

  async function exportXlsx() {
    setBusy(true);
    try {
      const year = Number(mk.slice(0, 4));
      const nw = netWorthSeries({ accounts: l.accounts, snapshots: l.snapshots, transactions: l.transactions, debts: l.debts, installments: l.installments }, year, today);
      const buf = await buildWorkbook({ year, accounts: l.accounts, pots: l.pots, categories: l.categories, transactions: l.transactions, budgets: l.budgets, debts: l.debts, netWorth: nw });
      setToast(`Saved ${await saveFile(`Aufwind_${year}.xlsx`, buf, XLSX_MIME)}`);
    } catch (e) { setToast(`Export failed: ${e instanceof Error ? e.message : e}`); } finally { setBusy(false); }
  }
  async function exportCsv() {
    setToast(`Saved ${await saveFile(`Aufwind_${mk}.csv`, transactionsCsv(l.transactions.filter((x) => x.date.startsWith(mk)), l.accounts, l.pots, l.categories), 'text/csv')}`);
  }

  return (
    <div className="fit">
      <PageHeader title="Summary" sub="How the month went, in plain words.">
        <span className="month-nav no-print">
          <button className="btn btn-sm" aria-label="Previous month" disabled={mk <= firstMonth} onClick={() => setMk(shiftMonth(mk, -1))}><ChevronLeft size={15} /></button>
          <b style={{ minWidth: 130, textAlign: 'center' }}>{monthName(mk)}</b>
          <button className="btn btn-sm" aria-label="Next month" disabled={mk >= today.slice(0, 7)} onClick={() => setMk(shiftMonth(mk, 1))}><ChevronRight size={15} /></button>
        </span>
        <span className="no-print" style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-sm" disabled={busy} onClick={() => void exportXlsx()}>{busy ? 'Building…' : 'Excel'}</button>
          <button className="btn btn-sm" onClick={() => void exportCsv()}>CSV</button>
          <button className="btn btn-sm" onClick={() => window.print()}>Print / PDF</button>
        </span>
      </PageHeader>

      {!f ? <Glass strong><p className="muted" style={{ margin: 0 }}>Nothing logged in {monthName(mk)}.</p></Glass> : (
        <div className="sum-grid fill print-area">
          <div className="sum-col">
            <Glass strong pad={16} className="sum-verdict">
              <p className="sum-line">{r?.verdict ?? 'How the month went.'}</p>
              <div className="sum-kpis">
                <div><span className="stat-label">Came in</span><b className="money" style={{ color: 'var(--income)' }}>{crc(f.income)}</b>{prev && <Delta now={f.income} before={prev.income} good="up" />}</div>
                <div><span className="stat-label">Went out</span><b className="money" style={{ color: 'var(--expense)' }}>{crc(f.expenses)}</b>{prev && <Delta now={f.expenses} before={prev.expenses} good="down" />}</div>
                <div><span className="stat-label">Saved <InfoTip text="Money put into savings (net of what you took out)." /></span><b className="money" style={{ color: 'var(--savings)' }}>{crc(f.saved)}</b>{r && <span className="small faint">{Math.round(r.savingsRate * 100)}% of income · target {Math.round(r.target * 100)}%</span>}</div>
                <div><span className="stat-label">Left over <InfoTip text="Income minus spending minus savings. Negative means it came from savings or credit." /></span><b className="money" style={{ color: f.freeCash >= 0 ? 'var(--income)' : 'var(--expense)' }}>{crc(f.freeCash)}</b></div>
              </div>
            </Glass>

            <Glass strong pad={16} className="sum-where">
              <h2 className="card-h" style={{ margin: 0 }}>Where the money went</h2>
              {top.length === 0 ? <p className="small muted" style={{ margin: 0 }}>No spending logged.</p> : (
                <div className="sum-bars">
                  {top.map((x) => (
                    <div key={x.c!.id} className="sum-bar">
                      <span className="sum-bar-name">{x.c!.name}{x.c!.discretionary && <> <Pill tone="debt">avoidable</Pill></>}</span>
                      <span className="sum-bar-track" aria-hidden><span style={{ width: `${(x.v / top[0]!.v) * 100}%` }} /></span>
                      <b className="money">{crc(x.v)}</b><span className="small faint">{Math.round((x.v / spendTotal) * 100)}%</span>
                    </div>
                  ))}
                  {rest > 0 && <div className="sum-bar"><span className="sum-bar-name muted">Everything else</span><span className="sum-bar-track" aria-hidden><span style={{ width: `${(rest / top[0]!.v) * 100}%`, opacity: .5 }} /></span><b className="money">{crc(rest)}</b><span className="small faint">{Math.round((rest / spendTotal) * 100)}%</span></div>}
                </div>
              )}
            </Glass>
          </div>

          <div className="sum-col scroll-box" tabIndex={0} aria-label="Details">
            <Glass strong pad={16} style={{ display: 'grid', gap: 8 }}>
              <h2 className="card-h" style={{ margin: 0 }}>Went over budget</h2>
              {!r || r.worst.length === 0 ? <p className="small" style={{ margin: 0, color: 'var(--income)' }}>✓ Everything with a budget stayed within it.</p>
                : r.worst.map((x) => <div key={x.name} className="sum-row"><span>{x.name}</span><span className="small faint">{crc(x.spent)} of {crc(x.budget)}</span><b className="money" style={{ color: 'var(--expense)' }}>+{crc(x.over)}</b></div>)}
            </Glass>
            {changes.length > 0 && (
              <Glass strong pad={16} style={{ display: 'grid', gap: 8 }}>
                <h2 className="card-h" style={{ margin: 0 }}>Biggest changes vs {monthName(shiftMonth(mk, -1)).split(' ')[0]}</h2>
                {changes.map((x) => <div key={x.c!.id} className="sum-row"><span>{x.c!.name}</span><b className="money" style={{ color: x.d > 0 ? 'var(--expense)' : 'var(--income)' }}>{x.d > 0 ? '+' : '−'}{crc(Math.abs(x.d))}</b></div>)}
              </Glass>
            )}
            {r && r.debts.length > 0 && (
              <Glass strong pad={16} style={{ display: 'grid', gap: 8 }}>
                <h2 className="card-h" style={{ margin: 0 }}>Debts</h2>
                {r.debts.map((d) => <div key={d.name} className="sum-row"><span>{d.name}</span><span className="small faint">paid {crc(d.paid)}</span><b className="money">{crc(d.balance)} left</b></div>)}
              </Glass>
            )}
            {w && mk === today.slice(0, 7) && (
              <Glass strong pad={16} style={{ display: 'grid', gap: 6 }}>
                <h2 className="card-h" style={{ margin: 0 }}>This week <span className="small faint">{formatDateCR(w.from).slice(0, 5)} – {formatDateCR(w.to).slice(0, 5)}</span></h2>
                <p style={{ margin: 0 }}>{w.line}</p>
                {w.safeWeek !== null && <p className="small" style={{ margin: 0 }}>Coming week: about <b className="money">{crc(w.safeWeek)}</b> safe to spend ({crc(w.perDay ?? 0)}/day).</p>}
                {w.bills.length > 0 && <>{w.bills.map((e, k) => <div key={k} className="sum-row small"><span>{formatDateCR(e.date).slice(0, 5)} {e.label}</span><span className="money">{crc(-e.amount)}</span></div>)}</>}
              </Glass>
            )}
          </div>
        </div>
      )}
      {toast && <Toast message={toast} onDone={() => setToast('')} />}
    </div>
  );
}

function Delta({ now, before, good }: { now: number; before: number; good: 'up' | 'down' }) {
  const d = now - before;
  if (!before || Math.abs(d) < 100) return <span className="small faint">same as last month</span>;
  const better = good === 'up' ? d > 0 : d < 0;
  return <span className="small" style={{ color: better ? 'var(--income)' : 'var(--expense)' }}>{d > 0 ? '▲' : '▼'} {crc(Math.abs(d))} vs last month</span>;
}
