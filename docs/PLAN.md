# Colón: build plan, decisions, workbook findings, open questions

Status: **Phase 1 (plan & scaffold) is done and waiting for your review.**

## Stack (confirmed)

Web app, installable as a PWA. React 19 + TypeScript (strict) + Vite 6, Tailwind 4 plus a custom glass design system in CSS variables, Recharts, Dexie 4 (IndexedDB), Zod, SheetJS for Excel, Vitest + Playwright, Motion for springs. Tauri can wrap it later.

I'm not recommending native SwiftUI. You live on Windows, and the web version can reach about 90% of the Liquid Glass look with `backdrop-filter`. SwiftUI would lock you to Apple devices and give you nothing on your PC.

## Integrity decisions (how the old workbook bugs become impossible)

| Workbook bug | How the schema prevents it |
|---|---|
| Floats (the ledger total is literally `11687263.440000001`) | Every amount is an integer number of céntimos. `src/lib/money.ts` throws on non-integers, overflow, or mixed currencies. |
| Transfers counted as spending | `transfer` is its own kind with **both sides in one record**. A transfer has no category, so it cannot reach income or expense totals. |
| A transfer with a missing side | It can't exist. A transfer record without both `from` and `to` fails validation. |
| Negative amounts meaning "withdrawal" | Amounts are always positive. Direction comes from the kind (`savings` has `direction: deposit/withdrawal`). Only `adjustment` is signed. |
| Debts counted twice / balances typed by hand | Nothing stores a total or a balance. A debt balance = original − linked `debt_payment` records. |
| Pay-from-pot double count | One user action creates records that share a `linkId`: pot withdrawal + debt payment. Reports count the debt payment once. |
| Rows not reaching totals (no TYPE, no MONTH) | Each row is validated with Zod at entry and at import. Undated rows get the last day of the month and `dateEstimated: true`. |

## Phases (I'll stop for your review after each one)

1. ✅ **Plan & scaffold**: schema (`src/domain/schemas.ts`), Dexie DB (`src/db/db.ts`), money and date libraries with 25 tests, design tokens, and the `/design` page.
2. **Core ledger**: ledger derivation (`legs(tx)` → balances per account and pot), Quick Add (`N`, natural amounts, "Add another"), and the Transactions screen with collapsible months. Tests use your four fixture scenarios.
3. **Excel import**: the importer for your workbook (findings below), a reconciliation against the Tracker for each month, and undoable batches.
4. **Tracker & budgets**
5. **Pots, debts, self-loans**
6. **Net worth, goals, calculators**
7. **Dashboard, insights, reports, exports**
8. **Recurring, bills calendar, reminders**
9. **Security (PIN/WebAuthn, encrypted backup), PWA install, polish, accessibility pass**

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
