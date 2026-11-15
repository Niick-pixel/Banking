# Money Coach (spec §10)

The Coach watches the ledger and tells you what to do about it, in numbers. It is **deterministic**: every alert comes from a rule in `src/coach/rules/`, one file per rule, and every alert carries the formula, inputs and threshold that produced it ("Why am I seeing this?"). Nothing leaves the device, and nothing changes your data unless you tap an action.

## Pipeline

```
ledger ─▶ context.ts   baselines (median, MAD×1.4826, day-of-month curve), paydays, balances
       ─▶ forecast.ts  pace, safe-to-spend, 60-day forecast, hours of work
       ─▶ rules/*.ts   R1–R21 + A1–A3 → Insight[]
       ─▶ score.ts     impact × urgency × confidence × userWeight × severity
       ─▶ dispatch.ts  Inbox · top 3 on the Dashboard · ≤ 3 pushes/day, quiet hours, cooldown
```

`engine.ts` runs it all; `src/app/coach.tsx` runs the engine over the live ledger every time data changes, and stores the Coach's memory (dismissed, snoozed, "not useful" votes, reasons, caps, cooling-off list, payoff history) in the synced preferences, so it follows you between PCs.

## Rules

| Id | Rule | Default trigger | Severity |
|---|---|---|---|
| R1 | Overspend pace | projected ≥ 110% of budget after day 5 (critical ≥ 140%), Living/Discretionary categories and their group totals | warning / critical |
| R2 | Budget threshold | 80% (Settings → Budgets) and 100% of budget; a Fixed bill at exactly its budget is just paid | heads-up / warning |
| R3 | Unusual transaction | > typical + 3 MAD (≥ 5 past purchases) or > 10% of monthly income; Living/Discretionary only | heads-up |
| R4 | Impulse cluster | 3 discretionary buys in 48 h, or the same store ≥ 3 times in 7 days (non-essential spending) | warning |
| R5 | Payday splurge | > 25% of the quincena spent in the 72 h after payday (dated rows only) | warning |
| R6 | Safe-to-spend negative | safe-to-spend < 0 | critical |
| R7 | Cash-flow dip | forecast below buffer within 30 days | warning |
| R8 | Missing recurring | a recurring bill, or a Fixed bill paid each of the last 3 months, not logged 5 days after it was due | warning |
| R9 | Savings at risk | 3 days before payday, free cash < this quincena's planned savings | warning |
| R10 | Her pot withdrawal | any money out of a pot owned by someone else (paying her debt from it excluded); asks for a reason and logs it as borrowing | critical |
| R11 | Payoff slipping | projected payoff ≥ 1 month later than last month's projection | warning |
| R12 | Debt-service ratio | Debt Service group > 20% of income, or > 36% with rent (3-month averages) | warning |
| R13 | Subscriptions | same description ±5% in consecutive months; price rise > 5% | info / heads-up |
| R14 | Lifestyle creep | 3-month average spending outgrowing income 2 months running | heads-up |
| R15 | Windfall | non-salary income > 1.5× your usual extra income, or named aguinaldo/bonus/quinquenio → splitter | info |
| R16 | Emergency fund | liquid months below target or below last month | heads-up |
| R17 | Duplicates | same kind, account and amount within ±1 day, similar description | heads-up |
| R18 | Uncategorized | > 5 expenses without a category, or any older than 7 days | info |
| R19 | Upcoming bills | a bill due within 3 days leaves you under your buffer | heads-up |
| R20 | Year-end funds | from October, marchamo / December goals vs what's set aside | heads-up |
| R21 | Wins | under budget 3 months straight; savings target hit; a debt paid off; cooling-off items skipped | win |
| A1 | Bank-balance nudge | no balance entered for a spending account in 7 days (or ever) | heads-up / info |
| A2 | Pay yourself first | within 2 days after payday, planned savings not moved yet | heads-up |
| A3 | Month-end sweep | last day of the month (or the 2 days after): leftover free cash | info |

Every threshold is editable in **Settings → Coach → Rules**. Three "not useful" votes halve a rule's weight (visible there, with a reset).

## Automations (you approve each one)

- **Auto-categorization**: words in a description → category, from your history. ≥ 90% confident: picked for you in Quick Add; 60–90%: suggested; lower: you choose. It says how many past transactions it learned from.
- **Spending caps**: from an R1 alert, one tap sets a daily cap for that category until month end. Quick Add asks before you go over.
- **Cooling-off list**: from ₡15,000 an item waits 48 h; from ₡50,000, 7 days. Buy, wait longer, or drop it; dropped items add to "Money not wasted".
- **Windfall splitter**: replenish self-loans → her loan fund → emergency fund → year-end funds → free money (max 15%). Order and cap in Settings. Approving creates ordinary savings movements you can edit or undo.
- **Pay yourself first** and **month-end sweep**: one tap moves the money to your pot.
- **Recurring auto-post** already existed (Bills & calendar).

## Reports

- **Weekly check-in** (Coach → Reports; pushed Sunday from 18:00 when notifications are on): day-to-day spending vs a weekly pace, safe-to-spend for the coming week, top 2 alerts, bills due.
- **Month-end report card**: savings rate vs target, free cash, the 3 categories most over budget (₡ and %), avoidable spending, debt progress, a one-line verdict. Print → PDF.

## Decisions and where real data differs from the spec

- **Undated rows.** Your workbook rows have no day, so they sit on the month's last day. The Coach counts them as already happened in the current month, keeps them (and the old monthly-total rows) out of the day-of-month curve, and replays history at month end. Mid-month pace alerts start working with what you log day by day from now on. The spec's "September R1 critical well before month end" is proven with dated test fixtures; on your real data the replay shows it at month end (critical, ₡855,817 vs ₡270,000).
- **Rent in September and October** *was* logged in your workbook (₡185,000 each), so on real data R8 correctly stays quiet for those months; the spec case is covered by tests with a recurring rent rule. November rent isn't logged yet, so R8 asks about it now.
- **Checking balance.** The workbook never had your BAC checking balance, so the ledger's figure is a guess. Safe-to-spend, the forecast and R6/R7/R9/R19 stay quiet until you enter a real balance once (Dashboard → Safe to spend, or the A1 alert). A typed balance becomes a statement; later movements are added on top of it.
- **Safe-to-spend** counts income that lands *before* the next payday; payday income pays for the next period, not this one.
- **Card payments** are logged as expenses in the Debt Service group in your data, so the debt-service ratio uses the whole group, not only loan payments.
- **An LLM** isn't used. If one is added later it may only rephrase titles; it never computes numbers.

## Tests

`src/coach/*.test.ts`: each rule has a should-fire and a should-not-fire fixture, plus the spec §10.9 acceptance cases, scoring, dispatch limits, reports and the splitter. `replay.local.test.ts` replays your real workbook (only where the private file exists; it never runs in CI) and asserts September R1 critical, October R4 (3 Amazon purchases) and November R15 (Quinquenio).
