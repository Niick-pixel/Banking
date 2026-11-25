import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { AlertOctagon, AlertTriangle, BellOff, ChevronDown, Info, Lightbulb, ThumbsDown, Trophy, X } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useCoach } from '../app/coach';
import { useLedger } from '../app/data';
import { useQuickAdd } from '../app/QuickAdd';
import { useCssVar, useTheme } from '../app/theme';
import { Glass, Pill } from '../design/components';
import { fmt, fmtShort } from '../design/components/charts';
import { InfoTip } from '../design/components/InfoTip';
import { Empty, PageHeader } from '../ui/Sheet';
import { formatMoney, parseAmountInput, type Minor } from '../lib/money';
import { formatDateCR, todayISO } from '../lib/dates';
import { ChipGroup } from '../design/components/ChipGroup';
import { hoursOfWork } from '../coach/forecast';
import type { Insight, Severity } from '../coach/types';
import type { SplitLine } from '../coach/windfall';
import { usePersisted } from '../app/persist';
import { DuplicateReview } from './DuplicateReview';
import { legs as legsOf } from '../domain/ledger';
import { plainFor } from '../coach/plain';

const crc = (n: number) => formatMoney(Math.round(n) as Minor, 'CRC', { decimals: 0 });
/** Scroll to a panel on the Coach page (forecast, wants) and briefly highlight it. */
function jump(id: string) {
  setTimeout(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('flash-panel'); setTimeout(() => el.classList.remove('flash-panel'), 1400);
  }, 60);
}

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
  const [dup, setDup] = useState(false);
  const sev = SEVERITY[i.severity];
  const p = (i.action?.payload ?? {}) as Record<string, unknown>;

  const plain = plainFor(i.ruleId);
  const tx = p.transactionId ? l.transactions.find((t) => t.id === p.transactionId) : undefined;
  const primaryTo = typeof p.to === 'string' ? p.to.split(/[?#]/)[0] : '';
  // More ways to act on it, picked from what the alert is about. The primary action stays first.
  const extras: { label: string; run: () => void }[] = [];
  if (tx && i.action?.kind !== 'recategorize') extras.push({ label: 'Open the movement', run: () => qa.open(tx) });
  if (typeof p.categoryId === 'string' && primaryTo !== '/transactions') extras.push({ label: `See ${l.category.get(p.categoryId)?.name ?? 'the'} movements`, run: () => nav(`/transactions?month=${String(p.month ?? todayISO().slice(0, 7))}&cat=${p.categoryId}`) });
  if (['R6', 'R7', 'R9', 'R19', 'A2', 'R5'].includes(i.ruleId)) extras.push({ label: 'See the forecast', run: () => jump('forecast') });
  if (['R4', 'R3', 'R14'].includes(i.ruleId) && i.action?.kind !== 'cooling_off') extras.push({ label: 'Wait before buying (cooling-off)', run: () => jump('wants') });
  if (['R11', 'R12'].includes(i.ruleId) && primaryTo !== '/debts') extras.push({ label: 'Open Debts', run: () => nav('/debts') });
  if (['R16', 'R20'].includes(i.ruleId) && primaryTo !== '/goals') extras.push({ label: 'Open Goals', run: () => nav('/goals') });
  if (['R8', 'R13', 'R19'].includes(i.ruleId) && primaryTo !== '/bills') extras.push({ label: 'Open the calendar', run: () => nav('/calendar') });
  if (['R6', 'R7', 'R9', 'R19'].includes(i.ruleId)) extras.push({ label: 'Log something I forgot', run: () => qa.open() });

  async function act() {
    if (!i.action) return;
    switch (i.action.kind) {
      case 'open': case 'recategorize': {
        if (i.ruleId === 'R17' && Array.isArray(p.ids)) { setDup(true); return; }
        const tx = p.transactionId ? l.transactions.find((t) => t.id === p.transactionId) : undefined;
        if (tx && i.action.kind === 'recategorize') qa.open(tx);
        else if (p.to) { nav(String(p.to)); const h = String(p.to).split('#')[1]; if (h) jump(h); }
        return;
      }
      case 'set_limit': await coach.setCap(String(p.categoryId), String(p.month), Number(p.dailyCap)); setDone(`Cap set: ${crc(Number(p.dailyCap))}/day. Quick Add will ask before going over.`); return;
      case 'move_money': await coach.saveTo({ amount: Number(p.amount), potId: p.toPotId as string | undefined, accountId: p.toAccountId as string | undefined, note: 'Coach: save first' }); setDone(`Saved ${crc(Number(p.amount))}.`); return;
      case 'cooling_off': nav(`/coach?store=${encodeURIComponent(String(p.store ?? ''))}#wants`); jump('wants'); return;
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
      {!compact && plain && (
        <div className="insight-plain">
          <p><b>What it means.</b> {plain.means}</p>
          <p><b>Why it matters.</b> {plain.matters}</p>
        </div>
      )}
      {!compact && <p className="insight-body small">{i.body}</p>}
      {compact && <p className="insight-body small">{plain?.means ?? i.body}</p>}

      {i.requiresReason && (
        <form className="coach-inline" onSubmit={async (e) => { e.preventDefault(); if (reason.trim()) await coach.giveReason(i, reason.trim()); }}>
          <input className="input" aria-label="Reason" placeholder="Why? e.g. vet emergency, will return on the 30th" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="btn btn-primary btn-sm" disabled={!reason.trim()}>Log as borrowing</button>
        </form>
      )}
      {i.action?.kind === 'update_balance' && <MoneyInput label="Balance today" cta="Save balance" onSubmit={async (v) => { await coach.updateBalance(String(p.accountId), v); }} />}

      <div className="insight-actions">
        {i.action && !['log_reason', 'update_balance'].includes(i.action.kind) && <button className="btn btn-sm btn-primary" onClick={() => void act()}>{i.action.label}</button>}
        {!compact && extras.map((x) => <button key={x.label} className="btn btn-sm" onClick={x.run}>{x.label}</button>)}
        {!compact && !i.requiresReason && <button className="btn btn-sm btn-ghost" title="Hide it until tomorrow" onClick={() => void coach.snooze(i, 1)}>Remind me tomorrow</button>}
        <button className="btn btn-sm btn-ghost why-btn" aria-expanded={why} onClick={() => setWhy((x) => !x)}>
          Show the math <motion.span animate={{ rotate: why ? 180 : 0 }} transition={{ duration: dur(0.3) }} style={{ display: 'inline-flex' }}><ChevronDown size={14} /></motion.span>
        </button>
        {!i.requiresReason && <button className="btn btn-sm" style={{ marginLeft: 'auto' }} title="Mark as seen: it leaves the inbox until something changes" onClick={() => void coach.dismiss(i)}>✓ Got it</button>}
      </div>
      {i.ruleId === 'R17' && Array.isArray(p.ids) && <DuplicateReview open={dup} ids={p.ids as string[]} onClose={() => setDup(false)} />}
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
  const qa = useQuickAdd();
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
  const z = s.belowZero[0];
  if (z) {
    // The app has a debit account below zero: that's a stale balance or a wrong entry, not "you're short".
    const since = l.transactions.filter((t) => (!z.asOf || t.date >= z.asOf) && t.date <= todayISO() && legsOf(t).some((x) => x.accountId === z.accountId && x.amount < 0))
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
    return (
      <div className="safe" style={{ display: 'grid', gap: 8 }}>
        <span className="small muted">Safe to spend until payday ({until})</span>
        <b style={{ fontSize: 22 }}>Check {z.name} first</b>
        <p className="small" style={{ margin: 0 }}>The app has it at <b className="money" style={{ color: 'var(--debt)' }}>{crc(z.balance)}</b> (the same figure as Balance check-in). A debit account can't go below zero, so this isn't money you're short: an entry below is wrong or doubled, or a deposit isn't logged. Type what BAC shows today and the app corrects itself.</p>
        <MoneyInput label={`${z.name} balance today`} cta="Save balance" onSubmit={(v) => updateBalance(z.accountId, v)} />
        {since.length > 0 && (
          <div style={{ display: 'grid', gap: 2 }}>
            <span className="small muted">Taken out of {z.name}{z.asOf ? ` since your last check-in (${formatDateCR(z.asOf).slice(0, 5)})` : ''}: is one of these wrong or doubled?</span>
            {since.map((t) => (
              <button key={t.id} type="button" className="fund-act-row" onClick={() => qa.open(t)}>
                <span className="muted">{formatDateCR(t.date).slice(0, 5)}</span>
                <span className="fund-act-what">{t.description || l.category.get((t as { categoryId?: string }).categoryId ?? '')?.name || t.kind}</span>
                <span className="money" style={{ color: 'var(--expense)' }}>{crc(legsOf(t).filter((x) => x.accountId === z.accountId).reduce((a, x) => a + x.amount, 0))}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  const cushion = s.value < 0 && s.balance + s.income - s.bills - s.savings >= 0;
  return (
    <div className="safe" style={{ display: 'grid', gap: 6 }}>
      <span className="small muted">Safe to spend until payday ({until})</span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <b className="money" style={{ fontSize: 40, lineHeight: 1.05, color: tone }}>{s.value < 0 ? crc(s.value) : crc(s.perDay)}</b>
        <span className="muted">{cushion ? 'into your cushion' : s.value < 0 ? 'short before payday' : `per day · ${crc(s.value)} total over ${s.days} days`}</span>
      </div>
      <p style={{ margin: 0 }}>{cushion ? `Your bills and savings are covered, but you're ${crc(-s.value)} into the ${crc(s.buffer)} cushion you keep for surprises.` : s.value < 0 ? `Bills, savings and your ${crc(s.buffer)} cushion before ${until} need more than you have.` : `You can spend ${crc(s.perDay)} per day until the ${Number(s.until.slice(8))}${['st', 'nd', 'rd'][((Number(s.until.slice(8)) + 90) % 100 - 10) % 10 - 1] ?? 'th'}.`} <span className="small muted">Your usual day-to-day: {crc(s.typicalDaily)}/day.</span></p>
      <dl className="safe-break small">
        <div><dt>Balance{run.ctx.balanceAsOf ? ` (from ${formatDateCR(run.ctx.balanceAsOf).slice(0, 5)})` : ''}</dt><dd className="money">{crc(s.balance)}</dd></div>
        <div><dt>+ income before payday</dt><dd className="money">{crc(s.income)}</dd></div>
        <div><dt>− bills due</dt><dd className="money">{crc(s.bills)}</dd></div>
        <div><dt>− savings due</dt><dd className="money">{crc(s.savings)}</dd></div>
        <div><dt>− buffer</dt><dd className="money">{crc(s.buffer)}</dd></div>
      </dl>
      {!l.recurring.length && <p className="small muted" style={{ margin: 0 }}>Tip: add your bills in <Link to="/calendar">Reports → Calendar</Link> so they're counted here.</p>}
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

// ── The Coach page: one window ─────────────────────────────────────────────
function Inbox() {
  const { run, patchState } = useCoach();
  const [filter, setFilter] = usePersisted<Severity[]>('coach.filters', []);
  if (!run) return null;
  const list = run.dispatch.inbox.filter((i) => !filter.length || filter.includes(i.severity));
  const counts = (Object.keys(SEVERITY) as Severity[]).map((s) => [s, run.dispatch.inbox.filter((i) => i.severity === s).length] as const);
  return (
    <div className="coach-grid fill">
      <div className="coach-main">
        <ChipGroup<Severity> multi label="Alerts" note="all when none picked" value={filter} onChange={setFilter}
          options={counts.filter(([, n]) => n).map(([s, n]) => ({ value: s, label: `${SEVERITY[s].label} ${n}` }))} aside={`${list.length} of ${run.dispatch.inbox.length}`} />
        <div className="scroll-box fill stack" tabIndex={0} aria-label="Coach alerts">
        {list.length === 0 ? <Glass strong><p className="muted" style={{ margin: 0 }}>Nothing needs you right now. The Coach checks again every time you log something.</p></Glass>
          : <AnimatePresence>{list.map((i) => <InsightCard key={i.dedupeKey} i={i} />)}</AnimatePresence>}
        {run.dispatch.hidden > 0 && (
          <p className="small muted">{run.dispatch.hidden} dismissed or snoozed. <button className="btn btn-ghost btn-sm" onClick={() => void patchState({ dismissed: {}, snoozed: {} })}>Show them again</button></p>
        )}
        {run.errors.length > 0 && <Glass strong><Pill tone="expense">Rule errors</Pill><ul className="small">{run.errors.map((e) => <li key={e.ruleId}>{e.ruleId}: {e.message}</li>)}</ul></Glass>}
        </div>
      </div>
      <div className="scroll-box coach-side" tabIndex={0} aria-label="Safe to spend, forecast and cooling-off">
        <Glass strong><SafeToSpendCard /></Glass>
        <ForecastPanel />
        <WantsPanel />
      </div>
    </div>
  );
}

/** Next 60 days of the spending balance, small. */
function ForecastPanel() {
  const { run } = useCoach();
  const [bal, axis, grid, exp, acc] = useCssVar(['--chart-1', '--chart-axis', '--chart-grid', '--chart-expense', '--accent']);
  if (!run || !run.safe.known) return null;
  const f = run.forecast;
  const data = f.days.map((d) => ({ date: d.date, label: formatDateCR(d.date).slice(0, 5), balance: d.balance, events: d.events }));
  const buffer = run.ctx.prefs.buffer;
  const events = f.days.flatMap((d) => d.events);
  return (
    <Glass strong id="forecast" className="coach-panel" style={{ display: 'grid', gap: 8 }}>
      <h2 className="card-h" style={{ margin: 0 }}>Next 60 days <InfoTip text={`Your everyday balance day by day: scheduled income, bills and savings, minus your usual ${crc(f.dailyVariable)}/day. The dashed line is your cushion.`} /></h2>
      <p className="small" style={{ margin: 0 }}>{f.firstBelowBuffer ? <>Drops under your cushion on <b>{formatDateCR(f.firstBelowBuffer.date).slice(0, 5)}</b>. </> : <>Stays above your cushion. </>}Lowest: <b className="money">{crc(f.min.balance)}</b> on {formatDateCR(f.min.date).slice(0, 5)}.</p>
      <div style={{ height: 170 }} role="img" aria-label={`Forecast balance; lowest ${crc(f.min.balance)} on ${f.min.date}.`}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
            <defs><linearGradient id="fc" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={bal} stopOpacity={0.35} /><stop offset="100%" stopColor={bal} stopOpacity={0.02} /></linearGradient></defs>
            <CartesianGrid vertical={false} stroke={grid} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: axis, fontSize: 11 }} interval={13} />
            <YAxis tickFormatter={fmtShort} tickLine={false} axisLine={false} width={52} tick={{ fill: axis, fontSize: 11 }} />
            <ReferenceLine y={buffer} stroke={acc} strokeDasharray="6 5" />
            <ReferenceLine y={0} stroke={exp} strokeOpacity={0.6} />
            <Tooltip content={({ active, payload }) => active && payload?.[0] ? (() => { const d = payload[0].payload as (typeof data)[number]; return (
              <div className="glass glass-strong" style={{ padding: '8px 12px', borderRadius: 12, fontSize: 12 }}>
                <b>{formatDateCR(d.date)}</b><div className="money">{fmt(d.balance)}</div>
                {d.events.map((e, k) => <div key={k} className="small" style={{ color: e.amount < 0 ? 'var(--expense)' : 'var(--income)' }}>{e.label}: {fmt(e.amount)}</div>)}
              </div>); })() : null} />
            <Area type="monotone" dataKey="balance" stroke={bal} strokeWidth={2} fill="url(#fc)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <details className="small">
        <summary>Scheduled ({events.length})</summary>
        {events.length === 0 ? <p className="muted" style={{ margin: '6px 0 0' }}>No recurring items yet. Add them in <Link to="/calendar">Reports → Calendar</Link>.</p> : (
          <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'grid', gap: 4 }}>
            {events.slice(0, 20).map((e, k) => <li key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span><span className="muted">{formatDateCR(e.date).slice(0, 5)}</span> {e.label}</span><span className="money" style={{ color: e.amount < 0 ? 'var(--expense)' : 'var(--income)' }}>{crc(e.amount)}</span></li>)}
          </ul>
        )}
      </details>
    </Glass>
  );
}

/** Cooling-off: park a want, decide when the timer ends. */
function WantsPanel() {
  const { run, state, addWant, decideWant } = useCoach();
  const loc = useLocation();
  const [name, setName] = useState(new URLSearchParams(loc.search).get('store') ?? '');
  const [raw, setRaw] = useState('');
  const amount = parseAmountInput(raw, 'CRC');
  const now = Date.now();
  if (!run) return null;
  const p = run.ctx.prefs;
  const waiting = state.wants.filter((w) => w.status === 'waiting').sort((a, b) => a.readyAt.localeCompare(b.readyAt));
  const left = (iso: string) => { const ms = Date.parse(iso) - now; if (ms <= 0) return 'ready to decide'; const h = Math.ceil(ms / 3_600_000); return h > 48 ? `${Math.ceil(h / 24)} days left` : `${h} h left`; };
  return (
    <Glass strong id="wants" className="coach-panel" style={{ display: 'grid', gap: 8 }}>
      <h2 className="card-h" style={{ margin: 0 }}>Cooling-off <InfoTip text={`Want to buy something? Park it here first. From ${crc(p.coolingMin)} it waits ${p.coolingShortHours} h; from ${crc(p.coolingLong)} it waits ${p.coolingLongDays} days. Most wants fade.`} /></h2>
      <form className="coach-inline" onSubmit={async (e) => { e.preventDefault(); if (name.trim() && amount) { await addWant({ name: name.trim(), amount }); setName(''); setRaw(''); } }}>
        <input className="input" aria-label="What do you want to buy" placeholder="What do you want to buy?" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" aria-label="Price" placeholder="₡0" inputMode="decimal" style={{ maxWidth: 110 }} value={raw} onChange={(e) => setRaw(e.target.value)} />
        <button className="btn btn-primary btn-sm" disabled={!name.trim() || !amount}>Wait</button>
      </form>
      {amount ? <span className="small muted">≈ {hoursOfWork(run.ctx, amount).toFixed(1)} hours of work</span> : null}
      {waiting.map((w) => {
        const ready = Date.parse(w.readyAt) <= now;
        return (
          <div key={w.id} className="want-row">
            <span style={{ flex: 1, minWidth: 0 }}><b>{w.name}</b><span className="small muted"> · {crc(w.amount)} · {left(w.readyAt)}</span></span>
            <button className="btn btn-sm" disabled={!ready} onClick={() => void decideWant(w.id, 'bought')}>Buy</button>
            <button className="btn btn-sm" onClick={() => void decideWant(w.id, 'extend')}>+1 week</button>
            <button className="btn btn-sm btn-primary" onClick={() => void decideWant(w.id, 'dropped')}>Drop</button>
          </div>
        );
      })}
      <span className="small muted">Money not wasted so far: <b className="money" style={{ color: 'var(--income)' }}>{crc(state.moneyNotWasted)}</b></span>
    </Glass>
  );
}

export default function Coach() {
  const l = useLedger();
  const coach = useCoach();
  if (l.ready && !l.accounts.length) return <><PageHeader title="Coach" /><Empty title="Nothing to coach yet"><p className="muted" style={{ margin: 0 }}>Import your workbook or add an account first.</p></Empty></>;
  if (!coach.enabled) return <><PageHeader title="Coach" /><Empty title="The Coach is off"><Link className="btn btn-primary" to="/settings?c=coach">Turn it on in Settings</Link></Empty></>;
  return (
    <div className="fit">
      <PageHeader title="Coach" sub="What needs you, in plain words, with a few things you can do about each. Safe-to-spend, the next 60 days and your cooling-off list on the right.">
        <span className="small muted">Updated {todayISO() === coach.run?.ctx.today ? 'just now' : coach.run?.ctx.today}</span>
      </PageHeader>
      <Inbox />
    </div>
  );
}
