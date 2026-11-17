/**
 * Funds → one card per account that holds funds: what the app has, what the bank
 * showed last, and "Match my bank" to put any difference into the right fund.
 */
import { useState } from 'react';
import { useLedger } from '../app/data';
import { useQuickAdd } from '../app/QuickAdd';
import { Glass } from '../design/components';
import { ChipGroup } from '../design/components/ChipGroup';
import { InfoTip } from '../design/components/InfoTip';
import { Sheet } from '../ui/Sheet';
import { newId, saveSnapshot, saveTransaction } from '../db/repo';
import { bankMatchTx, savingsCategoryFor } from '../domain/fundmoves';
import { TransactionSchema, type Account } from '../domain/schemas';
import { formatMoney, parseAmountInput } from '../lib/money';
import { formatDateCR, todayISO } from '../lib/dates';

const short = (n: string) => n.replace(/\s*\((checking|savings)\)$/i, '');

export function BankMatchCard({ account }: { account: Account }) {
  const l = useLedger();
  const [open, setOpen] = useState(false);
  const b = l.balances.get(account.id);
  const total = b?.total ?? 0;
  const inFunds = total - (b?.unassigned ?? 0);
  const snap = l.snapshots.filter((s) => s.accountId === account.id && s.date <= todayISO()).sort((x, y) => x.date.localeCompare(y.date) || x.updatedAt - y.updatedAt).at(-1);
  // Compare with everything in the app (your spreadsheet dates some savings at month-end, but the bank already has them). Only a recent check counts.
  const recent = !!snap && (Date.parse(todayISO()) - Date.parse(snap.date)) / 86_400_000 <= 16;
  const gap = snap && recent ? snap.balance - total : 0;
  return (
    <Glass pad={20} style={{ display: 'grid', gap: 4, alignContent: 'start' }}>
      <div style={{ fontWeight: 750, fontSize: 13 }} className="muted">{short(account.name).toUpperCase()} <InfoTip text="Everything in this account in the app: your funds plus anything not in a fund. Compare it with what your bank shows; Match my bank puts any difference into the right fund." /></div>
      <div className="money" style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.1 }}>{formatMoney(total, account.currency)}</div>
      <div className="small muted">In funds {formatMoney(inFunds, account.currency)}{b?.unassigned ? <> · <span style={{ color: 'rgb(var(--amber))' }}>not in a fund {formatMoney(b.unassigned, account.currency)}</span></> : ''}</div>
      <div className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
        {snap && !recent ? <span className="faint">Last checked against the bank {formatDateCR(snap.date)}</span> : snap ? (gap === 0
          ? <span style={{ color: 'rgb(var(--win))' }}>✓ Matches the bank ({formatDateCR(snap.date).slice(0, 5)})</span>
          : <span style={{ color: 'rgb(var(--amber))' }}>Bank {formatMoney(snap.balance, account.currency)} on {formatDateCR(snap.date).slice(0, 5)} · {formatMoney(Math.abs(gap), account.currency)} {gap > 0 ? 'more' : 'less'} than the app</span>)
          : <span className="faint">Not checked against the bank yet</span>}
        <button className="btn btn-sm btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setOpen(true)}>Match my bank</button>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title={`Match ${short(account.name)} to your bank`}>
        {open && <MatchForm account={account} onDone={() => setOpen(false)} />}
      </Sheet>
    </Glass>
  );
}

function MatchForm({ account, onDone }: { account: Account; onDone: () => void }) {
  const l = useLedger();
  const today = todayISO();
  const b = l.balances.get(account.id);
  const total = b?.total ?? 0;
  const pots = l.pots.filter((p) => p.accountId === account.id && !p.archived).sort((x, y) => (x.owner === 'mine' ? -1 : 0) - (y.owner === 'mine' ? -1 : 0));
  const todaySnap = l.snapshots.find((s) => s.accountId === account.id && s.date === today);
  const [raw, setRaw] = useState(todaySnap ? String(todaySnap.balance / 100) : '');
  const [fund, setFund] = useState<string>(pots[0]?.id ?? '');
  const spending = l.accounts.find((a) => a.type === 'checking' && !a.archived);
  const [mode, setMode] = useState<'saved' | 'correct'>(spending ? 'saved' : 'correct');
  const [err, setErr] = useState('');
  const bank = parseAmountInput(raw, account.currency);
  const unassigned = b?.unassigned ?? 0;
  // Money not in any fund: real (move it into a fund) or not (remove it)? Default to whichever gets closer to the bank.
  const closerIfRemoved = bank !== null && Math.abs(bank - (total - unassigned)) < Math.abs(bank - total);
  const [loose, setLoose] = useState<string | null>(null);
  const looseChoice = loose ?? (closerIfRemoved ? 'remove' : pots[0]?.id ?? 'remove');
  const totalAfterLoose = unassigned && looseChoice === 'remove' ? total - unassigned : total;
  const diff = bank === null ? null : bank - totalAfterLoose;
  const pot = pots.find((p) => p.id === fund);
  const qa = useQuickAdd();
  // Probably the cause: a recent entry of exactly this amount that went to another account or missed the fund.
  const since = new Date(Date.parse(today) - 21 * 86_400_000).toISOString().slice(0, 10);
  const suspects = diff && diff > 0 ? l.transactions.filter((t) => t.date >= since && 'to' in t && Math.abs(t.amount - diff) <= 10_000 && (t.kind === 'savings' || t.kind === 'transfer' || t.kind === 'income')
    && (t.to.accountId !== account.id || !t.to.potId)) : [];
  const name = pot?.name ?? 'not in a fund';

  async function save() {
    if (bank === null) { setErr('Type the balance your bank shows'); return; }
    await saveSnapshot(account.id, today, bank);
    if (unassigned) {
      const now = Date.now();
      const base = { id: newId(), date: today, dateEstimated: false, currency: account.currency, tags: ['bank-match'], notes: '', createdAt: now, updatedAt: now };
      if (looseChoice === 'remove') await saveTransaction(TransactionSchema.parse({ ...base, kind: 'adjustment', side: { accountId: account.id }, signedAmount: -unassigned, reason: 'Not in any fund and not in the bank', description: 'Removed money not in a fund' }));
      else await saveTransaction(TransactionSchema.parse({ ...base, kind: 'transfer', from: unassigned > 0 ? { accountId: account.id } : { accountId: account.id, potId: looseChoice }, to: unassigned > 0 ? { accountId: account.id, potId: looseChoice } : { accountId: account.id }, amount: Math.abs(unassigned), description: 'Money not in a fund moved into a fund' }));
    }
    const cat = savingsCategoryFor(l.categories, pot?.owner);
    const tx = bankMatchTx({ diff: diff ?? 0, accountId: account.id, potId: pot?.id, mode, spendingAccountId: spending?.id, categoryId: cat?.id, date: today, currency: account.currency, id: newId(), now: Date.now() });
    if (tx) await saveTransaction(TransactionSchema.parse(tx));
    onDone();
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: 'grid', gap: 14 }}>
      <div className="field"><label htmlFor="bm-v">Balance your bank shows today</label>
        <input id="bm-v" data-autofocus className="input input-amount" inputMode="decimal" value={raw} onChange={(e) => { setRaw(e.target.value); setErr(''); }} placeholder={(total / 100).toLocaleString('en-US')} /></div>
      <div className="group" style={{ display: 'grid', gap: 4, padding: '10px 12px', borderRadius: 'var(--r-chip)' }}>
        <span className="small">In the app: <b className="money">{formatMoney(total, account.currency)}</b></span>
        {pots.map((p) => <span key={p.id} className="small muted">· {p.name}: <span className="money">{formatMoney(b?.pots.get(p.id) ?? 0, account.currency)}</span></span>)}
        {b?.unassigned ? <span className="small" style={{ color: 'rgb(var(--amber))' }}>· Not in a fund: <span className="money">{formatMoney(b.unassigned, account.currency)}</span></span> : null}
        {diff !== null && <span className="small">{unassigned && looseChoice === 'remove' ? 'Difference after removing it' : 'Difference'}: <b className="money" style={{ color: diff === 0 ? 'rgb(var(--win))' : 'rgb(var(--amber))' }}>{diff === 0 ? 'none, it matches ✓' : formatMoney(diff, account.currency, { signed: true })}</b> <span className="derived">· derived</span></span>}
      </div>
      {bank !== null && unassigned !== 0 && pots.length > 0 && (
        <ChipGroup<string> label={`${formatMoney(unassigned, account.currency)} is in the app but not in any fund. What is it?`} value={looseChoice} onChange={(v) => v && setLoose(v)}
          info="Usually the starting balance from your import, or a deposit saved without a fund. If it's really in the bank, put it in the fund it belongs to; if not, remove it (nothing counts as spending)."
          options={[...pots.map((p) => ({ value: p.id, label: `It's real: ${p.name}` })), { value: 'remove', label: "It isn't in the bank: remove it", tone: 'loss' as const }]} />
      )}
      {suspects.length > 0 && (
        <div className="group" role="note" style={{ display: 'grid', gap: 6, padding: '10px 12px', borderRadius: 'var(--r-chip)', borderLeft: '3px solid rgb(var(--amber))' }}>
          <b className="small">Probably this: you logged {formatMoney(suspects[0]!.kind === 'adjustment' ? 0 : suspects[0]!.amount, account.currency)} but it didn't land in a fund here</b>
          {suspects.slice(0, 3).map((t) => 'to' in t && (
            <div key={t.id} className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>{formatDateCR(t.date)} · went to <b>{l.account.get(t.to.accountId)?.name ?? '?'}{t.to.potId ? ` · ${l.pot.get(t.to.potId)?.name ?? ''}` : ' (not in a fund)'}</b></span>
              <button type="button" className="btn btn-sm" onClick={() => qa.open(t)}>Open it and fix where it went</button>
            </div>
          ))}
          <span className="small faint">Fixing that entry is better than adding it again: otherwise the money is counted twice.</span>
        </div>
      )}
      {diff !== null && diff !== 0 && (<>
        <ChipGroup<string> label={diff > 0 ? 'Whose money is the extra?' : 'Whose money is missing?'} value={fund} onChange={(v) => v !== null && setFund(v)}
          options={[...pots.map((p) => ({ value: p.id, label: p.name })), { value: '', label: 'Not in a fund' }]} />
        <ChipGroup<'saved' | 'correct'> label="What is it?" value={mode} onChange={(v) => v && setMode(v)}
          info="Money you moved counts as saving (or taking out) in your budget and comes out of (or back into) your everyday account. Interest or a correction only fixes the balance."
          options={[...(spending ? [{ value: 'saved' as const, label: diff > 0 ? `I moved it from ${short(spending.name)}` : `I took it out to ${short(spending.name)}` }] : []), { value: 'correct' as const, label: 'Interest or a correction' }]} />
        <p className="small muted" style={{ margin: 0 }}>
          {diff > 0 ? 'Adds' : 'Takes'} <b className="money">{formatMoney(Math.abs(diff), account.currency)}</b> {diff > 0 ? 'to' : 'from'} <b>{name}</b> today
          {mode === 'saved' && spending ? `, ${diff > 0 ? 'out of' : 'back into'} ${short(spending.name)}, counted as ${diff > 0 ? 'saved' : 'taken out'} this month.` : ', without counting it as income or spending.'}
          {' '}If you already logged it with the wrong fund or account, fix that entry instead (Funds → Latest movements, or Coach → Compare them).
        </p>
      </>)}
      {err && <p role="alert" style={{ color: 'rgb(var(--loss))', margin: 0 }}>{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
 <button className="btn btn-primary" type="submit">{diff ? `${diff > 0 ? 'Add' : 'Take'} ${formatMoney(Math.abs(diff), account.currency)} ${diff > 0 ? 'to' : 'from'} ${name}` : 'Save bank balance'}</button>
      </div>
    </form>
  );
}
