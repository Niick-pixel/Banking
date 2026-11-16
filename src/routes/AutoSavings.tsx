/**
 * Automatic savings: transfers your bank makes for you on fixed days (e.g. BAC Ahorro
 * Objetivo debits checking on the 1st and 16th). Each one is a recurring rule that
 * posts itself on its day, so balances, the forecast and safe-to-spend include it.
 */
import { useMemo, useState } from 'react';
import { Pencil, PiggyBank, Plus } from 'lucide-react';
import { useLedger } from '../app/data';
import { Glass, Pill } from '../design/components';
import { ChipGroup } from '../design/components/ChipGroup';
import { Sheet } from '../ui/Sheet';
import { newId, saveRecurring } from '../db/repo';
import { describeSchedule, occurrences, templateAmount } from '../domain/recurring';
import type { RecurringRule } from '../domain/schemas';
import { formatMoney, parseAmountInput, type Minor } from '../lib/money';
import { formatDateCR, todayISO } from '../lib/dates';
import { DaysPicker } from './Bills';

const crc = (n: number) => formatMoney(n as Minor, 'CRC', { decimals: 0 });
const isAutoSaving = (r: RecurringRule) => (r.template as { kind?: string }).kind === 'savings' || ((r.template as { kind?: string }).kind === 'transfer' && /ahorro|saving/i.test(r.name));

export function AutoSavings() {
  const l = useLedger();
  const [edit, setEdit] = useState<RecurringRule | 'new' | null>(null);
  const today = todayISO();
  const rules = l.recurring.filter(isAutoSaving);
  const monthly = (r: RecurringRule) => templateAmount(r) * (r.schedule.type === 'days' ? r.schedule.days.length : r.schedule.type === 'quincena' ? 2 : r.schedule.type === 'weekly' ? 52 / 12 : r.schedule.type === 'yearly' ? 1 / 12 : 1);
  const next = (r: RecurringRule) => occurrences(r.schedule, r.startDate, today, `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`).find((d) => d >= today);
  return (
    <Glass strong style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 18, display: 'flex', gap: 8, alignItems: 'center' }}><PiggyBank size={20} aria-hidden /> Automatic savings</h2>
        <button className="btn btn-sm" onClick={() => setEdit('new')}><Plus size={15} aria-hidden /> Add</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Money your bank moves to savings by itself on fixed days, like BAC Ahorro Objetivo. Aufwind posts each one on its day, so your balances, forecast and safe-to-spend already count it.</p>
      {rules.length === 0 ? (
        <button className="btn btn-primary" style={{ justifySelf: 'start' }} onClick={() => setEdit('new')}>Set up Ahorro Objetivo (1st & 16th)</button>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {rules.map((r) => {
            const t = r.template as { to?: { accountId: string; potId?: string } };
            const dest = t.to ? `${l.account.get(t.to.accountId)?.name ?? '?'}${t.to.potId ? ` · ${l.pot.get(t.to.potId)?.name ?? ''}` : ''}` : '';
            const n = next(r);
            return (
              <li key={r.id} className="check-card" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ display: 'grid', gap: 2 }}>
                  <b>{r.name} {!r.active && <Pill>paused</Pill>}</b>
                  <span className="small muted">{crc(templateAmount(r))} · {describeSchedule(r.schedule).toLowerCase()} → {dest}</span>
                  <span className="small">≈ <b className="money">{crc(monthly(r))}</b>/month{n && r.active ? ` · next ${formatDateCR(n).slice(0, 5)}` : ''}</span>
                </span>
                <button className="btn btn-sm btn-ghost" aria-label={`Edit ${r.name}`} onClick={() => setEdit(r)}><Pencil size={15} /></button>
              </li>
            );
          })}
        </ul>
      )}
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' || !edit ? 'Automatic savings' : `Edit ${edit.name}`}>
        {edit && <AutoSavingForm rule={edit === 'new' ? undefined : edit} onDone={() => setEdit(null)} />}
      </Sheet>
    </Glass>
  );
}

function AutoSavingForm({ rule, onDone }: { rule?: RecurringRule; onDone: () => void }) {
  const l = useLedger();
  const t = (rule?.template ?? {}) as { amount?: number; from?: { accountId: string }; to?: { accountId: string; potId?: string }; categoryId?: string };
  const checking = l.accounts.find((a) => a.type === 'checking' && !a.archived);
  const savingsAcc = l.accounts.find((a) => a.type === 'goal_savings' && !a.archived) ?? l.accounts.find((a) => a.type === 'savings' && !a.archived);
  const mineFund = l.pots.find((p) => p.accountId === savingsAcc?.id && p.owner === 'mine');
  const savingsCats = l.categories.filter((c) => c.group === 'Savings' && !c.archived);
  const [name, setName] = useState(rule?.name ?? 'Ahorro Objetivo');
  const [raw, setRaw] = useState(t.amount ? String(t.amount / 100) : '');
  const [days, setDays] = useState<number[]>(rule?.schedule.type === 'days' ? rule.schedule.days : [1, 16]);
  const [from, setFrom] = useState(t.from?.accountId ?? checking?.id ?? '');
  const [to, setTo] = useState(t.to ? `${t.to.accountId}|${t.to.potId ?? ''}` : savingsAcc ? `${savingsAcc.id}|${mineFund?.id ?? ''}` : '');
  const [cat, setCat] = useState(t.categoryId ?? savingsCats.find((c) => /mine/i.test(c.name))?.id ?? savingsCats[0]?.id ?? '');
  const [active, setActive] = useState(rule?.active ?? true);
  const [err, setErr] = useState('');
  const amount = parseAmountInput(raw, 'CRC');
  const dests = useMemo(() => l.accounts.filter((a) => !a.archived && a.type !== 'credit_card' && a.id !== from).flatMap((a) => [
    { key: `${a.id}|`, label: a.name }, ...l.pots.filter((p) => p.accountId === a.id).map((p) => ({ key: `${a.id}|${p.id}`, label: `${a.name} · ${p.name} fund` })),
  ]), [l, from]);
  const today = todayISO();

  async function save() {
    setErr('');
    if (!amount) return setErr('Enter the amount of each deduction');
    if (!days.length) return setErr('Pick at least one day');
    if (!from || !to) return setErr('Pick both accounts');
    const [ta, tp] = to.split('|');
    const now = Date.now();
    try {
      await saveRecurring({
        id: rule?.id ?? newId(), name: name.trim() || 'Automatic savings',
        template: { kind: 'savings', direction: 'deposit', from: { accountId: from }, to: tp ? { accountId: ta, potId: tp } : { accountId: ta }, amount, categoryId: cat, description: name.trim() || 'Automatic savings', tags: ['auto-savings'] },
        schedule: { type: 'days', days }, mode: 'auto_post',
        // A new rule starts today, so it never back-fills deductions you already logged.
        startDate: rule?.startDate ?? today, endDate: rule?.endDate, lastHandledDate: rule?.lastHandledDate,
        skipped: rule?.skipped ?? [], informational: false, active, createdAt: rule?.createdAt ?? now, updatedAt: now,
      });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: 'grid', gap: 14 }}>
      <div className="grid2">
        <div className="field"><label htmlFor="as-name">Name</label><input id="as-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label htmlFor="as-amt">Each deduction</label><input id="as-amt" data-autofocus className="input" inputMode="decimal" placeholder="₡0" value={raw} onChange={(e) => setRaw(e.target.value)} />
          <span className="small muted">{amount ? `${crc(amount * days.length)} a month` : 'e.g. 35k'}</span></div>
      </div>
      <DaysPicker label="Deducted on" value={days} onChange={setDays} />
      <div className="grid2">
        <div className="field"><label htmlFor="as-from">Taken from</label>
          <select id="as-from" className="input" value={from} onChange={(e) => setFrom(e.target.value)}>{l.accounts.filter((a) => !a.archived && a.type !== 'credit_card').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <div className="field"><label htmlFor="as-to">Saved into</label>
          <select id="as-to" className="input" value={to} onChange={(e) => setTo(e.target.value)}>{dests.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</select></div>
      </div>
      {savingsCats.length > 1 && (
        <ChipGroup<string> label="Counts as" required value={cat} onChange={(v) => v && setCat(v)} options={savingsCats.map((c) => ({ value: c.id, label: c.name }))} />
      )}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (posts itself on each day)</label>
      <p className="small muted" style={{ margin: 0 }}>{rule ? 'Changes apply from the next deduction.' : `Starts with the next ${days.length > 1 ? 'deduction day' : 'day'}; deductions already logged aren't added again.`}</p>
      {err && <p role="alert" style={{ margin: 0, color: 'var(--expense)', fontWeight: 600 }}>{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" type="submit">{rule ? 'Save' : 'Start automatic savings'}</button></div>
    </form>
  );
}
