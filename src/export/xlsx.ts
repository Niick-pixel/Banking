/**
 * Excel export that mirrors the original workbook: Setup, Transactions in month
 * blocks with total rows, a Tracker with live SUMIFS formulas (cached results
 * included so it reads correctly before Excel recalculates), Net Worth, Debts,
 * plus an "All movements" sheet with every field.
 */
import type ExcelJSNS from 'exceljs';
import type { Account, Budget, Category, Debt, Pot, Transaction } from '../domain/schemas';
import { CATEGORY_GROUPS } from '../domain/schemas';
import { computeTracker } from '../domain/tracker';
import { debtStatus } from '../domain/ledger';
import type { BalanceSheet } from '../domain/networth';


export interface ExportInput {
  year: number;
  accounts: Account[]; pots: Pot[]; categories: Category[]; transactions: Transaction[];
  budgets: Budget[]; debts: Debt[]; netWorth: BalanceSheet[];
}

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const GROUP_LABEL: Record<Category['group'], string> = { Income: 'INCOME', Fixed: 'FIXED COSTS', Living: 'LIVING / VARIABLE', Discretionary: 'DISCRETIONARY', 'Debt Service': 'DEBT SERVICE', Savings: 'SAVINGS' };
const CRC_FMT = '"₡"#,##0.00;[Red]-"₡"#,##0.00';
const major = (minor: number) => minor / 100;
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const BLOCK_ROWS = 30; // empty slots per month, like the original

/** One workbook row per movement the original layout can express (transfers have no row there). */
export function workbookRows(t: Transaction): { type: 'Income' | 'Expense' | 'Savings'; categoryId: string; amount: number }[] {
  switch (t.kind) {
    case 'income': return [{ type: 'Income', categoryId: t.categoryId, amount: t.amount }];
    case 'expense':
      return t.splits?.length ? t.splits.map((s) => ({ type: 'Expense' as const, categoryId: s.categoryId, amount: s.amount })) : t.categoryId ? [{ type: 'Expense', categoryId: t.categoryId, amount: t.amount }] : [];
    case 'debt_payment': return [{ type: 'Expense', categoryId: t.categoryId, amount: t.amount }];
    case 'savings': return [{ type: 'Savings', categoryId: t.categoryId, amount: t.direction === 'deposit' ? t.amount : -t.amount }];
    default: return [];
  }
}

export async function buildWorkbook(inp: ExportInput): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default as typeof ExcelJSNS;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Aufwind';
  wb.created = new Date();
  const cats = new Map(inp.categories.map((c) => [c.id, c]));
  const accName = (id: string) => inp.accounts.find((a) => a.id === id)?.name ?? '?';
  const potName = (id?: string) => (id ? inp.pots.find((p) => p.id === id)?.name ?? '' : '');
  const ordered = CATEGORY_GROUPS.flatMap((g) => inp.categories.filter((c) => c.group === g && !c.archived));

  // ── Setup ────────────────────────────────────────────────────────────────
  const setup = wb.addWorksheet('Setup');
  setup.getCell('A1').value = 'SETUP — CATEGORIES & GROUPS (exported from Aufwind)';
  setup.getCell('A1').font = { bold: true, size: 14 };
  setup.getRow(3).values = ['CATEGORY', 'GROUP'];
  setup.getRow(3).font = { bold: true };
  ordered.forEach((c, i) => { setup.getRow(4 + i).values = [c.name, GROUP_LABEL[c.group]]; });
  setup.getColumn(1).width = 34; setup.getColumn(2).width = 20;

  // ── Transactions (month blocks) ──────────────────────────────────────────
  const tx = wb.addWorksheet('Transactions', { properties: { outlineLevelRow: 1 } });
  tx.getCell('A1').value = 'TRANSACTION LEDGER (exported from Aufwind)';
  tx.getCell('A1').font = { bold: true, size: 14 };
  tx.getRow(4).values = ['DATE (optional)', 'MONTH', 'TYPE', 'CATEGORY', 'DESCRIPTION', 'AMOUNT (₡)'];
  tx.getRow(4).font = { bold: true };
  [14, 8, 10, 32, 48, 16].forEach((w, i) => (tx.getColumn(i + 1).width = w));
  const yearTx = inp.transactions.filter((t) => t.date.startsWith(`${inp.year}-`) && t.currency === 'CRC').sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  let r = 5;
  const firstRow = r;
  for (let m = 1; m <= 12; m++) {
    const title = tx.getRow(r);
    title.getCell(1).value = `${MONTHS[m - 1]} ${inp.year}`;
    title.font = { bold: true }; tx.mergeCells(r, 1, r, 6);
    title.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF8' } };
    r++;
    const start = r;
    const rows = yearTx.filter((t) => Number(t.date.slice(5, 7)) === m).flatMap((t) => workbookRows(t).map((w) => ({ t, w })));
    for (const { t, w } of rows) {
      const row = tx.getRow(r++);
      row.values = [t.dateEstimated ? null : toDate(t.date), m, w.type, cats.get(w.categoryId)?.name ?? '', t.description, major(w.amount)];
      row.getCell(1).numFmt = 'dd/mm/yyyy';
      row.getCell(6).numFmt = CRC_FMT;
      row.outlineLevel = 1;
    }
    const pad = Math.max(0, BLOCK_ROWS - rows.length);
    for (let i = 0; i < pad; i++) { const row = tx.getRow(r++); row.getCell(2).value = m; row.outlineLevel = 1; }
    const end = r - 1;
    const total = tx.getRow(r++);
    total.getCell(1).value = `${MONTHS[m - 1]![0]}${MONTHS[m - 1]!.slice(1).toLowerCase()} total`;
    total.getCell(6).value = { formula: `SUM(F${start}:F${end})`, result: rows.reduce((s, x) => s + major(x.w.amount), 0) };
    total.getCell(6).numFmt = CRC_FMT; total.font = { bold: true };
  }
  const lastRow = r - 1;

  // ── Tracker (live formulas over Transactions) ────────────────────────────
  const t = computeTracker(inp.year, inp.transactions.filter((x) => x.currency === 'CRC'), inp.categories, inp.budgets, { accountType: (id) => inp.accounts.find((a) => a.id === id)?.type });
  const tr = wb.addWorksheet(`${inp.year} Tracker`, { views: [{ state: 'frozen', xSplit: 2, ySplit: 3 }] });
  tr.getCell('A1').value = `${inp.year} PERSONAL FINANCES (exported from Aufwind)`;
  tr.getCell('A1').font = { bold: true, size: 14 };
  tr.getColumn(1).width = 34; tr.getColumn(2).width = 16;
  for (let c = 3; c <= 16; c++) tr.getColumn(c).width = 14;
  const rng = (col: string) => `Transactions!$${col}$${firstRow}:$${col}$${lastRow}`;
  const colL = (i: number) => String.fromCharCode(64 + i); // 1 → A
  let tRow = 3;
  const totalsRows: Record<string, number[]> = {};
  for (const s of t.sections) {
    const head = tr.getRow(tRow++);
    head.values = [GROUP_LABEL[s.group], 'MONTHLY BUDGET', ...MONTHS, 'YTD TOTAL', 'AVG / MONTH'];
    head.font = { bold: true };
    const startRow = tRow;
    for (const row of s.rows) {
      const x = tr.getRow(tRow);
      x.getCell(1).value = row.category.name;
      x.getCell(2).value = row.budget ? major(row.budget) : 0;
      for (let m = 0; m < 12; m++) {
        const typeCrit = s.group === 'Income' ? `,${rng('C')},"Income"` : s.group === 'Savings' ? '' : `,${rng('C')},"Expense"`;
        x.getCell(3 + m).value = { formula: `SUMIFS(${rng('F')},${rng('D')},$A${tRow}${typeCrit},${rng('B')},${m + 1})`, result: major(row.months[m]!) };
      }
      x.getCell(15).value = { formula: `SUM(C${tRow}:N${tRow})`, result: major(row.ytd) };
      x.getCell(16).value = { formula: `O${tRow}/${t.monthsWithData}`, result: major(row.ytd) / t.monthsWithData };
      tRow++;
    }
    const sub = tr.getRow(tRow);
    sub.getCell(1).value = `   TOTAL ${GROUP_LABEL[s.group]}`;
    for (let c = 2; c <= 16; c++) {
      const L = colL(c);
      const vals = c === 2 ? major(s.subtotal.budget) : c <= 14 ? major(s.subtotal.months[c - 3]!) : c === 15 ? major(s.subtotal.ytd) : major(s.subtotal.ytd) / t.monthsWithData;
      sub.getCell(c).value = { formula: s.rows.length ? `SUM(${L}${startRow}:${L}${tRow - 1})` : '0', result: vals };
    }
    sub.font = { bold: true };
    totalsRows[s.group] = [tRow];
    tRow += 2;
  }
  const sumOf = (groups: Category['group'][], c: number) => groups.map((g) => `${colL(c)}${totalsRows[g]![0]}`).join('+');
  const bottom: [string, Category['group'][] | null, (m: number) => number][] = [
    ['TOTAL INCOME', ['Income'], (m) => t.income[m]!],
    ['TOTAL EXPENSES', ['Fixed', 'Living', 'Discretionary', 'Debt Service'], (m) => t.expenses[m]!],
    ['TOTAL SAVED', ['Savings'], (m) => t.saved[m]!],
  ];
  const bottomRows: Record<string, number> = {};
  for (const [label, groups, val] of bottom) {
    const x = tr.getRow(tRow); bottomRows[label] = tRow;
    x.getCell(1).value = label; x.font = { bold: true };
    for (let m = 0; m < 12; m++) x.getCell(3 + m).value = { formula: sumOf(groups!, 3 + m), result: major(val(m)) };
    x.getCell(15).value = { formula: `SUM(C${tRow}:N${tRow})`, result: major(Array.from({ length: 12 }, (_, m) => val(m)).reduce((a, b) => a + b, 0)) };
    tRow++;
  }
  const net = tr.getRow(tRow++); net.getCell(1).value = 'NET INCOME (income − expenses)'; net.font = { bold: true };
  const free = tr.getRow(tRow++); free.getCell(1).value = 'LEFT AFTER SAVING (free cash)'; free.font = { bold: true };
  for (let c = 3; c <= 15; c++) {
    const L = colL(c);
    const m = c - 3;
    net.getCell(c).value = { formula: `${L}${bottomRows['TOTAL INCOME']}-${L}${bottomRows['TOTAL EXPENSES']}`, result: major(c === 15 ? t.ytd.net : t.net[m]!) };
    free.getCell(c).value = { formula: `${L}${net.number}-${L}${bottomRows['TOTAL SAVED']}`, result: major(c === 15 ? t.ytd.freeCash : t.freeCash[m]!) };
  }
  tr.eachRow((row) => row.eachCell((cell, c) => { if (c >= 2) cell.numFmt = CRC_FMT; }));

  // ── Net Worth ────────────────────────────────────────────────────────────
  const nw = wb.addWorksheet('Net Worth');
  nw.getCell('A1').value = 'NET WORTH — MONTH-END BALANCES (exported from Aufwind; S = statement, otherwise ledger)';
  nw.getCell('A1').font = { bold: true, size: 14 };
  nw.getRow(4).values = ['ACCOUNT', ...MONTHS];
  nw.getRow(4).font = { bold: true };
  nw.getColumn(1).width = 40;
  let nr = 5;
  const assetAccounts = inp.accounts.filter((a) => a.type !== 'credit_card');
  for (const a of assetAccounts) {
    const row = nw.getRow(nr++);
    row.getCell(1).value = a.name;
    for (const s of inp.netWorth.filter((x) => x.month.startsWith(`${inp.year}-`))) {
      const v = s.accounts.find((x) => x.accountId === a.id);
      if (v) { const c = row.getCell(1 + Number(s.month.slice(5, 7))); c.value = major(v.balance); c.numFmt = CRC_FMT; if (v.source === 'statement') c.note = 'From statement'; }
    }
  }
  const ta = nw.getRow(nr++); ta.getCell(1).value = 'TOTAL ASSETS'; ta.font = { bold: true };
  nr++;
  nw.getRow(nr++).getCell(1).value = 'LIABILITIES';
  const tl = nw.getRow(nr++); tl.getCell(1).value = 'Total liabilities';
  const nwr = nw.getRow(nr++); nwr.getCell(1).value = 'NET WORTH'; nwr.font = { bold: true };
  for (const s of inp.netWorth.filter((x) => x.month.startsWith(`${inp.year}-`))) {
    const c = 1 + Number(s.month.slice(5, 7));
    ta.getCell(c).value = major(s.assets); tl.getCell(c).value = major(s.liabilities); nwr.getCell(c).value = major(s.netWorth);
    [ta, tl, nwr].forEach((row) => (row.getCell(c).numFmt = CRC_FMT));
  }

  // ── Debts ────────────────────────────────────────────────────────────────
  const ds = wb.addWorksheet('Debts');
  ds.getCell('A1').value = 'DEBTS (exported from Aufwind)';
  ds.getCell('A1').font = { bold: true, size: 14 };
  ds.getRow(4).values = ['DEBT / CREDITOR', 'CCY', 'ORIGINAL', 'BALANCE NOW', 'ANNUAL RATE', 'MONTHLY PAYMENT', 'NOTES'];
  ds.getRow(4).font = { bold: true };
  ds.getColumn(1).width = 40;
  let dr = 5;
  for (const d of inp.debts) {
    const st = debtStatus(d, inp.transactions);
    const row = ds.getRow(dr++);
    row.values = [d.creditor, d.currency, major(d.originalAmount), major(st.balance), d.annualRateBps / 10_000, d.plannedMonthlyPayment ? major(d.plannedMonthlyPayment) : null, d.notes];
    [3, 4, 6].forEach((c) => (row.getCell(c).numFmt = CRC_FMT));
    row.getCell(5).numFmt = '0.00%';
  }
  ds.getRow(dr).getCell(1).value = 'TOTAL';

  // ── All movements (every field, every kind) ──────────────────────────────
  const all = wb.addWorksheet('All movements', { views: [{ state: 'frozen', ySplit: 1 }] });
  all.columns = [
    { header: 'Date', key: 'date', width: 12 }, { header: 'Date estimated', key: 'est', width: 9 }, { header: 'Kind', key: 'kind', width: 13 },
    { header: 'From / account', key: 'from', width: 30 }, { header: 'To', key: 'to', width: 30 }, { header: 'Category', key: 'cat', width: 28 },
    { header: 'Description', key: 'desc', width: 40 }, { header: 'Amount', key: 'amt', width: 14 }, { header: 'Currency', key: 'cur', width: 8 },
    { header: 'Tags', key: 'tags', width: 16 }, { header: 'Notes', key: 'notes', width: 30 },
  ];
  all.getRow(1).font = { bold: true };
  const place = (s: { accountId: string; potId?: string }) => `${accName(s.accountId)}${s.potId ? ` · ${potName(s.potId)}` : ''}`;
  for (const x of [...inp.transactions].sort((a, b) => a.date.localeCompare(b.date))) {
    const amount = x.kind === 'adjustment' ? x.signedAmount : x.amount;
    all.addRow({
      date: toDate(x.date), est: x.dateEstimated ? 'yes' : '', kind: x.kind === 'savings' ? `savings ${x.direction}` : x.kind,
      from: 'from' in x ? place(x.from) : x.kind === 'income' ? place(x.to) : x.kind === 'adjustment' ? place(x.side) : '',
      to: x.kind === 'transfer' || x.kind === 'savings' ? place(x.to) : '',
      cat: 'categoryId' in x && x.categoryId ? cats.get(x.categoryId)?.name ?? '' : '', desc: x.description, amt: major(amount), cur: x.currency,
      tags: x.tags.join(', '), notes: x.notes,
    });
  }
  all.getColumn('date').numFmt = 'dd/mm/yyyy';
  all.getColumn('amt').numFmt = '#,##0.00';

  wb.worksheets.forEach((ws) => (ws.properties.defaultRowHeight = 18));
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
