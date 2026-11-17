import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { AlertOctagon, AlertTriangle, BellOff, ChevronDown, Info, Lightbulb, ThumbsDown, Trophy, X } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useCoach } from '../app/coach';
import { useLedger } from '../app/data';
import { useQuickAdd } from '../app/QuickAdd';
import { useCssVar, useTheme } from '../app/theme';
import { Glass, Pill } from '../design/components';
import { DataTable, fmt, fmtShort } from '../design/components/charts';
import { Empty, PageHeader } from '../ui/Sheet';
import { formatMoney, parseAmountInput, type Minor } from '../lib/money';
import { formatDateCR, todayISO } from '../lib/dates';
import { replay } from '../coach/replay';
import { ChipGroup } from '../design/components/ChipGroup';
import { hoursOfWork } from '../coach/forecast';
import { monthReport, weeklyCheckIn } from '../coach/reports';
import { shiftMonth } from '../coach/context';
import type { Insight, Severity } from '../coach/types';
import type { SplitLine } from '../coach/windfall';
import { usePersisted } from '../app/persist';

const crc = (n: number) => formatMoney(Math.round(n) as Minor, 'CRC', { decimals: 0 });

export const SEVERITY: Record<Severity, { label: string; color: string; Icon: typeof Info }> = {
  critical: { label: 'Critical', color: 'var(--expense)', Icon: AlertOctagon },
  warning: { label: 'Warning', color: 'var(--debt)', Icon: AlertTriangle },
  heads_up: { label: 'Heads-up', color: 'rgb(var(--accent))', Icon: Lightbulb },
  info: { label: 'Info', color: 'var(--text-3)', Icon: Info },
  win: { label: 'Win', color: 'var(--income)', Icon: Trophy },
};

function MoneyInput({ onSubmit, label, cta }: { onSubmit: (v: number) => Promise<void> | void; label: string; cta: string }) {
  const [raw, setRaw] = useState('');
  const v = parseAmountInput(raw, 'CRC');
  return (
    <form className="coach-inline" onSubmit={async (e) => { e.preventDefault(); if (v !== null) { await onSubmit(v); setRaw(''); } }}>
      <input className="input" aria-label={label} placeholder="₡0" inputMode="decimal" value={raw} onChange={(e) => setRaw(e.target.value)} />
      <button className="btn btn-primary btn-sm" disabled={v === null}>{cta}</button>
    </form>
  );
}

/** One insight: what, how much, one action, and the math behind it. */
export function InsightCard({ i, compact }: { i: Insight; compact?: boolean }) {
  const coach = useCoach();
  const nav = useNavigate();
  const qa = useQuickAdd();
  const l = useLedger();
  const { dur } = useTheme();
  const [why, setWhy] = useState(false);
  const [reason, setReason] = useState('');
  const [split, setSplit] = useState(false);
  const [done, setDone] = useState('');
  const sev = SEVERITY[i.severity];
  const p = (i.action?.payload ?? {}) as Record<string, unknown>;

  async function act() {
    if (!i.action) return;
    switch (i.action.kind) {
      case 'open': case 'recategorize': {
        const tx = p.transactionId ? l.transactions.find((t) => t.id === p.transactionId) : undefined;
        if (tx && i.action.kind === 'recategorize') qa.open(tx);
        else if (p.to) nav(String(p.to));
        return;
      }
      case 'set_limit': await coach.setCap(String(p.categoryId), String(p.month), Number(p.dailyCap)); setDone(`Cap set: ${crc(Number(p.dailyCap))}/day. Quick Add will ask before going over.`); return;
      case 'move_money': await coach.saveTo({ amount: Number(p.amount), potId: p.toPotId as string | undefined, accountId: p.toAccountId as string | undefined, note: 'Coach: save first' }); setDone(`Saved ${crc(Number(p.amount))}.`); return;
      case 'cooling_off': nav(`/coach/wants?store=${encodeURIComponent(String(p.store ?? ''))}`); return;
      case 'split_windfall': setSplit((x) => !x); return;
      default: return;
    }
  }

  return (
    <motion.article layout className={`glass insight sev-${i.severity}`} style={{ '--sev': sev.color } as React.CSSProperties}
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 30, transition: { duration: dur(0.25) } }} transition={{ duration: dur(0.45), ease: [0.2, 0.8, 0.2, 1] }}>
      <header className="insight-head">
        <span className="sev-chip"><sev.Icon size={15} aria-hidden /> {sev.label}</span>
        <span className="small muted">{i.ruleId}</span>
        {!i.requiresReason && (
          <span className="insight-menu">
            <button className="icon-btn" title="Snooze 3 days" aria-label="Snooze 3 days" onClick={() => void coach.snooze(i, 3)}><BellOff size={16} /></button>
            <button className="icon-btn" title="Not useful" aria-label="Not useful" onClick={() => void coach.notUseful(i)}><ThumbsDown size={16} /></button>
            <button className="icon-btn" title="Dismiss" aria-label="Dismiss" onClick={() => void coach.dismiss(i)}><X size={16} /></button>
          </span>
        )}
      </header>
      {compact ? <h3 className="insight-title">{i.title}</h3> : <h2 className="insight-title">{i.title}</h2>}
      {!compact && <p className="insight-body">{i.body}</p>}
      {compact && <p className="insight-body small">{i.body}</p>}

      {i.requiresReason && (
        <form className="coach-inline" onSubmit={async (e) => { e.preventDefault(); if (reason.trim()) await coach.giveReason(i, reason.trim()); }}>
          <input className="input" aria-label="Reason" placeholder="Why? e.g. vet emergency, will return on the 30th" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="btn btn-primary btn-sm" disabled={!reason.trim()}>Log as borrowing</button>
        </form>
      )}
      {i.action?.kind === 'update_balance' && <MoneyInput label="Balance today" cta="Save balance" onSubmit={async (v) => { await coach.updateBalance(String(p.accountId), v); }} />}

      <div className="insight-actions">
        {i.action && !['log_reason', 'update_balance'].includes(i.action.kind) && <button className="btn btn-sm btn-primary" onClick={() => void act()}>{i.action.label}</button>}
        <button className="btn btn-sm btn-ghost why-btn" aria-expanded={why} onClick={() => setWhy((x) => !x)}>
          Why am I seeing this? <motion.span animate={{ rotate: why ? 180 : 0 }} transition={{ duration: dur(0.3) }} style={{ display: 'inline-flex' }}><ChevronDown size={14} /></motion.span>
        </button>
        {!i.requiresReason && <button className="btn btn-sm" style={{ marginLeft: 'auto' }} title="Mark as seen: it leaves the inbox until something changes" onClick={() => void coach.dismiss(i)}>✓ Got it</button>}
      </div>
      {done && <p className="small" role="status" style={{ margin: 0, color: 'var(--income)' }}>✓ {done}</p>}

      <AnimatePresence initial={false}>
        {split && i.action?.kind === 'split_windfall' && (
          <motion.div key="split" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: dur(0.4) }} style={{ overflow: 'hidden' }}>
            <SplitPreview lines={p.split as SplitLine[]} onApply={async (lines) => { const tx = l.transactions.find((t) => t.id === p.transactionId); await coach.applySplit(lines, tx && 'to' in tx ? tx.to.accountId : undefined, i.dedupeKey); }} />
          </motion.div>
        )}
        {why && (
          <motion.div key="why" className="why" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: dur(0.4) }}>
            <div className="why-inner">
              <div className="small"><b>Formula</b> <code>{i.why.formula}</code></div>
              <dl className="why-inputs">{Object.entries(i.why.inputs).map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="money">{String(v)}</dd></div>)}</dl>
              <div className="small"><b>Threshold</b> {i.why.threshold}</div>
              <div className="small muted">Priority {(i.priority ?? 0).toFixed(3)} = impact × urgency × confidence ({Math.round(i.confidence * 100)}%) × your weight × severity. Thresholds: Settings → Coach.</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

function SplitPreview({ lines, onApply }: { lines: SplitLine[]; onApply: (l: SplitLine[]) => Promise<void> }) {
  const [rows, setRows] = useState(lines);
  const [ok, setOk] = useState(false);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <div className="split">
      <table className="table"><thead><tr><th>Priority</th><th>Needs</th><th style={{ textAlign: 'right' }}>Put here</th></tr></thead>
        <tbody>{rows.map((r, k) => (
          <tr key={r.target}><td>{k + 1}. {r.label}<div className="small muted">{r.detail}</div></td><td className="money">{r.target === 'free' ? '—' : crc(r.need)}</td>
            <td style={{ textAlign: 'right' }}><input className="input" style={{ width: 130, textAlign: 'right' }} aria-label={`Amount for ${r.label}`} defaultValue={r.amount / 100}
              onBlur={(e) => { const v = parseAmountInput(e.target.value, 'CRC') ?? 0; setRows(rows.map((x, j) => (j === k ? { ...x, amount: v } : x))); }} /></td></tr>
        ))}</tbody>
        <tfoot><tr><td colSpan={2}>Total</td><td className="money" style={{ textAlign: 'right' }}>{crc(total)}</td></tr></tfoot>
      </table>
      {ok ? <p className="small" role="status" style={{ color: 'var(--income)' }}>✓ Moved. Each line is a savings movement you can edit or undo in Transactions.</p>
        : <button className="btn btn-primary btn-sm" onClick={async () => { await onApply(rows); setOk(true); }}>Approve split</button>}
    </div>
  );
}

/** "You can spend ₡X per day until the 30th." */
export function SafeToSpendCard() {
  const { run, updateBalance } = useCoach();
  const l = useLedger();
  if (!run) return null;
  const s = run.safe;
  const tone = s.tone === 'negative' ? 'var(--expense)' : s.tone === 'tight' ? 'var(--debt)' : 'var(--income)';
  const until = formatDateCR(s.until).slice(0, 5);
  if (!s.known) {
    const a = run.ctx.unknownBalance[0]!;
    return (
      <div className="safe" style={{ display: 'grid', gap: 10 }}>
        <span className="small muted">Safe to spend</span>
        <b style={{ fontSize: 22 }}>What's in {a.name} today?</b>
        <p className="small muted" style={{ margin: 0 }}>Your workbook never had this balance, so the Coach can't tell you what's safe to spend yet. Type what the BAC app shows.</p>
        <MoneyInput label={`${a.name} balance today`} cta="Save balance" onSubmit={(v) => updateBalance(a.id, v)} />
      </div>
    );
  }
  return (
    <div className="safe" style={{ display: 'grid', gap: 6 }}>
      <span className="small muted">Safe to spend until payday ({until})</span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <b className="money" style={{ fontSize: 40, lineHeight: 1.05, color: tone }}>{s.value < 0 ? crc(s.value) : crc(s.perDay)}</b>
        <span className="muted">{s.value < 0 ? 'short before payday' : `per day · ${crc(s.value)} total over ${s.days} days`}</span>
      </div>
      <p style={{ margin: 0 }}>{s.value < 0 ? `Bills and savings before ${until} need more than you have.` : `You can spend ${crc(s.perDay)} per day until the ${Number(s.until.slice(8))}${['st', 'nd', 'rd'][((Number(s.until.slice(8)) + 90) % 100 - 10) % 10 - 1] ?? 'th'}.`} <span className="small muted">Your usual day-to-day: {crc(s.typicalDaily)}/day.</span></p>
      <dl className="safe-break small">
        <div><dt>Balance{run.ctx.balanceAsOf ? ` (from ${formatDateCR(run.ctx.balanceAsOf).slice(0, 5)})` : ''}</dt><dd className="money">{crc(s.balance)}</dd></div>
        <div><dt>+ income before payday</dt><dd className="money">{crc(s.income)}</dd></div>
        <div><dt>− bills due</dt><dd className="money">{crc(s.bills)}</dd></div>
        <div><dt>− savings due</dt><dd className="money">{crc(s.savings)}</dd></div>
        <div><dt>− buffer</dt><dd className="money">{crc(s.buffer)}</dd></div>
      </dl>
      {!l.recurring.length && <p className="small muted" style={{ margin: 0 }}>Tip: add your bills in <Link to="/bills">Bills & calendar</Link> so they're counted here.</p>}
    </div>
  );
}

export function CoachTop() {
  const { run } = useCoach();
  if (!run) return null;
  const top = run.dispatch.top;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 className="card-h">Coach</h2>
        <Link to="/coach" className="small">Inbox ({run.dispatch.inbox.length}) →</Link>
      </div>
      {top.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Nothing needs you right now.</p> : (
        <div style={{ display: 'grid', gap: 10 }}><AnimatePresence>{top.map((i) => <InsightCard key={i.dedupeKey} i={i} compact />)}</AnimatePresence></div>
      )}
    </div>
  );
}

// ── Pages ─────────────────────────────────────────────────────────────────
function Inbox() {
  const { run, state, patchState } = useCoach();
  const [filter, setFilter] = usePersisted<Severity[]>('coach.filters', []);
  if (!run) return null;
  const list = run.dispatch.inbox.filter((i) => !filter.length || filter.includes(i.severity));
  const counts = (Object.keys(SEVERITY) as Severity[]).map((s) => [s, run.dispatch.inbox.filter((i) => i.severity === s).length] as const);
  return (
    <div className="coach-grid fill">
      <div className="coach-main">
        <ChipGroup<Severity> multi label="Show" note="all when none picked" value={filter} onChange={setFilter}
          options={counts.filter(([, n]) => n).map(([s, n]) => ({ value: s, label: `${SEVERITY[s].label} ${n}` }))} aside={`${list.length} of ${run.dispatch.inbox.length}`} />
        <div className="scroll-box fill stack" tabIndex={0} aria-label="Coach alerts">
        {list.length === 0 ? <Glass strong><p className="muted" style={{ margin: 0 }}>Nothing here. The Coach checks again every time you log something.</p></Glass>
          : <AnimatePresence>{list.map((i) => <InsightCard key={i.dedupeKey} i={i} />)}</AnimatePresence>}
        {run.dispatch.hidden > 0 && (
          <p className="small muted">{run.dispatch.hidden} dismissed or snoozed. <button className="btn btn-ghost btn-sm" onClick={() => void patchState({ dismissed: {}, snoozed: {} })}>Show them again</button></p>
        )}
        </div>
      </div>
      <div className="scroll-box" style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
        <Glass strong><SafeToSpendCard /></Glass>
        <Glass strong style={{ display: 'grid', gap: 8 }}>
          <h2 className="card-h">Money not wasted</h2>
          <b className="money" style={{ fontSize: 28, color: 'var(--income)' }}>{crc(state.moneyNotWasted)}</b>
          <span className="small muted">From cooling-off items you decided not to buy. <Link to="/coach/wants">Cooling-off list →</Link></span>
        </Glass>
        {run.errors.length > 0 && <Glass strong><Pill tone="expense">Rule errors</Pill><ul className="small">{run.errors.map((e) => <li key={e.ruleId}>{e.ruleId}: {e.message}</li>)}</ul></Glass>}
      </div>
    </div>
  );
}

function ForecastPage() {
  const { run } = useCoach();
  const [bal, axis, grid, exp, acc] = useCssVar(['--chart-1', '--chart-axis', '--chart-grid', '--chart-expense', '--accent']);
  const [view, setView] = usePersisted<'chart' | 'table'>('view.forecast', 'chart');
  if (!run) return null;
  if (!run.safe.known) return <Glass strong><SafeToSpendCard /></Glass>;
  const f = run.forecast;
  const data = f.days.map((d) => ({ date: d.date, label: formatDateCR(d.date).slice(0, 5), balance: d.balance, events: d.events }));
  const buffer = run.ctx.prefs.buffer;
  return (
    <div className="coach-grid">
      <Glass strong>
        <figure style={{ margin: 0 }}>
          <figcaption style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ display: 'grid' }}><b style={{ fontSize: 17 }}>Next 60 days</b><span className="small muted">Spending balance with your scheduled income, bills and savings, minus your usual {crc(f.dailyVariable)}/day. Lowest: {crc(f.min.balance)} on {formatDateCR(f.min.date).slice(0, 5)}.</span></span>
            <span className="segmented" role="group" aria-label="View"><button aria-pressed={view === 'chart'} onClick={() => setView('chart')}>Chart</button><button aria-pressed={view === 'table'} onClick={() => setView('table')}>Table</button></span>
          </figcaption>
          {view === 'chart' ? (
            <div style={{ height: 340 }} role="img" aria-label={`Forecast balance; lowest ${crc(f.min.balance)} on ${f.min.date}.`}>
              <ResponsiveContainer>
                <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs><linearGradient id="fc" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={bal} stopOpacity={0.35} /><stop offset="100%" stopColor={bal} stopOpacity={0.02} /></linearGradient></defs>
                  <CartesianGrid vertical={false} stroke={grid} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: axis, fontSize: 12 }} interval={6} />
                  <YAxis tickFormatter={fmtShort} tickLine={false} axisLine={false} width={64} tick={{ fill: axis, fontSize: 12 }} />
                  <ReferenceLine y={buffer} stroke={acc} strokeDasharray="6 5" label={{ value: 'Buffer', fill: axis, fontSize: 11, position: 'insideTopRight' }} />
                  <ReferenceLine y={0} stroke={exp} strokeOpacity={0.6} />
                  <Tooltip content={({ active, payload }) => active && payload?.[0] ? (() => { const d = payload[0].payload as (typeof data)[number]; return (
                    <div className="glass glass-strong" style={{ padding: '10px 14px', borderRadius: 14, fontSize: 13 }}>
                      <b>{formatDateCR(d.date)}</b><div className="money">{fmt(d.balance)}</div>
                      {d.events.map((e, k) => <div key={k} className="small" style={{ color: e.amount < 0 ? 'var(--expense)' : 'var(--income)' }}>{e.label}: {fmt(e.amount)}</div>)}
                    </div>); })() : null} />
                  <Area type="monotone" dataKey="balance" stroke={bal} strokeWidth={2} fill="url(#fc)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : <DataTable caption="Forecast" columns={['Day', 'Balance']} rows={data.map((d) => [d.label, d.balance])} />}
        </figure>
      </Glass>
      <Glass strong style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
        <h2 className="card-h">Scheduled</h2>
        {f.days.flatMap((d) => d.events).length === 0 ? <p className="small muted" style={{ margin: 0 }}>No recurring items yet. Add them in <Link to="/bills">Bills & calendar</Link>.</p> : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
            {f.days.flatMap((d) => d.events).slice(0, 20).map((e, k) => <li key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span><span className="small muted">{formatDateCR(e.date).slice(0, 5)}</span> {e.label}</span><span className="money" style={{ color: e.amount < 0 ? 'var(--expense)' : 'var(--income)' }}>{crc(e.amount)}</span></li>)}
          </ul>
        )}
      </Glass>
    </div>
  );
}

function WantsPage() {
  const { run, state, addWant, decideWant } = useCoach();
  const loc = useLocation();
  const [name, setName] = useState(new URLSearchParams(loc.search).get('store') ?? '');
  const [raw, setRaw] = useState('');
  const amount = parseAmountInput(raw, 'CRC');
  const now = Date.now();
  if (!run) return null;
  const p = run.ctx.prefs;
  const waiting = state.wants.filter((w) => w.status === 'waiting').sort((a, b) => a.readyAt.localeCompare(b.readyAt));
  const decided = state.wants.filter((w) => w.status !== 'waiting').slice(-10).reverse();
  const left = (iso: string) => { const ms = Date.parse(iso) - now; if (ms <= 0) return 'ready to decide'; const h = Math.ceil(ms / 3_600_000); return h > 48 ? `${Math.ceil(h / 24)} days left` : `${h} h left`; };
  return (
    <div className="coach-grid">
      <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
        <Glass strong style={{ display: 'grid', gap: 10 }}>
          <h2 className="card-h">Want to buy something?</h2>
          <p className="small muted" style={{ margin: 0 }}>Put it here first. From {crc(p.coolingMin)} it waits {p.coolingShortHours} h; from {crc(p.coolingLong)} it waits {p.coolingLongDays} days. When the timer ends: buy it, wait longer, or drop it.</p>
          <form className="coach-inline" onSubmit={async (e) => { e.preventDefault(); if (name.trim() && amount) { await addWant({ name: name.trim(), amount }); setName(''); setRaw(''); } }}>
            <input className="input" aria-label="What" placeholder="e.g. new controller on Amazon" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="input" aria-label="Price" placeholder="₡0" inputMode="decimal" style={{ maxWidth: 150 }} value={raw} onChange={(e) => setRaw(e.target.value)} />
            <button className="btn btn-primary btn-sm" disabled={!name.trim() || !amount}>Add</button>
          </form>
          {amount ? <span className="small muted">≈ {hoursOfWork(run.ctx, amount).toFixed(1)} hours of work</span> : null}
        </Glass>
        {waiting.length === 0 ? <Glass strong><p className="muted" style={{ margin: 0 }}>Nothing waiting.</p></Glass> : (
          <AnimatePresence>{waiting.map((w) => {
            const ready = Date.parse(w.readyAt) <= now;
            return (
              <motion.div key={w.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 30 }} className="glass glass-strong" style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}><b>{w.name}</b><div className="small muted">{crc(w.amount)} · ≈ {hoursOfWork(run.ctx, w.amount).toFixed(1)} h of work · {left(w.readyAt)}</div></div>
                <button className="btn btn-sm" disabled={!ready} onClick={() => void decideWant(w.id, 'bought')}>Buy it</button>
                <button className="btn btn-sm" onClick={() => void decideWant(w.id, 'extend')}>Wait a week more</button>
                <button className="btn btn-sm btn-primary" onClick={() => void decideWant(w.id, 'dropped')}>Drop it</button>
              </motion.div>
            );
          })}</AnimatePresence>
        )}
      </div>
      <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
        <Glass strong style={{ display: 'grid', gap: 6 }}>
          <h2 className="card-h">Money not wasted</h2>
          <b className="money" style={{ fontSize: 34, color: 'var(--income)' }}>{crc(state.moneyNotWasted)}</b>
        </Glass>
        {decided.length > 0 && (
          <Glass strong style={{ display: 'grid', gap: 6 }}>
            <h2 className="card-h">Decided</h2>
            {decided.map((w) => <div key={w.id} className="small" style={{ display: 'flex', justifyContent: 'space-between' }}><span>{w.name}</span><span>{w.status === 'dropped' ? <Pill tone="income">dropped</Pill> : <Pill>bought</Pill>} {crc(w.amount)}</span></div>)}
          </Glass>
        )}
      </div>
    </div>
  );
}

function HistoryPage() {
  const coach = useCoach();
  const [open, setOpen] = useState<string | null>(null);
  const months = useMemo(() => (coach.run ? replay({ ...coach.run.ctx, state: coach.state }).reverse() : []), [coach.run, coach.state]);
  if (!coach.run) return null;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p className="muted" style={{ margin: 0 }}>What the Coach would have told you at the end of each month, using only what was logged by then. Rows without a day count at month end, so pace alerts show what the month ended at.</p>
      {months.map((m) => {
        const by = (s: Severity) => m.insights.filter((i) => i.severity === s).length;
        const isOpen = open === m.month;
        return (
          <Glass strong key={m.month} pad={0}>
            <button className="month-head" style={{ width: '100%', padding: 16 }} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : m.month)}>
              <b>{new Date(`${m.month}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</b>
              <span style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                {(['critical', 'warning', 'heads_up', 'info', 'win'] as Severity[]).filter(by).map((s) => <span key={s} className="sev-count" style={{ '--sev': SEVERITY[s].color } as React.CSSProperties}>{SEVERITY[s].label} {by(s)}</span>)}
              </span>
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
                  <ul style={{ listStyle: 'none', margin: 0, padding: '0 16px 16px', display: 'grid', gap: 8 }}>
                    {m.insights.map((i) => { const S = SEVERITY[i.severity]; return (
                      <li key={i.dedupeKey} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 10 }}>
                        <S.Icon size={16} style={{ color: S.color, marginTop: 3 }} aria-label={S.label} />
                        <span><b>{i.title}</b><br /><span className="small muted">{i.body}</span></span>
                      </li>); })}
                  </ul>
                </motion.div>
              )}
            </AnimatePresence>
          </Glass>
        );
      })}
    </div>
  );
}

function ReportsPage() {
  const { run } = useCoach();
  const [mk, setMk] = useState(() => shiftMonth(todayISO().slice(0, 7), -1));
  if (!run) return null;
  const w = weeklyCheckIn(run.ctx, run.dispatch.inbox);
  const r = monthReport(run.ctx, mk);
  const months = [...run.ctx.flows.keys()].sort().reverse();
  return (
    <div className="coach-grid print-area">
      <Glass strong style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <h2 className="card-h" style={{ marginRight: 'auto' }}>Month-end report card</h2>
          <select className="input" style={{ width: 'auto' }} aria-label="Month" value={mk} onChange={(e) => setMk(e.target.value)}>{months.map((m) => <option key={m} value={m}>{new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</option>)}</select>
          <button className="btn btn-sm no-print" onClick={() => window.print()}>Print / PDF</button>
        </div>
        {!r ? <p className="muted">No data for that month.</p> : <>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 650 }}>{r.verdict}</p>
          <div className="kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            {[['Savings rate', `${Math.round(r.savingsRate * 100)}%`, `target ${Math.round(r.target * 100)}%`, r.savingsRate >= r.target ? 'var(--income)' : 'var(--debt)'], ['Saved', crc(r.saved), '', 'var(--savings)'], ['Free cash', crc(r.freeCash), 'after saving', r.freeCash >= 0 ? 'var(--income)' : 'var(--expense)'], ['Avoidable', crc(r.avoidable), r.avoidableItems.map((x) => x.name).join(', '), 'var(--text)']].map(([k, v, s, c]) => (
              <div key={k} className="glass" style={{ padding: 14, display: 'grid', gap: 2 }}><span className="small muted">{k}</span><b className="money" style={{ fontSize: 22, color: c }}>{v}</b>{s && <span className="small muted">{s}</span>}</div>
            ))}
          </div>
          <h3 style={{ margin: '6px 0 0', fontSize: 15 }}>Cost the most vs budget</h3>
          {r.worst.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Every budgeted category stayed within budget.</p> : (
            <table className="table"><thead><tr><th>Category</th><th style={{ textAlign: 'right' }}>Spent</th><th style={{ textAlign: 'right' }}>Budget</th><th style={{ textAlign: 'right' }}>Over</th></tr></thead>
              <tbody>{r.worst.map((x) => <tr key={x.name}><td>{x.name}</td><td className="money" style={{ textAlign: 'right' }}>{crc(x.spent)}</td><td className="money" style={{ textAlign: 'right' }}>{crc(x.budget)}</td><td className="money" style={{ textAlign: 'right', color: 'var(--expense)' }}>{crc(x.over)} ({Math.round(x.pct * 100)}%)</td></tr>)}</tbody></table>
          )}
          {r.debts.length > 0 && <>
            <h3 style={{ margin: '6px 0 0', fontSize: 15 }}>Debt progress</h3>
            {r.debts.map((d) => <div key={d.name} className="small" style={{ display: 'flex', justifyContent: 'space-between' }}><span>{d.name}</span><span>paid <b className="money">{crc(d.paid)}</b> · left <b className="money">{crc(d.balance)}</b></span></div>)}
          </>}
          <p className="small muted" style={{ margin: 0 }}>Income {crc(r.income)} · expenses {crc(r.expenses)} · net-worth change: see <Link to="/net-worth">Net worth</Link>.</p>
        </>}
      </Glass>
      <Glass strong style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
        <h2 className="card-h">Weekly check-in</h2>
        <span className="small muted">{formatDateCR(w.from).slice(0, 5)} – {formatDateCR(w.to).slice(0, 5)} · sent Sunday evenings when notifications are on</span>
        <div><span className="small muted">Day-to-day spent</span><br /><b className="money" style={{ fontSize: 24 }}>{crc(w.spent)}</b> <span className="small muted">vs {crc(w.pace)} weekly pace</span></div>
        <p style={{ margin: 0 }}>{w.line}</p>
        {w.safeWeek !== null && <p style={{ margin: 0 }}>Coming week: about <b className="money">{crc(w.safeWeek)}</b> safe to spend ({crc(w.perDay ?? 0)}/day).</p>}
        {w.top.length > 0 && <><b className="small">Top alerts</b>{w.top.map((i) => <div key={i.dedupeKey} className="small">• {i.title}</div>)}</>}
        {w.bills.length > 0 && <><b className="small">Due this week</b>{w.bills.map((e, k) => <div key={k} className="small" style={{ display: 'flex', justifyContent: 'space-between' }}><span>{formatDateCR(e.date).slice(0, 5)} {e.label}</span><span className="money">{crc(-e.amount)}</span></div>)}</>}
      </Glass>
    </div>
  );
}

export default function Coach() {
  const loc = useLocation();
  const l = useLedger();
  const coach = useCoach();
  if (l.ready && !l.accounts.length) return <><PageHeader title="Coach" /><Empty title="Nothing to coach yet"><p className="muted" style={{ margin: 0 }}>Import your workbook or add an account first.</p></Empty></>;
  if (!coach.enabled) return <><PageHeader title="Coach" /><Empty title="The Coach is off"><Link className="btn btn-primary" to="/settings?c=coach">Turn it on in Settings</Link></Empty></>;
  const page = loc.pathname.split('/')[2] ?? '';
  const titles: Record<string, [string, string]> = {
    '': ['Coach', 'Watches your money and tells you what to do about it, in numbers. Every alert shows its math.'],
    forecast: ['Forecast', 'Where your spending balance is heading.'],
    wants: ['Cooling-off list', 'Wait before you buy. Most wants fade.'],
    history: ['History replay', 'Which alerts would have fired each month.'],
    reports: ['Reports', 'Your weekly check-in and month-end report card.'],
  };
  const [t, sub] = titles[page] ?? titles['']!;
  return (
    <div className={page === '' ? 'fit' : undefined}>
      <PageHeader title={t} sub={sub}>{page === '' && <span className="small muted">Updated {todayISO() === coach.run?.ctx.today ? 'just now' : coach.run?.ctx.today}</span>}</PageHeader>
      {page === '' && <Inbox />}
      {page === 'forecast' && <ForecastPage />}
      {page === 'wants' && <WantsPage />}
      {page === 'history' && <HistoryPage />}
      {page === 'reports' && <ReportsPage />}
    </div>
  );
}
