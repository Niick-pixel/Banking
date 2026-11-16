import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLedger } from '../app/data';
import { usePendingReminders, useCalendar } from '../app/useRecurring';
import { places } from '../app/QuickAdd';
import { Glass, Pill, Segmented } from '../design/components';
import { PageHeader, Sheet } from '../ui/Sheet';
import { ChipGroup } from '../design/components/ChipGroup';
import { describeSchedule, occurrences, suggestRecurring, templateAmount, type CalendarEvent, type Schedule } from '../domain/recurring';
import { confirmOccurrence, newId, saveRecurring, skipOccurrence } from '../db/repo';
import { usePref } from '../app/prefs';
import type { RecurringRule } from '../domain/schemas';
import { formatMoney, parseAmountInput } from '../lib/money';
import { daysInMonth, formatDateCR, lastDayOfMonth, todayISO, toISO } from '../lib/dates';

const MN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TONE: Record<CalendarEvent['tone'], string> = { income: 'var(--income)', expense: 'var(--expense)', savings: 'var(--savings)', debt: 'var(--debt)', card: 'var(--accent)', info: 'var(--text-3)' };
const addDays = (d: string, n: number) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

export default function Bills() {
  const l = useLedger();
  const today = todayISO();
  const [ym, setYm] = useState(today.slice(0, 7));
  const [day, setDay] = useState<string | null>(today);
  const [edit, setEdit] = useState<RecurringRule | 'new' | null>(null);
  const [payroll] = usePref('payroll');
  const pending = usePendingReminders();
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const monthEvents = useCalendar(`${ym}-01`, lastDayOfMonth(y, m));
  const next60 = useCalendar(addDays(today, 1), addDays(today, 60));
  const suggestions = useMemo(() => suggestRecurring(l.transactions, l.categories, l.accounts, payroll, today, l.recurring), [l, payroll, today]);
  const shift = (d: number) => { const i = y * 12 + m - 1 + d; setYm(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`); };

  // Calendar grid, Monday first.
  const firstDow = (new Date(`${ym}-01T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth(y, m) }, (_, i) => toISO(y, m, i + 1))];
  while (cells.length % 7) cells.push(null);
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of monthEvents) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const dayEvents = day ? byDay.get(day) ?? [] : [];
  const inflow = next60.filter((e) => e.tone === 'income').reduce((s, e) => s + (e.amount ?? 0), 0);
  const outflow = next60.filter((e) => ['expense', 'debt', 'card', 'savings'].includes(e.tone) && e.source !== 'tasa_cero').reduce((s, e) => s + (e.amount ?? 0), 0);

  return (
    <>
      <PageHeader title="Bills & recurring" sub="Everything that comes back: pay, bills, savings, cuotas and card due dates.">
        <button className="btn btn-primary" onClick={() => setEdit('new')}>+ Recurring</button>
      </PageHeader>

      {pending.length > 0 && (
        <Glass strong style={{ display: 'grid', gap: 10, marginBottom: 16, borderColor: 'var(--debt)' }} role="region" aria-label="Waiting for confirmation">
          <h2 className="card-h">To confirm ({pending.length})</h2>
          <p className="small muted" style={{ margin: 0 }}>Reminders don't post by themselves. Check the real amount, then confirm or skip.</p>
          {pending.map((p) => <PendingRow key={`${p.rule.id}${p.date}`} p={p} />)}
        </Glass>
      )}

      <div className="bills-grid">
        <Glass strong style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button className="btn btn-sm" aria-label="Previous month" onClick={() => shift(-1)}>‹</button>
            <h2 className="card-h">{MN[m - 1]} {y}</h2>
            <button className="btn btn-sm" aria-label="Next month" onClick={() => shift(1)}>›</button>
          </div>
          <div className="cal" role="group" aria-label={`Calendar ${MN[m - 1]} ${y}`}>
            {DOW.map((d) => <div key={d} className="cal-dow" aria-hidden="true">{d}</div>)}
            {cells.map((d, i) => {
              if (!d) return <div key={`x${i}`} className="cal-cell empty" />;
              const evs = byDay.get(d) ?? [];
              return (
                <button key={d} className={`cal-cell ${d === today ? 'today' : ''} ${d === day ? 'sel' : ''}`} onClick={() => setDay(d)} aria-label={`${Number(d.slice(8))}${evs[0] ? ` ${evs[0].title}` : ''}, ${formatDateCR(d)}${evs.length > 1 ? `, plus ${evs.slice(1).map((e) => e.title).join(', ')}` : evs.length ? '' : ', nothing scheduled'}`}>
                  <span className="cal-num">{Number(d.slice(8))}</span>
                  <span className="cal-dots" aria-hidden>{evs.slice(0, 4).map((e, k) => <i key={k} style={{ background: TONE[e.tone], opacity: e.status === 'skipped' ? 0.3 : 1, outline: e.status === 'pending' ? '2px solid var(--debt)' : undefined }} />)}{evs.length > 4 && <b>+{evs.length - 4}</b>}</span>
                  {evs[0] && <span className="cal-first">{evs[0].title}</span>}
                </button>
              );
            })}
          </div>
          <div className="small muted" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {(['income', 'expense', 'savings', 'debt', 'card', 'info'] as const).map((t) => <span key={t}><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: TONE[t], marginRight: 4 }} />{{ income: 'Income', expense: 'Bills', savings: 'Savings', debt: 'Debt', card: 'Card / Tasa Cero', info: 'Payroll (info)' }[t]}</span>)}
          </div>
        </Glass>

        <Glass strong style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
          <h2 className="card-h">{day ? formatDateCR(day) : 'Pick a day'}</h2>
          {dayEvents.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Nothing on this day.</p> : <EventList events={dayEvents} />}
          <hr style={{ border: 0, borderTop: '1px solid var(--glass-hairline)', width: '100%' }} />
          <h2 className="card-h">Next 60 days</h2>
          <div className="small" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}><span>In <b className="money" style={{ color: 'var(--income)' }}>{formatMoney(inflow, 'CRC')}</b></span><span>Out <b className="money" style={{ color: 'var(--expense)' }}>{formatMoney(outflow, 'CRC')}</b></span></div>
          {next60.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Nothing scheduled yet. Add recurring items below.</p> : <EventList events={next60.slice(0, 14)} showDate />}
        </Glass>
      </div>

      <Glass strong style={{ display: 'grid', gap: 10, marginTop: 16 }}>
        <h2 className="card-h">Recurring items ({l.recurring.length})</h2>
        {l.recurring.length === 0 ? <p className="muted small" style={{ margin: 0 }}>None yet. Start from the suggestions below, which come from your history and payroll settings.</p> : (
          <div style={{ overflowX: 'auto' }}><table className="table">
            <thead><tr><th>Item</th><th>When</th><th className="num">Amount</th><th>How</th><th>Next</th><th /></tr></thead>
            <tbody>{l.recurring.map((r) => {
              const next = occurrences(r.schedule, r.startDate, addDays(today, 1), addDays(today, 400))[0];
              return (
                <tr key={r.id} style={{ opacity: r.active ? 1 : 0.5 }}>
                  <td>{r.name}{r.endDate && <div className="small muted">until {formatDateCR(r.endDate)}</div>}</td>
                  <td className="small">{describeSchedule(r.schedule)}</td>
                  <td className="num">{formatMoney(templateAmount(r), 'CRC')}</td>
                  <td>{!r.active ? <Pill>paused</Pill> : r.informational ? <Pill>auto · info</Pill> : r.mode === 'auto_post' ? <Pill tone="income">auto</Pill> : <Pill tone="debt">reminds me</Pill>}</td>
                  <td className="small">{r.active && next && (!r.endDate || next <= r.endDate) ? formatDateCR(next) : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}><button className="btn btn-sm btn-ghost" onClick={() => void saveRecurring({ ...r, active: !r.active })}>{r.active ? 'Pause' : 'Resume'}</button><button className="btn btn-sm" onClick={() => setEdit(r)}>Edit</button></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Glass>

      {suggestions.length > 0 && (
        <Glass strong style={{ display: 'grid', gap: 10, marginTop: 16 }}>
          <h2 className="card-h">Suggested from your history</h2>
          <p className="small muted" style={{ margin: 0 }}>Each starts tomorrow, so your past isn't duplicated. "Auto" posts on the day; "reminds me" waits for you to confirm the real amount.</p>
          {suggestions.map((s) => <SuggestionRow key={s.key} s={s} />)}
          <p className="small muted" style={{ margin: 0 }}>Payroll amounts come from <Link to="/goals">Savings & goals → Automatic savings floor</Link>.</p>
        </Glass>
      )}

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'New recurring item' : 'Edit recurring item'}>
        {edit && <RecurringForm rule={edit === 'new' ? undefined : edit} onDone={() => setEdit(null)} />}
      </Sheet>
    </>
  );
}

function EventList({ events, showDate }: { events: CalendarEvent[]; showDate?: boolean }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
      {events.map((e, k) => (
        <li key={k}><Link to={e.to} style={{ display: 'flex', gap: 8, alignItems: 'baseline', color: 'inherit', textDecoration: e.status === 'skipped' ? 'line-through' : 'none' }}>
          <i aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: TONE[e.tone], flex: 'none', alignSelf: 'center' }} />
          {showDate && <span className="small muted" style={{ width: 40, flex: 'none' }}>{formatDateCR(e.date).slice(0, 5)}</span>}
          <span style={{ flex: 1 }}>{e.title}{e.status === 'pending' && <> <Pill tone="debt">confirm</Pill></>}{e.status === 'posted' && <span className="small muted"> ✓</span>}</span>
          {e.amount !== undefined && <span className="money small">{formatMoney(e.amount, 'CRC')}</span>}
        </Link></li>
      ))}
    </ul>
  );
}

function PendingRow({ p }: { p: { rule: RecurringRule; date: string } }) {
  const [raw, setRaw] = useState(String(templateAmount(p.rule) / 100));
  const amount = parseAmountInput(raw, 'CRC');
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ minWidth: 200, flex: 1 }}><b>{p.rule.name}</b> <span className="muted small">· {formatDateCR(p.date)}</span></span>
      <input className="input" style={{ width: 150, height: 36 }} inputMode="decimal" aria-label={`Amount for ${p.rule.name} on ${p.date}`} value={raw} onChange={(e) => setRaw(e.target.value)} />
      <button className="btn btn-sm btn-primary" disabled={!amount} onClick={() => amount && void confirmOccurrence(p.rule, p.date, amount)}>Confirm</button>
      <button className="btn btn-sm btn-ghost" onClick={() => void skipOccurrence(p.rule, p.date)}>Skip</button>
    </div>
  );
}

function SuggestionRow({ s }: { s: ReturnType<typeof suggestRecurring>[number] }) {
  const [raw, setRaw] = useState(s.needsAmount ? '' : String(templateAmount({ ...s.rule, id: '', createdAt: 0, updatedAt: 0 }) / 100));
  const amount = parseAmountInput(raw, 'CRC');
  async function add() {
    if (!amount) return;
    const t = { ...(s.rule.template as Record<string, unknown>) };
    if (t.kind === 'adjustment') t.signedAmount = amount; else t.amount = amount;
    const now = Date.now();
    await saveRecurring({ ...s.rule, template: t, id: newId(), createdAt: now, updatedAt: now } as RecurringRule);
  }
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', paddingTop: 6, borderTop: '1px solid var(--glass-hairline)' }}>
      <span style={{ flex: 1, minWidth: 240 }}><b>{s.name}</b> <span className="small muted">· {describeSchedule(s.rule.schedule)} · {s.rule.mode === 'auto_post' ? 'auto' : 'reminds me'}</span><div className="small muted">{s.reason}</div></span>
      <input className="input" style={{ width: 140, height: 36 }} inputMode="decimal" placeholder="Amount" aria-label={`Amount for ${s.name}`} value={raw} onChange={(e) => setRaw(e.target.value)} />
      <button className="btn btn-sm" disabled={!amount} onClick={() => void add()}>Add</button>
    </div>
  );
}

type FormKind = 'expense' | 'income' | 'savings' | 'transfer' | 'debt_payment' | 'adjustment';

function RecurringForm({ rule, onDone }: { rule?: RecurringRule; onDone: () => void }) {
  const l = useLedger();
  const plc = places(l);
  const t = (rule?.template ?? {}) as Record<string, unknown> & { from?: { accountId: string; potId?: string }; to?: { accountId: string; potId?: string }; side?: { accountId: string } };
  const key = (s?: { accountId: string; potId?: string }) => (s ? `${s.accountId}|${s.potId ?? ''}` : '');
  const side = (k: string) => { const [accountId, potId] = k.split('|'); return potId ? { accountId: accountId!, potId } : { accountId: accountId! }; };
  const spending = plc.find((p) => !p.savings)?.key ?? '';
  const [name, setName] = useState(rule?.name ?? '');
  const [kind, setKind] = useState<FormKind>((t.kind as FormKind) ?? 'expense');
  const [raw, setRaw] = useState(rule ? String(templateAmount(rule) / 100) : '');
  const [categoryId, setCategoryId] = useState((t.categoryId as string) ?? '');
  const [from, setFrom] = useState(key(t.from) || (kind === 'adjustment' ? key(t.side) : '') || spending);
  const [to, setTo] = useState(key(t.to) || plc.find((p) => p.savings)?.key || '');
  const [debtId, setDebtId] = useState((t.debtId as string) ?? '');
  const [sched, setSched] = useState<Schedule>(rule?.schedule ?? { type: 'monthly', day: 1 });
  const [mode, setMode] = useState<RecurringRule['mode']>(rule?.mode ?? 'remind');
  const [startDate, setStart] = useState(rule?.startDate ?? addDays(todayISO(), 1));
  const [endDate, setEnd] = useState(rule?.endDate ?? '');
  const [err, setErr] = useState('');
  const groups: Record<FormKind, string[]> = { expense: ['Fixed', 'Living', 'Discretionary', 'Debt Service'], income: ['Income'], savings: ['Savings'], transfer: [], debt_payment: ['Debt Service'], adjustment: [] };
  const cats = l.categories.filter((c) => groups[kind].includes(c.group));

  async function save() {
    const amount = parseAmountInput(raw, 'CRC');
    if (!name.trim()) return setErr('Give it a name');
    if (!amount) return setErr('Enter the amount');
    const base = { description: name.trim() };
    const template: Record<string, unknown> =
      kind === 'expense' ? { ...base, kind, from: side(from), amount, categoryId } :
      kind === 'income' ? { ...base, kind, to: side(from), amount, categoryId } :
      kind === 'savings' ? { ...base, kind, direction: 'deposit', from: side(from), to: side(to), amount, categoryId } :
      kind === 'transfer' ? { ...base, kind, from: side(from), to: side(to), amount } :
      kind === 'debt_payment' ? { ...base, kind, from: side(from), amount, debtId, categoryId, interestPortion: 0 } :
      { ...base, kind, side: side(from), signedAmount: amount, reason: 'Payroll contribution' };
    const now = Date.now();
    try {
      await saveRecurring({ id: rule?.id ?? newId(), name: name.trim(), template, schedule: sched, mode, startDate, endDate: endDate || undefined, lastHandledDate: rule?.lastHandledDate, skipped: rule?.skipped ?? [], informational: kind === 'adjustment', active: rule?.active ?? true, createdAt: rule?.createdAt ?? now, updatedAt: now });
      onDone();
    } catch (e) { setErr(/categoryId/.test(String(e)) ? 'Pick a category' : /debtId/.test(String(e)) ? 'Pick a debt' : e instanceof Error ? e.message.slice(0, 200) : String(e)); }
  }
  const sel = (id: string, label: string, v: string, set: (v: string) => void) => (
    <div className="field"><label htmlFor={id}>{label}</label><select id={id} className="input" value={v} onChange={(e) => set(e.target.value)}>{plc.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></div>
  );
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: 'grid', gap: 12 }}>
      <div className="field"><label htmlFor="rf-n">Name</label><input id="rf-n" data-autofocus className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Rent, Netflix, Salary…" /></div>
      <div className="field"><label htmlFor="rf-k">What is it?</label>
        <select id="rf-k" className="input" value={kind} onChange={(e) => { setKind(e.target.value as FormKind); setCategoryId(''); }}>
          <option value="expense">A bill or expense</option><option value="income">Income</option><option value="savings">Money into savings</option>
          <option value="transfer">Transfer between my accounts</option><option value="debt_payment">A debt payment</option><option value="adjustment">Payroll contribution (adds to an account, e.g. association)</option>
        </select></div>
      <div className="grid2">
        <div className="field"><label htmlFor="rf-a">Amount</label><input id="rf-a" className="input" inputMode="decimal" value={raw} onChange={(e) => setRaw(e.target.value)} /></div>
        {cats.length > 0 && <div className="field"><label htmlFor="rf-c">Category</label><select id="rf-c" className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">Choose…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
      </div>
      <div className="grid2">
        {sel('rf-f', kind === 'income' ? 'Into' : kind === 'adjustment' ? 'Account' : 'From', from, setFrom)}
        {(kind === 'savings' || kind === 'transfer') && sel('rf-t', 'To', to, setTo)}
        {kind === 'debt_payment' && <div className="field"><label htmlFor="rf-d">Debt</label><select id="rf-d" className="input" value={debtId} onChange={(e) => setDebtId(e.target.value)}><option value="">Choose…</option>{l.debts.map((d) => <option key={d.id} value={d.id}>{d.creditor}</option>)}</select></div>}
      </div>
      <div className="field"><span className="small" style={{ fontWeight: 600, color: 'var(--text-2)' }}>How often</span>
        <Segmented<Schedule['type']> label="Frequency" value={sched.type} onChange={(v) => setSched(v === 'quincena' ? { type: v } : v === 'monthly' ? { type: v, day: 1 } : v === 'days' ? { type: v, days: [1, 16] } : v === 'weekly' ? { type: v, weekday: 1 } : { type: v, month: 12, day: 15 })}
          options={[{ value: 'quincena', label: 'Quincena' }, { value: 'monthly', label: 'Monthly' }, { value: 'days', label: 'Specific days' }, { value: 'weekly', label: 'Weekly' }, { value: 'yearly', label: 'Yearly' }]} />
        {sched.type === 'days' && <DaysPicker value={sched.days} onChange={(days) => setSched({ type: 'days', days })} />}
        {sched.type === 'monthly' && <label className="small">Day of month <input className="input" style={{ width: 80, height: 34 }} type="number" min={1} max={31} value={sched.day} onChange={(e) => setSched({ type: 'monthly', day: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })} /> <span className="muted">(31 = last day)</span></label>}
        {sched.type === 'weekly' && <select className="input" style={{ maxWidth: 200 }} aria-label="Weekday" value={sched.weekday} onChange={(e) => setSched({ type: 'weekly', weekday: Number(e.target.value) })}>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => <option key={d} value={i}>{d}</option>)}</select>}
        {sched.type === 'yearly' && <div style={{ display: 'flex', gap: 8 }}><select className="input" aria-label="Month" value={sched.month} onChange={(e) => setSched({ ...sched, month: Number(e.target.value) })}>{MN.map((mm, i) => <option key={mm} value={i + 1}>{mm}</option>)}</select><input className="input" style={{ width: 80 }} aria-label="Day" type="number" min={1} max={31} value={sched.day} onChange={(e) => setSched({ ...sched, day: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })} /></div>}
      </div>
      <Segmented<RecurringRule['mode']> label="Mode" value={mode} onChange={setMode} options={[{ value: 'auto_post', label: 'Post automatically' }, { value: 'remind', label: 'Remind me to confirm' }]} />
      <div className="grid2">
        <div className="field"><label htmlFor="rf-s">Starts</label><input id="rf-s" className="input" type="date" value={startDate} onChange={(e) => setStart(e.target.value)} /></div>
        <div className="field"><label htmlFor="rf-e">Ends (optional)</label><input id="rf-e" className="input" type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} /></div>
      </div>
      {err && <p role="alert" style={{ color: 'var(--expense)', margin: 0 }}>{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        {rule && <button type="button" className="btn btn-ghost" onClick={() => void saveRecurring({ ...rule, active: false, endDate: todayISO() }).then(onDone)}>End it today</button>}
        <button className="btn btn-primary" type="submit">Save</button>
      </div>
    </form>
  );
}

/** Days of the month as a chip menu (31 = last day). */
export function DaysPicker({ value, onChange, label = 'Days of the month' }: { value: number[]; onChange: (d: number[]) => void; label?: string }) {
  return <ChipGroup<number> multi label={label} required max={8} size="sm" spread={false} value={value} onChange={(d) => onChange([...d].sort((a, b) => a - b))}
    options={Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: i === 30 ? 'Last' : String(i + 1) }))} />;
}
