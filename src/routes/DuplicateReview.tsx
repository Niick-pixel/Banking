/**
 * Coach → "Possible duplicate": the entries side by side, with where each one went
 * (account and fund), so you can see which is the real one. Delete the extra one,
 * fix one, or keep them all.
 */
import { useMemo, useState } from 'react';
import { useCoach } from '../app/coach';
import { useLedger } from '../app/data';
import { useQuickAdd } from '../app/QuickAdd';
import { Sheet } from '../ui/Sheet';
import { deleteTransaction, lastAuditId, undoAudit } from '../db/repo';
import type { Transaction } from '../domain/schemas';
import { formatMoney } from '../lib/money';
import { formatDateCR } from '../lib/dates';

const KIND: Record<Transaction['kind'], string> = { income: 'Income', expense: 'Expense', transfer: 'Transfer', savings: 'Savings', debt_payment: 'Debt payment', adjustment: 'Adjustment' };
const amountOf = (t: Transaction) => (t.kind === 'adjustment' ? t.signedAmount : t.amount);
const accOf = (t: Transaction) => ('from' in t ? t.from.accountId : 'to' in t ? t.to.accountId : t.side.accountId);
const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

/** The flagged pair plus any other entry of the same kind, account and amount within a day of them. */
export function duplicateCluster(ids: string[], txs: Transaction[]): Transaction[] {
  const seed = txs.filter((t) => ids.includes(t.id));
  if (!seed.length) return [];
  const s = seed[0]!;
  const same = txs.filter((t) => t.kind === s.kind && accOf(t) === accOf(s) && amountOf(t) === amountOf(s));
  const out = [...seed];
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of same) if (!out.includes(t) && out.some((o) => dayDiff(o.date, t.date) <= 1)) { out.push(t); grew = true; }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
}

export function DuplicateReview({ ids, open, onClose }: { ids: string[]; open: boolean; onClose: () => void }) {
  const l = useLedger();
  const coach = useCoach();
  const qa = useQuickAdd();
  const [undo, setUndo] = useState<{ id: number; label: string } | null>(null);
  const items = useMemo(() => duplicateCluster(ids, l.transactions), [ids, l.transactions]);

  // Where each one went; the odd one out is marked.
  const destKey = (t: Transaction) => ('to' in t ? `${t.to.accountId}|${t.to.potId ?? ''}` : t.kind === 'adjustment' ? `${t.side.accountId}|${t.side.potId ?? ''}` : '');
  const counts = new Map<string, number>(); for (const t of items) counts.set(destKey(t), (counts.get(destKey(t)) ?? 0) + 1);
  const odd = (t: Transaction) => counts.size > 1 && (counts.get(destKey(t)) ?? 0) < Math.max(...counts.values());
  const place = (s?: { accountId: string; potId?: string }) => {
    if (!s) return null;
    const a = l.account.get(s.accountId);
    const pots = l.pots.filter((p) => p.accountId === s.accountId && !p.archived);
    return (
      <span>
        {a?.name ?? '?'}
        {s.potId ? <> · <b>{l.pot.get(s.potId)?.name ?? '?'}</b></> : pots.length ? <> · <b style={{ color: 'rgb(var(--amber))' }}>not in a fund</b></> : null}
      </span>
    );
  };
  const source = (t: Transaction) => (t.importBatchId ? 'From your spreadsheet import' : t.recurringId ? 'Posted by a recurring rule' : t.tags.includes('check-in') ? 'From a balance check-in' : 'Added by you');
  const stamp = (n: number) => new Date(n).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  // Leaving them all: clear every duplicate warning about these entries.
  const keepAll = async () => {
    const keys = new Set(items.map((t) => t.id));
    for (const i of coach?.run?.dispatch.inbox ?? []) if (i.ruleId === 'R17' && i.dedupeKey.split(':').slice(1).some((k) => keys.has(k))) await coach.dismiss(i);
    onClose();
  };
  const remove = async (t: Transaction) => {
    await deleteTransaction(t.id);
    const id = await lastAuditId();
    if (id) setUndo({ id, label: `Deleted ${formatMoney(amountOf(t), t.currency)} on ${formatDateCR(t.date)}` });
  };

  return (
    <Sheet open={open} onClose={onClose} wide title="Possible duplicate" caption={`${items.length} similar entries`}
      footer={<>
        <span className="small muted" role="status" style={{ marginRight: 'auto' }}>{undo ? <>{undo.label}. <button className="btn btn-ghost btn-sm" onClick={() => void undoAudit(undo.id).then(() => setUndo(null))}>Undo</button></> : 'Delete the extra one, or keep them all if they are all real.'}</span>
        <button className="btn" onClick={() => void keepAll()}>{items.length > 2 ? 'Keep all' : 'Keep both'}</button>
        <button className="btn btn-primary" onClick={onClose}>Done</button>
      </>}>
      {items.length < 2 ? (
        <p className="muted">{items.length ? 'Only one entry is left, so there is nothing to merge.' : 'These entries no longer exist.'}</p>
      ) : (
        <div className="dup-grid" style={{ ['--cols' as string]: Math.min(items.length, 4) }}>
          {items.map((t, k) => (
            <article key={t.id} className="dup-card" aria-label={`Entry ${k + 1} of ${items.length}`}>
              <div className="dup-top"><span className="small faint">Entry {k + 1}</span><b className="money dup-amt">{formatMoney(amountOf(t), t.currency)}</b></div>
              <dl className="dup-dl">
                <dt>Date</dt><dd>{formatDateCR(t.date)}</dd>
                <dt>Kind</dt><dd>{t.kind === 'savings' ? (t.direction === 'deposit' ? 'Savings · put in' : 'Savings · taken out') : KIND[t.kind]}</dd>
                {'from' in t && <><dt>From</dt><dd>{place(t.from)}</dd></>}
                {'to' in t && <><dt>{t.kind === 'income' ? 'Into' : 'To'}</dt><dd>{place(t.to)}{odd(t) && <div className="small" style={{ color: 'rgb(var(--amber))', fontWeight: 600 }}>Went somewhere different from the others</div>}</dd></>}
                {t.kind === 'adjustment' && <><dt>Account</dt><dd>{place(t.side)}</dd></>}
                {'categoryId' in t && t.categoryId && <><dt>Category</dt><dd>{l.category.get(t.categoryId)?.name ?? '—'}</dd></>}
                <dt>Description</dt><dd>{t.description || <span className="faint">none</span>}</dd>
                <dt>Logged</dt><dd>{stamp(t.createdAt)}<div className="small faint">{source(t)}</div></dd>
              </dl>
              <div className="dup-actions">
                <button className="btn btn-sm" onClick={() => qa.open(t)}>Edit</button>
                <button className="btn btn-sm dup-del" onClick={() => void remove(t)}>Delete this one</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </Sheet>
  );
}
