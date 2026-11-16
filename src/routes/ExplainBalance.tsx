/** "Where does this number come from?" for one account. */
import { Link } from 'react-router-dom';
import { useLedger } from '../app/data';
import { Pill } from '../design/components';
import { explainBalance } from '../domain/explain';
import type { Account } from '../domain/schemas';
import { formatMoney } from '../lib/money';
import { formatDateCR, todayISO } from '../lib/dates';

const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mlabel = (m: string) => `${MN[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;

export function ExplainBalance({ account }: { account: Account }) {
  const l = useLedger();
  const today = todayISO();
  const r = explainBalance(account, l.accounts, l.transactions, l.snapshots, today);
  const fmt = (v: number) => formatMoney(v, account.currency);
  const lastGap = [...r.months].reverse().find((m) => m.gap !== undefined);
  const where = (s?: { accountId: string; potId?: string }) => (s ? `${l.account.get(s.accountId)?.name ?? '?'}${s.potId ? ` · ${l.pot.get(s.potId)?.name ?? ''}` : ''}` : '');
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <p style={{ margin: 0 }}>The app doesn't read your bank. It adds up a <b>starting balance</b> and every movement you (or your workbook) logged into or out of this account.</p>
      <div className="explain-sum">
        <div><span className="small muted">Starting balance on {formatDateCR(r.opening.date)}</span><b className="money">{fmt(r.opening.amount)}</b></div>
        <div><span className="small muted">+ logged in since</span><b className="money" style={{ color: 'var(--income)' }}>{fmt(r.months.reduce((s, m) => s + m.in, 0))}</b></div>
        <div><span className="small muted">− logged out since</span><b className="money" style={{ color: 'var(--expense)' }}>{fmt(r.months.reduce((s, m) => s + m.out, 0))}</b></div>
        <div><span className="small muted">= balance in the app</span><b className="money">{fmt(r.total)}</b></div>
      </div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Month</th><th className="num">Logged in</th><th className="num">Logged out</th><th className="num">App at month end</th><th className="num">Bank statement</th><th className="num">Gap</th></tr></thead>
        <tbody>{r.months.map((m) => (
          <tr key={m.month}>
            <td>{mlabel(m.month)}</td>
            <td className="num">{m.in ? fmt(m.in) : '—'}</td>
            <td className="num">{m.out ? fmt(m.out) : '—'}</td>
            <td className="num">{fmt(m.appEnd)}</td>
            <td className="num">{m.statement ? fmt(m.statement.balance) : '—'}</td>
            <td className="num">{m.gap === undefined ? '—' : m.gap === 0 ? <Pill tone="income">✓</Pill> : <span style={{ color: 'var(--expense)', fontWeight: 650 }} title={m.bankChange !== undefined ? `The bank changed by ${fmt(m.bankChange)}; you logged ${fmt(m.loggedChange ?? 0)}.` : undefined}>{formatMoney(m.gap, account.currency, { signed: true })}</span>}</td>
          </tr>
        ))}</tbody>
      </table></div>
      {lastGap && lastGap.gap !== 0 && (
        <div className="hint-row" role="note" style={{ display: 'block' }}>
          {lastGap.gap! < 0
            ? <>By {formatDateCR(lastGap.statement!.date)} the app has <b>{fmt(-lastGap.gap!)} more</b> than the bank. Usually that's savings logged into this account that actually stayed in checking or went elsewhere (another account, cash, a payment), or a withdrawal that wasn't logged. Check the biggest movements below; edit their account in Transactions, or do a balance check-in to adjust.</>
            : <>By {formatDateCR(lastGap.statement!.date)} the bank has <b>{fmt(lastGap.gap!)} more</b> than the app: probably interest or deposits that weren't logged. A balance check-in can add the difference.</>}
        </div>
      )}
      {r.beforeOpening.count > 0 && <p className="small muted" style={{ margin: 0 }}>{r.beforeOpening.count} movement(s) dated before {formatDateCR(r.opening.date)} ({fmt(r.beforeOpening.net)}) count in your monthly reports but not in this balance, because the starting balance already includes them.</p>}
      <h3 className="card-h" style={{ margin: 0 }}>Biggest movements in this balance</h3>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
        {r.biggest.map(({ tx, signed }) => (
          <li key={tx.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span className="small muted" style={{ width: 84 }}>{formatDateCR(tx.date)}{tx.dateEstimated && <span title="The workbook row had no date; it was placed on the last day of its month"> ≈</span>}</span>
            <span style={{ flex: 1, minWidth: 200 }}>{tx.description || ('categoryId' in tx && tx.categoryId ? l.category.get(tx.categoryId)?.name : tx.kind)}<span className="small muted"> · {signed > 0 ? `from ${where('from' in tx ? tx.from : undefined) || 'income'}` : `to ${where('to' in tx ? tx.to : undefined) || 'spending'}`}</span></span>
            <b className="money" style={{ color: signed > 0 ? 'var(--income)' : 'var(--expense)' }}>{formatMoney(signed, account.currency, { signed: true })}</b>
          </li>
        ))}
      </ul>
      <p className="small muted" style={{ margin: 0 }}>≈ means the date was estimated (end of month). <Link to="/transactions">Open Transactions</Link> to change a movement's account or amount.</p>
    </div>
  );
}
