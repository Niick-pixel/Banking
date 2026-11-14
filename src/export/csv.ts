/** RFC 4180 CSV of transactions. UTF-8 BOM + CRLF so Excel opens accents and ₡ correctly. */
import type { Account, Category, Pot, Transaction } from '../domain/schemas';

const q = (v: string | number) => { const s = String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function transactionsCsv(txs: Transaction[], accounts: Account[], pots: Pot[], categories: Category[]): string {
  const acc = new Map(accounts.map((a) => [a.id, a.name]));
  const pot = new Map(pots.map((p) => [p.id, p.name]));
  const cat = new Map(categories.map((c) => [c.id, c]));
  const place = (s?: { accountId: string; potId?: string }) => (s ? `${acc.get(s.accountId) ?? ''}${s.potId ? ` · ${pot.get(s.potId) ?? ''}` : ''}` : '');
  const header = ['date', 'date_estimated', 'kind', 'from', 'to', 'category', 'group', 'description', 'amount', 'currency', 'tags', 'notes', 'id'];
  const rows = [...txs].sort((a, b) => a.date.localeCompare(b.date)).map((t) => {
    const c = 'categoryId' in t && t.categoryId ? cat.get(t.categoryId) : undefined;
    const amount = t.kind === 'adjustment' ? t.signedAmount : t.amount;
    return [
      t.date, t.dateEstimated ? 'yes' : '', t.kind === 'savings' ? `savings_${t.direction}` : t.kind,
      'from' in t ? place(t.from) : t.kind === 'adjustment' ? place(t.side) : '', 'to' in t ? place(t.to) : '',
      c?.name ?? '', c?.group ?? '', t.description, (amount / 100).toFixed(2), t.currency, t.tags.join(' '), t.notes, t.id,
    ].map(q).join(',');
  });
  return '﻿' + [header.join(','), ...rows].join('\r\n') + '\r\n';
}
