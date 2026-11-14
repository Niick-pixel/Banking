# Aufwind: build plan, decisions, workbook findings, open questions

Status: **Phases 1–7 are done, plus Tasa Cero and the Windows desktop track (D1–D3).** The desktop/OTA track is planned in [`DESKTOP_PLAN.md`](DESKTOP_PLAN.md).

## Stack (confirmed)

Web app, installable as a PWA. React 19 + TypeScript (strict) + Vite 6, Tailwind 4 plus a custom glass design system in CSS variables, Recharts, Dexie 4 (IndexedDB), Zod, exceljs for Excel (the SheetJS CDN is unreachable from the build environment), Vitest + Playwright, Motion for springs. Tauri can wrap it later.

I'm not recommending native SwiftUI. You live on Windows, and the web version can reach about 90% of the Liquid Glass look with `backdrop-filter`. SwiftUI would lock you to Apple devices and give you nothing on your PC.

## Integrity decisions (how the old workbook bugs become impossible)

| Workbook bug | How the schema prevents it |
|---|---|
| Floats (the ledger total is literally `11687263.440000001`) | Every amount is an integer number of céntimos. `src/lib/money.ts` throws on non-integers, overflow, or mixed currencies. |
| Transfers counted as spending | `transfer` is its own kind with **both sides in one record**. A transfer has no category, so it cannot reach income or expense totals. |
| A transfer with a missing side | It can't exist. A transfer record without both `from` and `to` fails validation. |
| Negative amounts meaning "withdrawal" | Amounts are always positive. Direction comes from the kind (`savings` has `direction: deposit/withdrawal`). Only `adjustment` is signed. |
| Debts counted twice / balances typed by hand | Nothing stores a total or a balance. A debt balance = original − linked `debt_payment` records. |
| Pay-from-pot double count | Paying a debt *from a pot* is one `debt_payment` record whose source is the pot. It counts once as debt service, and Saved drops by the same amount, so free cash isn't hit twice. |
| Rows not reaching totals (no TYPE, no MONTH) | Each row is validated with Zod at entry and at import. Undated rows get the last day of the month and `dateEstimated: true`. |

## Phases (I'll stop for your review after each one)

1. ✅ **Plan & scaffold**: schema (`src/domain/schemas.ts`), Dexie DB (`src/db/db.ts`), money and date libraries with 25 tests, design tokens, and the `/design` page.
2. ✅ **Core ledger**: `src/domain/ledger.ts` (legs → balances per account/pot, monthly flows, debt status). All four spec fixtures are tested. Accounts (pots, statement check, data-health notes), Transactions (collapsible months with totals, search/filters, bulk recategorize, delete + undo), Quick Add (`N`, natural amounts, learned category suggestions, "Save & add another"), audit log.
3. ✅ **Excel import**: `src/import/workbook.ts`, label-based. Preview → category mapping → validation report → reconciliation vs the Tracker → one undoable batch. Against the real workbook, **every month Jun–Nov matches the Tracker to the céntimo** (the test only runs locally; the file is git-ignored).
   - ✅ **Tasa Cero** (added on request): credit-card accounts, 0% installment plans, a calculator (all terms, % of income, verdict), a 12-month outlook. Cuotas post as card expenses on their billing date with deterministic ids, so they can't be posted twice. Paying the card is a transfer.
4. ✅ **Tracker & budgets**: `src/domain/tracker.ts`. Matches the workbook's Tracker for every category and month. Inline budgets, pace projection, 80%/100% alerts.
5. ✅ **Pots, debts, self-loans**: `src/domain/debts.ts`. Interest-aware amortization (0% handled, partial last payment), the workbook's 3/4/6/9/12 scenarios (same PMT and the same verdict thresholds: 15% and 25% of income), an extra-payment accelerator, avalanche vs snowball, and the debt-service ratio (20%, and 36% with rent). Confirmed-balance gaps can be resolved with a payment or a non-cash adjustment. Self-loans fill up from linked or "Replenish" deposits, oldest first. The Pots page has Her/My/Total tiles, loan-fund progress, a one-action "Pay from pot", and a month-by-month table plus a stacked chart.
6. ✅ **Net worth, goals, calculators**: `src/domain/networth.ts` builds a monthly balance sheet where a statement you entered wins over the ledger. Liabilities = derived debts + credit cards + Tasa Cero cuotas not yet billed; self-loans are excluded. Emergency fund in months, both liquid (her loan fund excluded) and including cesantía, against an editable target. Goals linked to pots or accounts, with the monthly amount needed and an on-track check. Savings rate vs target. The automatic payroll savings floor, including the employer's share. Calculators: CDP (×days/360, editable withholding), programmed savings (daily interest, monthly / quincenal / weekly compared), loan payoff with an extra-payment accelerator, and "what if I save more". Rates are inputs with a "last checked" date. Preferences sync through the vault.
7. ✅ **Dashboard, insights, reports, exports**: The Dashboard (home) has month KPIs, plain-language insights, the next 30 days, income vs expenses, spending by group, where it went, budget health, free cash by month, net worth and debts. Data-health checks (`src/domain/health.ts`) run as a badge on the Dashboard and a full list in Settings. Reports: monthly P&L vs budget, cash flow by account, year in review, category trends, where the money went, and Print → PDF. Exports: Excel in the workbook's own layout with live SUMIFS Tracker formulas (round-trip tested through the importer), CSV, and a full backup file with restore. On desktop, exports go to `<data folder>/exports`.
8. **Recurring, bills calendar, reminders**
9. **Security (PIN/WebAuthn, encrypted backup), PWA install, polish, accessibility pass**
10. **Windows desktop**: Tauri installer, signed OTA updates, data vault in a cloud-synced folder. See `DESKTOP_PLAN.md` (D1–D6).

## Workbook findings & open questions

The real workbook was inspected, and the findings include actual balances. They live in `private/WORKBOOK_FINDINGS.md`, which is **git-ignored on purpose because this repository is public**. In summary:

- The structure matches the spec: month blocks, title and total rows, the self-check block, and the Tracker's `SUMIFS`, which works by category + month.
- There are data inconsistencies to resolve before import: a TYPE/category mismatch on a few rows, a debt balance typed by hand that subtracts set-aside money, two Net Worth rows with identical copied values, a wrong interest-to-pay formula, and savings logged that don't match account growth.
- Open questions: the default account mapping, how to model credit cards, the true current debt balance, cesantía balances, the self-loan details, and the amount-entry separator convention.

## Phase 1 checks

- `npm test`: 25 passing (money: integer math, half-even rounding, FX, formatting, "70k" parsing; dates: quincenas, month end, es-CR format).
- `npm run build`: passes with strict TypeScript.
- `/design` was screenshotted in light, dark, solid (reduced transparency), and mobile dark at 390px, with no console errors.
- Chart colors: red/green fails for deuteranopia as a bar pair (ΔE 5.6), so charts use a validated green/orange pair (ΔE 9.4–10.9). Text keeps green for income and red for expense, and every chart has a Table view.
