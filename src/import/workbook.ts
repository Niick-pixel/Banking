/**
 * Importer for the hand-built Financial_Tracker.xlsx.
 * Parses by header labels and section titles, never by fixed cell coordinates.
 * Pure: Grid in → ImportPlan out. Nothing touches the database here.
 */
import type {
  Account, BalanceSnapshot, Budget, Category, Debt, Pot, SelfLoan, Transaction,
} from '../domain/schemas';
import { CATEGORY_GROUPS, TransactionSchema } from '../domain/schemas';
import { isISODate, lastDayOfMonth, toISO, type ISODate, type MonthKey } from '../lib/dates';
import { monthlyFlows } from '../domain/ledger';
import type { CellValue, Grid, Sheet } from './grid';

export type Level = 'error' | 'warning' | 'info';
export interface Issue { level: Level; sheet: string; row?: number; message: string }

export interface CategoryMapping { source: string; categoryId: string; group: Category['group']; isNew: boolean; rows: number }

export interface ReconRow {
  month: MonthKey;
  tracker: { income: number; expenses: number; saved: number };
  imported: { income: number; expenses: number; saved: number };
}

export interface ImportPlan {
  fileName: string;
  detected: { sheet: string; role: string; detail: string }[];
  accounts: Account[];
  pots: Pot[];
  categories: Category[];           // new categories only
  categoryMap: CategoryMapping[];
  budgets: Budget[];
  debts: Debt[];
  selfLoans: SelfLoan[];
  snapshots: BalanceSnapshot[];
  transactions: Transaction[];
  issues: Issue[];
  reconciliation: ReconRow[];
  defaults: { spendingAccountId: string; savingsAccountId?: string };
}

export interface ParseOptions {
  fileName: string;
  today: ISODate;
  now: number;
  newId: () => string;
  existingCategories?: Category[];
  existingAccounts?: Account[];
}

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const norm = (v: CellValue | undefined) => (v === null || v === undefined ? '' : String(v).trim().replace(/\s+/g, ' '));
const up = (v: CellValue | undefined) => norm(v).toUpperCase();
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g, ' ').trim();
/** Excel floats → integer céntimos (11687263.440000001 → 1168726344). */
export const toCentimos = (n: number) => Math.round(n * 100);
const isNum = (v: CellValue | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

function findSheet(grid: Grid, re: RegExp): Sheet | undefined {
  return grid.sheets.find((s) => re.test(s.name));
}

/** First row containing every label (case-insensitive, prefix match). Returns row index and label → column. */
function findHeader(sheet: Sheet, labels: string[], maxRow = 40): { row: number; cols: Record<string, number> } | null {
  for (let r = 0; r < Math.min(sheet.rows.length, maxRow); r++) {
    const row = sheet.rows[r]!;
    const cols: Record<string, number> = {};
    for (const label of labels) {
      const c = row.findIndex((v) => up(v).startsWith(label.toUpperCase()));
      if (c >= 0) cols[label] = c;
    }
    if (Object.keys(cols).length === labels.length) return { row: r, cols };
  }
  return null;
}

const GROUP_ALIASES: Record<string, Category['group']> = {
  INCOME: 'Income', 'FIXED COSTS': 'Fixed', FIXED: 'Fixed', 'LIVING / VARIABLE': 'Living', LIVING: 'Living',
  DISCRETIONARY: 'Discretionary', 'DEBT SERVICE': 'Debt Service', SAVINGS: 'Savings',
};

function dateToISO(d: Date): ISODate {
  // Excel dates are stored as UTC midnight by exceljs.
  return toISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function inferAccountType(label: string): { type: Account['type']; isLiquid: boolean } {
  const l = label.toLowerCase();
  if (/cesant/.test(l)) return { type: 'association_cesantia', isLiquid: false };
  if (/associat|asociaci/.test(l)) return { type: 'association_voluntary', isLiquid: true };
  if (/checking|corriente|colones \(/.test(l)) return { type: 'checking', isLiquid: true };
  if (/objetivo|goal/.test(l)) return { type: 'goal_savings', isLiquid: true };
  if (/saving|ahorro/.test(l)) return { type: 'savings', isLiquid: true };
  if (/cash|efectivo/.test(l)) return { type: 'cash', isLiquid: true };
  if (/invest|trading|inversi/.test(l)) return { type: 'investment', isLiquid: false };
  if (/credit|tarjeta/.test(l)) return { type: 'credit_card', isLiquid: false };
  return { type: 'checking', isLiquid: true };
}

export function parseWorkbook(grid: Grid, opts: ParseOptions): ImportPlan {
  const { now, newId, today } = opts;
  const issues: Issue[] = [];
  const detected: ImportPlan['detected'] = [];
  const stamp = { createdAt: now, updatedAt: now };

  // ── Year: from sheet names / titles like "2026 Tracker", "OCTOBER 2026" ──
  const yearFromName = grid.sheets.map((s) => /(20\d\d)/.exec(s.name)?.[1]).find(Boolean);
  const defaultYear = Number(yearFromName ?? today.slice(0, 4));

  // ── Categories (Setup sheet: CATEGORY | GROUP) ───────────────────────────
  const existing = new Map((opts.existingCategories ?? []).map((c) => [key(c.name), c]));
  const categories: Category[] = [];
  const catByName = new Map<string, Category>();
  const addCategory = (name: string, group: Category['group'], order: number) => {
    const k = key(name);
    if (catByName.has(k)) return catByName.get(k)!;
    const found = existing.get(k);
    const cat: Category = found ?? {
      id: newId(), name, group, discretionary: group === 'Discretionary', sortOrder: order, archived: false, ...stamp,
    };
    if (!found) categories.push(cat);
    catByName.set(k, cat);
    return cat;
  };
  const setup = findSheet(grid, /setup/i);
  if (setup) {
    const h = findHeader(setup, ['CATEGORY', 'GROUP']);
    if (h) {
      let n = 0;
      for (let r = h.row + 1; r < setup.rows.length; r++) {
        const name = norm(setup.rows[r]![h.cols.CATEGORY!]!);
        const g = GROUP_ALIASES[up(setup.rows[r]![h.cols.GROUP!]!)];
        if (!name) break;
        if (!g) { issues.push({ level: 'warning', sheet: setup.name, row: r + 1, message: `Unknown group for "${name}" — set to Living` }); }
        addCategory(name, g ?? 'Living', n++);
      }
      detected.push({ sheet: setup.name, role: 'Categories', detail: `${n} categories with groups` });
    }
  }

  // ── Accounts + balance snapshots (Net Worth sheet) ───────────────────────
  const accounts: Account[] = [];
  const snapshots: BalanceSnapshot[] = [];
  const existingAcc = new Map((opts.existingAccounts ?? []).map((a) => [key(a.name), a]));
  const nw = findSheet(grid, /net ?worth/i);
  const snapshotSeries = new Map<string, number[]>();
  if (nw) {
    const h = findHeader(nw, ['ACCOUNT', 'JANUARY']);
    if (h) {
      const monthCols = MONTHS.map((m) => nw.rows[h.row]!.findIndex((v) => up(v) === m));
      let count = 0;
      for (let r = h.row + 1; r < nw.rows.length; r++) {
        const label = norm(nw.rows[r]![h.cols.ACCOUNT!]!);
        if (!label || /^TOTAL/i.test(label)) break; // assets block ends at TOTAL ASSETS; liabilities are derived
        const { type, isLiquid } = inferAccountType(label);
        const series: number[] = [];
        const points: { date: ISODate; bal: number }[] = [];
        monthCols.forEach((c, i) => {
          const v = c >= 0 ? nw.rows[r]![c] ?? null : null;
          if (isNum(v)) { points.push({ date: lastDayOfMonth(defaultYear, i + 1), bal: toCentimos(v) }); series.push(toCentimos(v)); }
        });
        const acc: Account = existingAcc.get(key(label)) ?? {
          id: newId(), name: label, institution: /bac/i.test(label) ? 'BAC Credomatic' : /associat|asociaci/i.test(label) ? 'Asociación Solidarista' : '',
          type, currency: 'CRC', isLiquid, archived: false, ...stamp,
          // Opening = first statement figure, effective the day after that month end.
          openingBalance: points[0]?.bal ?? 0,
          openingDate: points[0] ? nextDay(points[0].date) : `${defaultYear}-01-01`,
        };
        accounts.push(acc);
        for (const p of points) {
          snapshots.push({ id: newId(), accountId: acc.id, date: p.date, balance: p.bal, source: 'import', ...stamp });
        }
        if (series.length) snapshotSeries.set(acc.name, series);
        count++;
      }
      detected.push({ sheet: nw.name, role: 'Accounts & balance snapshots', detail: `${count} accounts, ${snapshots.length} month-end balances (liability rows skipped: they're derived)` });
      // Copy-paste detector: two accounts with identical non-empty series.
      const seen = new Map<string, string>();
      for (const [name, s] of snapshotSeries) {
        const sig = s.join(',');
        if (s.length > 1 && seen.has(sig)) issues.push({ level: 'warning', sheet: nw.name, message: `"${name}" has exactly the same balances as "${seen.get(sig)}" every month — probably a copied row. Check your statement.` });
        else seen.set(sig, name);
      }
    }
  }
  const findAcc = (t: Account['type'][]) => accounts.find((a) => t.includes(a.type));
  let spending = findAcc(['checking']);
  if (!spending) {
    spending = { id: newId(), name: 'Checking', institution: '', type: 'checking', currency: 'CRC', openingBalance: 0, openingDate: `${defaultYear}-01-01`, isLiquid: true, archived: false, ...stamp };
    accounts.unshift(spending);
  }
  const savingsAcc = findAcc(['goal_savings', 'savings']);

  // ── Transactions sheet ────────────────────────────────────────────────────
  const ledger = findSheet(grid, /^transactions?$/i) ?? findSheet(grid, /transact|ledger/i);
  const pots: Pot[] = [];
  const potFor = (owner: Pot['owner'], name: string, purpose: string) => {
    if (!savingsAcc) return undefined;
    let p = pots.find((x) => x.name === name);
    if (!p) { p = { id: newId(), accountId: savingsAcc.id, name, owner, purpose, archived: false, ...stamp }; pots.push(p); }
    return p.id;
  };
  const debts: Debt[] = [];
  const selfLoans: SelfLoan[] = [];
  const budgets: Budget[] = [];

  // Debts first so loan repayments can link to them.
  const debtSheet = findSheet(grid, /debt/i);
  if (debtSheet) {
    const h = findHeader(debtSheet, ['DEBT', 'ORIGINAL', 'ANNUAL RATE']);
    if (h) {
      const balCol = debtSheet.rows[h.row]!.findIndex((v) => up(v) === 'BALANCE NOW');
      const payCol = debtSheet.rows[h.row]!.findIndex((v) => up(v) === 'MONTHLY PAYMENT');
      const notesCol = debtSheet.rows[h.row]!.findIndex((v) => up(v) === 'NOTES');
      for (let r = h.row + 1; r < debtSheet.rows.length; r++) {
        const row = debtSheet.rows[r]!;
        const name = norm(row[h.cols.DEBT!]!);
        if (/^TOTAL/i.test(name)) break;
        const orig = row[h.cols.ORIGINAL!];
        if (!name || !isNum(orig) || orig <= 0) continue;
        const rate = row[h.cols['ANNUAL RATE']!];
        const bal = balCol >= 0 ? row[balCol] : null;
        const pay = payCol >= 0 ? row[payCol] : null;
        debts.push({
          id: newId(), creditor: name, kind: /bank|banco/i.test(name) ? 'bank' : /card|tarjeta/i.test(name) ? 'credit_card' : 'family',
          currency: 'CRC', originalAmount: toCentimos(orig), annualRateBps: isNum(rate) ? Math.round(rate * 10_000) : 0,
          startDate: `${defaultYear}-01-01`, plannedMonthlyPayment: isNum(pay) && pay > 0 ? toCentimos(pay) : undefined,
          status: 'active', checklist: {}, notes: notesCol >= 0 ? norm(row[notesCol]!) : '',
          confirmedBalance: isNum(bal) ? { date: today, amount: toCentimos(bal) } : undefined, adjustments: [], ...stamp,
        });
      }
      detected.push({ sheet: debtSheet.name, role: 'Debts', detail: `${debts.length} debt(s)` });
      // Self-loans block: rows under "SAVINGS TO REPLENISH" with a label and an amount.
      const start = debtSheet.rows.findIndex((row) => /SAVINGS TO REPLENISH/i.test(norm(row[0] ?? null)));
      if (start >= 0) {
        for (let r = start + 1; r < debtSheet.rows.length; r++) {
          const row = debtSheet.rows[r]!;
          const label = norm(row[0] ?? null);
          if (/^TOTAL TAKEN|^STILL|^PUT BACK|^PLANNED/i.test(label)) break;
          const amt = row.slice(1).find(isNum);
          if (label && amt && amt > 0) {
            selfLoans.push({ id: newId(), description: label, currency: 'CRC', amount: toCentimos(amt), plannedSource: '', status: 'open', notes: '', ...stamp });
          }
        }
        const plannedRow = debtSheet.rows.find((row) => /^Planned source/i.test(norm(row[0] ?? null)));
        const planned = plannedRow?.slice(1).map(norm).find(Boolean) ?? '';
        selfLoans.forEach((s) => (s.plannedSource = planned));
        if (!selfLoans.length && planned) issues.push({ level: 'info', sheet: debtSheet.name, message: `Self-loan block is empty (planned source "${planned}"). Add self-loans in the app if you have any.` });
      }
    }
  }

  const transactions: Transaction[] = [];
  const mapping = new Map<string, CategoryMapping>();
  if (!ledger) {
    issues.push({ level: 'error', sheet: '—', message: 'No Transactions sheet found' });
  } else {
    const h = findHeader(ledger, ['DATE', 'MONTH', 'TYPE', 'CATEGORY', 'DESCRIPTION', 'AMOUNT']);
    if (!h) {
      issues.push({ level: 'error', sheet: ledger.name, message: 'Header row (DATE | MONTH | TYPE | CATEGORY | DESCRIPTION | AMOUNT) not found' });
    } else {
      const C = h.cols as Record<'DATE' | 'MONTH' | 'TYPE' | 'CATEGORY' | 'DESCRIPTION' | 'AMOUNT', number>;
      let blockYear = defaultYear, blockMonth = 0;
      let lastDesc = '';
      let blocks = 0, skippedEmpty = 0;
      for (let r = h.row + 1; r < ledger.rows.length; r++) {
        const row = ledger.rows[r]!;
        const first = up(row[0] ?? null);
        const title = /^([A-Z]+) (\d{4})$/.exec(first);
        if (title && MONTHS.includes(title[1]!)) { blockMonth = MONTHS.indexOf(title[1]!) + 1; blockYear = Number(title[2]); blocks++; lastDesc = ''; continue; }
        if (/ TOTAL$/.test(first)) continue;
        const amountRaw = row[C.AMOUNT] ?? null;
        const type = norm(row[C.TYPE] ?? null);
        const catName = norm(row[C.CATEGORY] ?? null);
        const monthCell = row[C.MONTH] ?? null;
        const hasContent = type || catName || norm(row[C.DESCRIPTION] ?? null);
        if (!isNum(amountRaw) || amountRaw === 0) {
          if (hasContent) issues.push({ level: 'info', sheet: ledger.name, row: r + 1, message: `Skipped: ${catName || type} "${norm(row[C.DESCRIPTION] ?? null)}" has no amount` });
          else skippedEmpty++;
          continue;
        }
        const month = isNum(monthCell) ? monthCell : blockMonth;
        if (!month) { issues.push({ level: 'error', sheet: ledger.name, row: r + 1, message: 'Amount with no month' }); continue; }
        if (!catName) { issues.push({ level: 'error', sheet: ledger.name, row: r + 1, message: 'Amount with no category' }); continue; }
        if (!type) { issues.push({ level: 'error', sheet: ledger.name, row: r + 1, message: 'Amount with no TYPE — the Tracker never counted this row' }); continue; }

        const cat = catByName.get(key(catName)) ?? addCategory(catName, type === 'Income' ? 'Income' : type === 'Savings' ? 'Savings' : 'Living', 999);
        const m = mapping.get(catName) ?? { source: catName, categoryId: cat.id, group: cat.group, isNew: !existing.has(key(catName)), rows: 0 };
        m.rows++; mapping.set(catName, m);

        // Date: real date if present, otherwise last day of the month, flagged as estimated.
        const dateCell = row[C.DATE] ?? null;
        let date: ISODate; let dateEstimated = false;
        if (dateCell instanceof Date) date = dateToISO(dateCell);
        else if (typeof dateCell === 'string' && isISODate(dateCell)) date = dateCell;
        else { date = lastDayOfMonth(blockYear, month); dateEstimated = true; }
        if (Number(date.slice(5, 7)) !== month) {
          issues.push({ level: 'warning', sheet: ledger.name, row: r + 1, message: `DATE ${date} is outside MONTH ${month}; using the MONTH (that's what the Tracker counts)` });
          date = lastDayOfMonth(blockYear, month); dateEstimated = true;
        }

        let desc = norm(row[C.DESCRIPTION] ?? null);
        let notes = '';
        if (/^\^+$/.test(desc)) { notes = `Description was "${desc}" (same as above)`; desc = lastDesc; }
        else if (desc) lastDesc = desc;
        const tags = /migrated/i.test(desc) ? ['migrated-summary'] : [];
        const amount = toCentimos(Math.abs(amountRaw));
        const negative = amountRaw < 0;
        // createdAt carries the workbook row order so same-day movements keep their original sequence.
        const base = { id: newId(), date, dateEstimated, currency: 'CRC' as const, description: desc, tags, notes, createdAt: now + r, updatedAt: now };
        const spendFrom = { accountId: spending.id };

        let tx: Transaction | null = null;
        if (cat.group === 'Savings') {
          if (type !== 'Savings') issues.push({ level: 'warning', sheet: ledger.name, row: r + 1, message: `TYPE is "${type}" but the category "${catName}" is a Savings category. Imported as a savings ${negative ? 'withdrawal' : 'deposit'} (that's how your Tracker counted it).` });
          const owner: Pot['owner'] = /hers|her |loan fund/i.test(catName) ? 'hers' : 'mine';
          const potId = owner === 'hers' ? potFor('hers', 'Hers (loan fund)', 'Money set aside to pay back her loan') : potFor('mine', 'Mine', 'My own savings');
          const place = { accountId: savingsAcc?.id ?? spending.id, potId };
          if (!savingsAcc) issues.push({ level: 'warning', sheet: ledger.name, row: r + 1, message: 'No savings account found in Net Worth; savings kept in checking under a pot' });
          tx = negative
            ? { ...base, kind: 'savings', direction: 'withdrawal', from: place, to: spendFrom, amount, categoryId: cat.id }
            : { ...base, kind: 'savings', direction: 'deposit', from: spendFrom, to: place, amount, categoryId: cat.id };
        } else if (cat.group === 'Income') {
          if (type !== 'Income') issues.push({ level: 'warning', sheet: ledger.name, row: r + 1, message: `TYPE "${type}" on income category "${catName}": your Tracker did NOT count this row. Imported as income.` });
          tx = negative
            ? { ...base, kind: 'expense', from: spendFrom, amount, categoryId: cat.id, notes: [notes, 'Negative income in workbook'].filter(Boolean).join(' · ') }
            : { ...base, kind: 'income', to: spendFrom, amount, categoryId: cat.id };
        } else {
          if (type !== 'Expense') issues.push({ level: 'warning', sheet: ledger.name, row: r + 1, message: `TYPE "${type}" on expense category "${catName}": your Tracker did NOT count this row. Imported as an expense.` });
          if (negative) issues.push({ level: 'warning', sheet: ledger.name, row: r + 1, message: `Negative expense (refund?) on "${catName}" imported as income.` });
          const debt = cat.group === 'Debt Service' ? matchDebt(catName, debts) : undefined;
          if (negative) tx = { ...base, kind: 'income', to: spendFrom, amount, categoryId: cat.id };
          else if (debt) tx = { ...base, kind: 'debt_payment', from: spendFrom, amount, debtId: debt.id, categoryId: cat.id, interestPortion: 0 };
          else tx = { ...base, kind: 'expense', from: spendFrom, amount, categoryId: cat.id };
        }
        const parsed = TransactionSchema.safeParse(tx);
        if (!parsed.success) { issues.push({ level: 'error', sheet: ledger.name, row: r + 1, message: parsed.error.issues.map((i) => i.message).join('; ') }); continue; }
        transactions.push(parsed.data);
      }
      const est = transactions.filter((t) => t.dateEstimated).length;
      detected.push({ sheet: ledger.name, role: 'Transactions', detail: `${blocks} month blocks, ${transactions.length} movements (${est} without a date → last day of month), ${skippedEmpty} empty slots skipped` });
      if (est) issues.push({ level: 'info', sheet: ledger.name, message: `${est} rows had no DATE and were placed on the last day of their month (marked "date estimated").` });
      // In-file possible duplicates: same month + category + amount.
      const dupKey = new Map<string, number>();
      for (const t of transactions) {
        const cid = 'categoryId' in t ? t.categoryId : '';
        const k = `${t.date.slice(0, 7)}|${cid}|${'amount' in t ? t.amount : 0}`;
        dupKey.set(k, (dupKey.get(k) ?? 0) + 1);
      }
      for (const [k, n] of dupKey) if (n > 1) {
        const [m, cid, amt] = k.split('|');
        const cname = [...catByName.values()].find((c) => c.id === cid)?.name;
        issues.push({ level: 'info', sheet: ledger.name, message: `Possible duplicate: ${n}× ${cname} ₡${(Number(amt) / 100).toLocaleString('en')} in ${m}. Kept all — check if intended.` });
      }
    }
  }

  // A single "hers" pot + a single family debt → that pot is the loan fund for it.
  const hersPots = pots.filter((p) => p.owner === 'hers');
  const familyDebts = debts.filter((d) => d.kind === 'family');
  if (hersPots.length === 1 && familyDebts.length === 1) familyDebts[0]!.fundPotId = hersPots[0]!.id;

  // ── Budgets + reconciliation targets (Tracker sheet) ─────────────────────
  const reconciliation: ReconRow[] = [];
  const tracker = findSheet(grid, /tracker/i);
  if (tracker) {
    const h = findHeader(tracker, ['MONTHLY BUDGET', 'JANUARY']);
    if (h) {
      const budgetCol = h.cols['MONTHLY BUDGET']!;
      const monthCols = MONTHS.map((m) => tracker.rows[h.row]!.findIndex((v) => up(v) === m));
      const totals: Record<'income' | 'expenses' | 'saved', number[]> = { income: [], expenses: [], saved: [] };
      for (const row of tracker.rows) {
        const label = norm(row[0] ?? null);
        const cat = catByName.get(key(label));
        const b = row[budgetCol];
        if (cat && isNum(b) && b > 0) budgets.push({ id: newId(), categoryId: cat.id, month: '*', amount: toCentimos(b), currency: 'CRC', rollover: false, ...stamp });
        const which = /^TOTAL INCOME/i.test(label) ? 'income' : /^TOTAL EXPENSES/i.test(label) ? 'expenses' : /^TOTAL SAVED/i.test(label) ? 'saved' : null;
        if (which) totals[which] = monthCols.map((c) => (c >= 0 && isNum(row[c] ?? null) ? toCentimos(row[c] as number) : 0));
      }
      detected.push({ sheet: tracker.name, role: 'Budgets + totals to verify against', detail: `${budgets.length} monthly budgets; monthly values are formulas, used only for reconciliation` });
      const accType = new Map(accounts.map((a) => [a.id, a.type]));
      const flows = monthlyFlows(transactions, { accountType: (id) => accType.get(id) });
      for (let i = 0; i < 12; i++) {
        const mk = `${defaultYear}-${String(i + 1).padStart(2, '0')}`;
        const f = flows.get(mk);
        const t = { income: totals.income[i] ?? 0, expenses: totals.expenses[i] ?? 0, saved: totals.saved[i] ?? 0 };
        if (!f && !t.income && !t.expenses && !t.saved) continue;
        reconciliation.push({ month: mk, tracker: t, imported: { income: f?.income ?? 0, expenses: f?.expenses ?? 0, saved: f?.saved ?? 0 } });
      }
    }
  }

  // ── Opening-balance sanity for the spending account ──────────────────────
  // Accounts and debts with no dates of their own start at the first month of data, not Jan 1.
  if (transactions.length) {
    const firstMonth = `${transactions.reduce((m, t) => (t.date < m ? t.date : m), transactions[0]!.date).slice(0, 7)}-01`;
    for (const a of accounts) if (!snapshotSeries.has(a.name) && a.openingBalance === 0) a.openingDate = firstMonth;
    for (const d of debts) d.startDate = firstMonth;
  }
  if (!snapshotSeries.has(spending.name) && transactions.length) {
    issues.push({ level: 'warning', sheet: nw?.name ?? '—', message: `No balances for "${spending.name}" in the workbook, so its opening balance is ₡0 and its ledger balance will be wrong until you enter the real opening balance (Accounts → Edit).` });
    const firstDate = transactions.reduce((m, t) => (t.date < m ? t.date : m), transactions[0]!.date);
    spending.openingDate = `${firstDate.slice(0, 7)}-01`;
  }
  for (const d of debts) {
    if (d.confirmedBalance) issues.push({ level: 'info', sheet: debtSheet?.name ?? 'Debts', message: `"${d.creditor}": balance ₡${(d.confirmedBalance.amount / 100).toLocaleString('en')} saved as confirmed today. The app will compare it with what the ledger says was paid.` });
  }

  if (!detected.length) issues.push({ level: 'error', sheet: '—', message: 'This does not look like the Financial Tracker workbook' });
  for (const s of grid.sheets) {
    if (!detected.some((d) => d.sheet === s.name)) detected.push({ sheet: s.name, role: 'Ignored', detail: 'calculated sheet — not imported' });
  }

  return {
    fileName: opts.fileName, detected, accounts, pots, categories, categoryMap: [...mapping.values()], budgets, debts,
    selfLoans, snapshots, transactions, issues, reconciliation,
    defaults: { spendingAccountId: spending.id, savingsAccountId: savingsAcc?.id },
  };
}

function nextDay(d: ISODate): ISODate {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

/** "Loan repayment - Girlfriend" ↔ debt "Girlfriend - iPhone + Macbook payoff": match on the words after the dash. */
function matchDebt(categoryName: string, debts: Debt[]): Debt | undefined {
  const tail = categoryName.split(/\s[-–]\s/).slice(1).join(' ').toLowerCase().trim();
  if (!tail) return undefined;
  const words = tail.split(/\s+/).filter((w) => w.length > 2);
  return debts.find((d) => words.some((w) => d.creditor.toLowerCase().includes(w)));
}

/** Point every row from a workbook category at a different app category (mapping screen). */
export function remapCategory(plan: ImportPlan, source: string, target: Category): ImportPlan {
  const m = plan.categoryMap.find((x) => x.source === source);
  if (!m) return plan;
  const from = m.categoryId;
  return {
    ...plan,
    categoryMap: plan.categoryMap.map((x) => (x.source === source ? { ...x, categoryId: target.id, group: target.group, isNew: false } : x)),
    transactions: plan.transactions.map((t) => ('categoryId' in t && t.categoryId === from ? { ...t, categoryId: target.id } : t)),
  };
}

export const RECON_GROUPS = CATEGORY_GROUPS;
