/**
 * Every Coach alert in plain words: what it means and why it matters, without the jargon.
 * Shown on each alert card; the math stays one tap away under "Show the math".
 */
export interface Plain { means: string; matters: string }

export const PLAIN: Record<string, Plain> = {
  A1: { means: "The app doesn't know what's really in this account right now.", matters: 'Safe-to-spend and the forecast start from this balance. Type what your bank app shows and everything else lines up.' },
  A2: { means: "Payday just happened and this quincena's savings haven't moved yet.", matters: 'Saving first, before spending starts, is the easiest way to hit your savings goal.' },
  A3: { means: 'The month is closing and there is money left over.', matters: "Moving it to savings now keeps it from quietly turning into next month's spending." },
  R1: { means: 'At the pace you are spending in this category, you will end the month over its budget.', matters: 'Slowing down now is easier than fixing it on the 30th.' },
  R2: { means: 'This category has used most (or all) of its budget for the month.', matters: 'Anything more you spend here comes out of another category or your savings.' },
  R3: { means: 'One movement is much bigger than what you usually spend in this category.', matters: "It could be right, a typo, or the wrong category. Worth a quick look." },
  R4: { means: 'Several small "treat" purchases close together.', matters: 'Small buys add up fast. A short wait before buying usually cancels half of them.' },
  R5: { means: 'A big share of this paycheck went out in the first days after payday.', matters: 'What is left has to last until the next quincena.' },
  R6: { means: 'Bills, savings and your cushion before payday add up to more than you have.', matters: 'Something has to give: spend less until payday, or move money from savings on purpose.' },
  R7: { means: 'On some day in the next 30 days your everyday account is expected to drop under your cushion.', matters: 'A bill could bounce or you could end up short. Plan for that day now.' },
  R8: { means: 'A bill that usually shows up has not been logged after its due date.', matters: 'Either it is missing from the app, or it really is still unpaid.' },
  R9: { means: "At this pace, this quincena's planned savings won't fit.", matters: 'Saving first protects the goal; otherwise it is the first thing to slip.' },
  R10: { means: "Money was taken out of a fund that belongs to someone else.", matters: "It's her money. Logging it as borrowing keeps track of what you owe back." },
  R11: { means: 'The date you finish paying this debt moved later.', matters: 'Each month later means more payments. A small extra payment pulls it back.' },
  R12: { means: 'A big part of your income goes to debt payments.', matters: 'Above about 20% it gets hard to save or absorb a surprise.' },
  R13: { means: 'The same charge appears every month (a subscription), or its price went up.', matters: 'Subscriptions are easy to forget. Add it as a bill or cancel what you no longer use.' },
  R14: { means: 'Your spending has been growing faster than your income.', matters: 'This "lifestyle creep" slowly eats the gap you could be saving.' },
  R15: { means: 'An unusually big amount came in (aguinaldo, a sale, a bonus).', matters: 'Deciding where it goes right away keeps it from disappearing into everyday spending.' },
  R16: { means: 'Your emergency money covers fewer months of essentials than your target.', matters: 'An emergency fund is what keeps a surprise (car, health, job) from becoming debt.' },
  R17: { means: 'Two or more movements look the same: same amount, same day or next.', matters: 'A duplicate makes your balance and budget wrong. Compare them and delete the extra.' },
  R18: { means: 'Some movements have no category.', matters: "Without a category they don't count in your budget or reports." },
  R19: { means: 'A bill due in the next few days will leave your balance under your cushion.', matters: 'Move money in before it is due, or make sure it is covered.' },
  R20: { means: 'Year-end costs (marchamo, December) are coming and their fund is behind.', matters: 'A little each month now avoids one big hit in December.' },
  R21: { means: 'Something went well.', matters: 'Keep doing what got you here.' },
};

export const plainFor = (ruleId: string): Plain | undefined => PLAIN[ruleId];
