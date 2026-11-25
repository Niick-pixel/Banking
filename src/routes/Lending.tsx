/**
 * Money I lent (friends, girlfriend, family). Lending moves money from your account into
 * "Money I lent", so it's still yours in Wealth and never counts as spending; when they pay
 * you back it moves back. Forgiving a loan writes it off.
 */
import { useMemo, useState } from 'react';
import { HandCoins } from 'lucide-react';
import { useLedger } from '../app/data';
import { Glass, Pill } from '../design/components';
import { ChipGroup } from '../design/components/ChipGroup';
import { InfoTip } from '../design/components/InfoTip';
import { Sheet } from '../ui/Sheet';
import { newId, saveAccount, saveLending, saveTransaction } from '../db/repo';
import { byPerson, lendingStatus, lentAccount, LENT_ACCOUNT_NAME, type LendingStatus } from '../domain/lending';
import { TransactionSchema, type Account, type Lending } from '../domain/schemas';
import { formatMoney, parseAmountInput } from '../lib/money';
import { formatDateCR, todayISO } from '../lib/dates';

const crc = (n: number) => formatMoney(n, 'CRC');
type SheetState = { kind: 'lend'; person?: string } | { kind: 'repay'; s: LendingStatus } | { kind: 'edit'; s: LendingStatus } | null;

async function ensureLentAccount(accounts: Account[]): Promise<Account> {
  const found = lentAccount(accounts);
  if (found) return found;
  const now = Date.now();
  return saveAccount({ id: newId(), name: LENT_ACCOUNT_NAME, institution: '', type: 'receivable', currency: 'CRC', openingBalance: 0, openingDate: '2000-01-01', isLiquid: false, archived: false, createdAt: now, updatedAt: now });
}

export function LendingPanel() {
  const l = useLedger();
  const today = todayISO();
  const [sheet, setSheet] = useState<SheetState>(null);
  const [showClosed, setShowClosed] = useState(false);
  const rec = lentAccount(l.accounts);
  const rows = useMemo(() => l.lendings.map((x) => lendingStatus(x, l.transactions, rec?.id, today)).sort((a, b) => Number(b.lending.status === 'open') - Number(a.lending.status === 'open') || b.owed - a.owed), [l.lendings, l.transactions, rec?.id, today]);
  const open = rows.filter((r) => r.lending.status === 'open');
  const closed = rows.filter((r) => r.lending.status !== 'open');
  const people = byPerson(rows);
  const total = open.reduce((s, r) => s + r.owed, 0);
  const overdue = open.filter((r) => r.overdue);

  return (
    <Glass strong pad={16} className="lend-panel" role="region" aria-label="Money I lent">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 className="card-h" style={{ margin: 0 }}>Money I lent <InfoTip text="Money friends, your girlfriend or family owe you. Lending moves it from your account to 'Money I lent', so it still counts as yours in Wealth and is never spending. When they pay you back, it moves back." /></h2>
        <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setSheet({ kind: 'lend' })}><HandCoins size={15} /> Lend money</button>
      </div>
      <div className="lend-total">
        <span className="small muted">Owed to you</span>
        <b className="money" style={{ fontSize: 26, color: 'var(--income)' }}>{crc(total)}</b>
        {people.length > 0 && <span className="small muted">by {people.length} {people.length === 1 ? 'person' : 'people'}{overdue.length ? <> · <span style={{ color: 'var(--expense)' }}>{overdue.length} overdue</span></> : ''}</span>}
      </div>
      {people.length > 1 && (
        <div className="lend-people">{people.map((p) => <button key={p.person} type="button" className="lend-chip" onClick={() => setSheet({ kind: 'lend', person: p.person })} title={`Lend ${p.person} more`}><b>{p.person}</b> <span className="money">{crc(p.owed)}</span></button>)}</div>
      )}
      <div className="scroll-box fill" tabIndex={0} aria-label="Loans" style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
        {open.length === 0 && <p className="small muted" style={{ margin: 0 }}>Nobody owes you anything. Use "Lend money" when you lend someone money.</p>}
        {open.map((r) => <LendingRow key={r.lending.id} r={r} onRepay={() => setSheet({ kind: 'repay', s: r })} onEdit={() => setSheet({ kind: 'edit', s: r })} />)}
        {closed.length > 0 && <button type="button" className="btn btn-ghost btn-sm" style={{ justifySelf: 'start' }} onClick={() => setShowClosed((x) => !x)}>{showClosed ? 'Hide' : 'Show'} paid back / forgiven ({closed.length})</button>}
        {showClosed && closed.map((r) => <LendingRow key={r.lending.id} r={r} onEdit={() => setSheet({ kind: 'edit', s: r })} />)}
      </div>
      <Sheet open={!!sheet} onClose={() => setSheet(null)} title={!sheet ? '' : sheet.kind === 'lend' ? 'Lend money' : sheet.kind === 'repay' ? `${sheet.s.lending.person} paid me back` : `Loan to ${sheet.s.lending.person}`}>
        {sheet?.kind === 'lend' && <LendForm person={sheet.person} onDone={() => setSheet(null)} />}
        {sheet?.kind === 'repay' && <RepayForm s={sheet.s} onDone={() => setSheet(null)} />}
        {sheet?.kind === 'edit' && <EditForm s={sheet.s} onDone={() => setSheet(null)} />}
      </Sheet>
    </Glass>
  );
}

function LendingRow({ r, onRepay, onEdit }: { r: LendingStatus; onRepay?: () => void; onEdit: () => void }) {
  const x = r.lending;
  const pct = r.lent ? Math.min(1, r.repaid / r.lent) : 0;
  return (
    <div className={`lend-row ${x.status !== 'open' ? 'closed' : ''}`}>
      <div className="lend-row-top">
        <button type="button" className="inv-name" onClick={onEdit}><b>{x.person}</b><span className="small faint">{x.description || 'Loan'} · {formatDateCR(x.lentOn)}{x.dueDate ? ` · due ${formatDateCR(x.dueDate)}` : ''}</span></button>
        <span style={{ marginLeft: 'auto', textAlign: 'right' }}>
          {x.status === 'repaid' ? <Pill tone="income">Paid back</Pill> : x.status === 'forgiven' ? <Pill>Forgiven</Pill> : <b className="money">{crc(r.owed)}</b>}
          {r.overdue && <><br /><Pill tone="expense">Overdue</Pill></>}
        </span>
      </div>
      <div className="bar" style={{ height: 6 }} role="img" aria-label={`${Math.round(pct * 100)}% paid back`}><span style={{ width: `${pct * 100}%`, background: 'var(--income)' }} /></div>
      <div className="small faint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span>Lent {crc(r.lent)} · paid back {crc(r.repaid)}{r.lastRepaid ? ` (last ${formatDateCR(r.lastRepaid).slice(0, 5)})` : ''}</span>
        {onRepay && <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={onRepay}>Paid me back</button>}
      </div>
    </div>
  );
}

function useEveryday() {
  const l = useLedger();
  return l.accounts.filter((a) => !a.archived && ['checking', 'cash', 'savings', 'goal_savings'].includes(a.type)).sort((a, b) => (a.type === 'checking' ? -1 : 0) - (b.type === 'checking' ? -1 : 0));
}

function LendForm({ person: p0, onDone }: { person?: string; onDone: () => void }) {
  const l = useLedger();
  const accs = useEveryday();
  const [person, setPerson] = useState(p0 ?? '');
  const [raw, setRaw] = useState('');
  const [what, setWhat] = useState('');
  const [from, setFrom] = useState<string>(accs[0]?.id ?? 'before');
  const [date, setDate] = useState(todayISO());
  const [due, setDue] = useState('');
  const [err, setErr] = useState('');
  const known = [...new Set(l.lendings.map((x) => x.person.trim()))];
  async function save() {
    const amount = parseAmountInput(raw, 'CRC');
    if (!person.trim()) return setErr('Who did you lend it to?');
    if (!amount) return setErr('How much?');
    const rec = await ensureLentAccount(l.accounts);
    const now = Date.now();
    const lending: Lending = { id: newId(), person: person.trim(), description: what.trim(), currency: 'CRC', lentOn: date, dueDate: due || undefined, status: 'open', notes: '', createdAt: now, updatedAt: now };
    await saveLending(lending);
    const base = { id: newId(), date, dateEstimated: false, currency: 'CRC' as const, description: `Lent to ${lending.person}${lending.description ? `: ${lending.description}` : ''}`, tags: ['lending'], notes: '', lendingId: lending.id, createdAt: now, updatedAt: now };
    await saveTransaction(TransactionSchema.parse(from === 'before'
      ? { ...base, kind: 'adjustment', side: { accountId: rec.id }, signedAmount: amount, reason: 'Lent before using the app' }
      : { ...base, kind: 'transfer', from: { accountId: from }, to: { accountId: rec.id }, amount }));
    onDone();
  }
  return (
    <form style={{ display: 'grid', gap: 12 }} onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="grid2">
        <div className="field"><label htmlFor="ln-p">To whom</label><input id="ln-p" data-autofocus className="input" list="ln-people" value={person} onChange={(e) => setPerson(e.target.value)} placeholder="Name" />
          <datalist id="ln-people">{known.map((k) => <option key={k} value={k} />)}</datalist></div>
        <div className="field"><label htmlFor="ln-a">How much</label><input id="ln-a" className="input input-amount" inputMode="decimal" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="50k" /></div>
      </div>
      <div className="field"><label htmlFor="ln-w">What for (optional)</label><input id="ln-w" className="input" value={what} onChange={(e) => setWhat(e.target.value)} placeholder="Rent help, concert tickets…" /></div>
      <ChipGroup<string> size="sm" label="Taken from" value={from} onChange={(v) => v && setFrom(v)} info="The account the money left. Pick 'Before I used the app' for an old loan: then no account balance changes."
        options={[...accs.map((a) => ({ value: a.id, label: a.name.replace(/\s*\((checking|savings)\)$/i, '') })), { value: 'before', label: 'Before I used the app' }]} />
      <div className="grid2">
        <div className="field"><label htmlFor="ln-d">Lent on</label><input id="ln-d" className="input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
        <div className="field"><label htmlFor="ln-due">Pay back by (optional)</label><input id="ln-due" className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Not spending: it moves to "Money I lent" and still counts as yours until it's paid back or you forgive it.</p>
      {err && <p className="small" role="alert" style={{ color: 'var(--expense)', margin: 0 }}>{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" type="submit">Save</button></div>
    </form>
  );
}

function RepayForm({ s, onDone }: { s: LendingStatus; onDone: () => void }) {
  const l = useLedger();
  const accs = useEveryday();
  const [raw, setRaw] = useState(String(s.owed / 100));
  const [into, setInto] = useState(accs[0]?.id ?? '');
  const [date, setDate] = useState(todayISO());
  const [err, setErr] = useState('');
  async function save() {
    const amount = parseAmountInput(raw, 'CRC');
    if (!amount) return setErr('How much did they pay?');
    if (amount > s.owed) return setErr(`They only owe ${crc(s.owed)}`);
    const rec = await ensureLentAccount(l.accounts);
    const now = Date.now();
    await saveTransaction(TransactionSchema.parse({ id: newId(), kind: 'transfer', date, dateEstimated: false, currency: 'CRC', description: `${s.lending.person} paid me back`, tags: ['lending'], notes: '', lendingId: s.lending.id, from: { accountId: rec.id }, to: { accountId: into }, amount, createdAt: now, updatedAt: now }));
    if (amount === s.owed) await saveLending({ ...s.lending, status: 'repaid' });
    onDone();
  }
  return (
    <form style={{ display: 'grid', gap: 12 }} onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <p className="small muted" style={{ margin: 0 }}>{s.lending.person} owes you <b className="money">{crc(s.owed)}</b>. A part payment is fine: the rest stays open.</p>
      <div className="grid2">
        <div className="field"><label htmlFor="rp-a">Amount</label><input id="rp-a" data-autofocus className="input input-amount" inputMode="decimal" value={raw} onChange={(e) => setRaw(e.target.value)} /></div>
        <div className="field"><label htmlFor="rp-d">Date</label><input id="rp-d" className="input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
      </div>
      <ChipGroup<string> size="sm" label="Into" value={into} onChange={(v) => v && setInto(v)} options={accs.map((a) => ({ value: a.id, label: a.name.replace(/\s*\((checking|savings)\)$/i, '') }))} />
      {err && <p className="small" role="alert" style={{ color: 'var(--expense)', margin: 0 }}>{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" type="submit">Save</button></div>
    </form>
  );
}

function EditForm({ s, onDone }: { s: LendingStatus; onDone: () => void }) {
  const l = useLedger();
  const x = s.lending;
  const [person, setPerson] = useState(x.person);
  const [what, setWhat] = useState(x.description);
  const [due, setDue] = useState(x.dueDate ?? '');
  async function forgive() {
    if (!confirm(`Forgive the ${crc(s.owed)} ${x.person} still owes? It stops counting as yours.`)) return;
    const rec = lentAccount(l.accounts);
    if (rec && s.owed > 0) {
      const now = Date.now();
      await saveTransaction(TransactionSchema.parse({ id: newId(), kind: 'adjustment', date: todayISO(), dateEstimated: false, currency: 'CRC', description: `Forgave ${x.person}`, tags: ['lending'], notes: '', lendingId: x.id, side: { accountId: rec.id }, signedAmount: -s.owed, reason: 'Loan forgiven', createdAt: now, updatedAt: now }));
    }
    await saveLending({ ...x, status: 'forgiven' });
    onDone();
  }
  return (
    <form style={{ display: 'grid', gap: 12 }} onSubmit={async (e) => { e.preventDefault(); await saveLending({ ...x, person: person.trim() || x.person, description: what.trim(), dueDate: due || undefined }); onDone(); }}>
      <div className="grid2">
        <div className="field"><label htmlFor="le-p">Person</label><input id="le-p" className="input" value={person} onChange={(e) => setPerson(e.target.value)} /></div>
        <div className="field"><label htmlFor="le-due">Pay back by</label><input id="le-due" className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
      </div>
      <div className="field"><label htmlFor="le-w">What for</label><input id="le-w" className="input" value={what} onChange={(e) => setWhat(e.target.value)} /></div>
      <p className="small muted" style={{ margin: 0 }}>Lent {crc(s.lent)} · paid back {crc(s.repaid)} · still owed <b className="money">{crc(s.owed)}</b>. Each movement is in Activity, where you can edit or delete it.</p>
      <div style={{ display: 'flex', gap: 8 }}>
        {x.status === 'open' && <button type="button" className="btn btn-ghost" onClick={() => void forgive()}>Forgive it</button>}
        {x.status !== 'open' && <button type="button" className="btn btn-ghost" onClick={async () => { await saveLending({ ...x, status: 'open' }); onDone(); }}>Reopen</button>}
        <button className="btn btn-primary" type="submit" style={{ marginLeft: 'auto' }}>Save</button>
      </div>
    </form>
  );
}
