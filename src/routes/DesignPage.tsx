import { useState } from 'react';
import { CountUp, Glass, Money, Pill, PressCard, SectionTitle, Segmented } from '../design/components';
import { GroupDonut, IncomeExpenseChart } from '../design/components/charts';
import { useTheme, type ThemePref } from '../app/theme';
import { fromMajor, parseAmountInput, formatMoney, type Minor } from '../lib/money';
import { todayISO, formatDateCR } from '../lib/dates';

const c = (n: number) => fromMajor(n, 'CRC');

/** Specimen values only — this page shows the look, not your data. */
const SPECIMEN_FLOW = [
  { month: 'Jan', income: c(800_000), expenses: c(640_000) },
  { month: 'Feb', income: c(820_000), expenses: c(910_000) },
  { month: 'Mar', income: c(805_000), expenses: c(700_000) },
  { month: 'Apr', income: c(830_000), expenses: c(760_000) },
  { month: 'May', income: c(815_000), expenses: c(690_000) },
];
const SPECIMEN_GROUPS = [
  { name: 'Fixed', value: c(210_000) },
  { name: 'Living', value: c(300_000) },
  { name: 'Discretionary', value: c(60_000) },
  { name: 'Debt Service', value: c(90_000) },
  { name: 'Savings', value: c(160_000) },
];

const SWATCHES = [
  ['Income', '--income'], ['Expense', '--expense'], ['Savings', '--savings'], ['Debt', '--debt'],
  ['Neutral', '--neutral'], ['Accent', '--accent'], ['Hers', '--hers'], ['Mine', '--mine'], ['Shared', '--shared'],
] as const;

function Row({ children, gap = 16 }: { children: React.ReactNode; gap?: number }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap, alignItems: 'center' }}>{children}</div>;
}

export default function DesignPage() {
  const { theme, setTheme, transparency, setTransparency } = useTheme();
  const [raw, setRaw] = useState('70k');
  const parsed = parseAmountInput(raw, 'CRC');
  const [hero, setHero] = useState(c(2_500_000));
  const [kind, setKind] = useState<'expense' | 'income' | 'transfer' | 'savings'>('expense');

  return (
    <div style={{ display: 'grid', gap: 32, paddingBottom: 120 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <p style={{ margin: 0, color: 'var(--text-2)', fontWeight: 600, fontSize: 13, textTransform: 'uppercase', letterSpacing: '.08em' }}>Design system · v0.1</p>
          <h1 style={{ margin: '4px 0 0', fontSize: 40, letterSpacing: '-0.03em', fontWeight: 800 }}>Liquid glass</h1>
          <p style={{ margin: '6px 0 0', color: 'var(--text-2)' }}>Specimen values only. Approve the look here before screens are built.</p>
        </div>
        <Row gap={10}>
          <Segmented<ThemePref> label="Theme" value={theme} onChange={setTheme}
            options={[{ value: 'auto', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
          <Segmented label="Transparency" value={transparency} onChange={setTransparency}
            options={[{ value: 'auto', label: 'Glass' }, { value: 'reduced', label: 'Solid' }]} />
        </Row>
      </header>

      {/* Hero */}
      <Glass pad={32} lens style={{ display: 'grid', gap: 8 }}>
        <span style={{ color: 'var(--text-2)', fontWeight: 600 }}>Net worth</span>
        <CountUp amount={hero} size={56} />
        <Row gap={10}>
          <Pill tone="income">▲ {formatMoney(c(85_000), 'CRC')} this month</Pill>
          <Pill tone="savings">Emergency fund 3.5 / 6 months</Pill>
          <Pill tone="debt">Debt-free by Jun 2027</Pill>
        </Row>
        <Row gap={10}>
          <button className="btn btn-sm" onClick={() => setHero((h) => (h + c(70_000)) as Minor)}>+ ₡70,000 (count-up)</button>
          <button className="btn btn-sm" onClick={() => setHero((h) => (h - c(185_000)) as Minor)}>− ₡185,000</button>
        </Row>
      </Glass>

      <section>
        <SectionTitle sub="Semantic colors. Hers and Mine keep these colors everywhere.">Color tokens</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 12 }}>
          {SWATCHES.map(([name, v]) => (
            <Glass key={v} pad={14} style={{ borderRadius: 20 }}>
              <div style={{ height: 44, borderRadius: 12, background: `var(${v})`, marginBottom: 10 }} />
              <div style={{ fontWeight: 650, fontSize: 14 }}>{name}</div>
              <code style={{ fontSize: 12, color: 'var(--text-2)' }}>{v}</code>
            </Glass>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle sub="System font stack, tabular numerals for every amount.">Type & money</SectionTitle>
        <Glass style={{ display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.03em' }}>Display 34 / 800</div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>Title 22 / 700</div>
          <div style={{ fontSize: 16 }}>Body 16 — Logged {formatDateCR(todayISO())} · BAC Colones</div>
          <div style={{ fontSize: 13, color: 'var(--text-2)' }}>Caption 13 — secondary text</div>
          <hr style={{ border: 0, borderTop: '1px solid var(--glass-hairline)', width: '100%' }} />
          <Row gap={24}>
            <Money amount={c(1_234_567)} size={20} />
            <Money amount={fromMajor(1234.56, 'USD')} currency="USD" size={20} />
            <Money amount={c(320_000)} tone="income" signed size={20} />
            <Money amount={-c(185_000)} tone="auto" size={20} />
            <Money amount={-c(185_000)} tone="auto" parens size={20} />
          </Row>
        </Glass>
      </section>

      <section>
        <SectionTitle sub="Blur 32px · saturate 180% · inner highlight · hairline · top specular sheen.">Glass surfaces</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          <Glass><b>Regular</b><p style={{ color: 'var(--text-2)', margin: '6px 0 0' }}>Default tint for cards and panels.</p></Glass>
          <Glass strong><b>Strong</b><p style={{ color: 'var(--text-2)', margin: '6px 0 0' }}>Higher tint behind dense text and tables.</p></Glass>
          <Glass lens><b>Lensed (hero)</b><p style={{ color: 'var(--text-2)', margin: '6px 0 0' }}>SVG displacement. Progressive enhancement.</p></Glass>
        </div>
      </section>

      <section>
        <SectionTitle>Buttons</SectionTitle>
        <Glass>
          <Row gap={12}>
            <button className="btn btn-primary">Save</button>
            <button className="btn">Add another</button>
            <button className="btn btn-ghost">Cancel</button>
            <button className="btn btn-danger">Undo import</button>
            <button className="btn btn-sm">Small</button>
            <button className="btn" disabled>Disabled</button>
          </Row>
        </Glass>
      </section>

      <section>
        <SectionTitle sub="Amount first. Try 70k, 1.5m, 185,000 or 12.50.">Inputs</SectionTitle>
        <Glass style={{ display: 'grid', gap: 18, maxWidth: 560, minWidth: 0 }}>
          <Segmented label="Movement kind" value={kind} onChange={setKind}
            options={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }, { value: 'transfer', label: 'Transfer' }, { value: 'savings', label: 'Savings' }]} />
          <div className="field">
            <label htmlFor="amt">Amount</label>
            <input id="amt" className="input input-amount" inputMode="decimal" autoComplete="off" value={raw}
              onChange={(e) => setRaw(e.target.value)} aria-invalid={raw !== '' && parsed === null} aria-describedby="amt-hint" />
            <span id="amt-hint" style={{ fontSize: 13, color: parsed === null && raw ? 'var(--expense)' : 'var(--text-2)' }}>
              {parsed === null ? (raw ? 'Can’t read that amount' : ' ') : <>Will save <b className="money">{formatMoney(parsed, 'CRC', { decimals: parsed % 100 ? 2 : 0 })}</b> as {parsed.toLocaleString('en')} céntimos</>}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 12 }}>
            <div className="field"><label htmlFor="cat">Category</label><input id="cat" className="input" placeholder="Groceries" /></div>
            <div className="field"><label htmlFor="date">Date</label><input id="date" className="input" type="date" defaultValue={todayISO()} /></div>
          </div>
        </Glass>
      </section>

      <section>
        <SectionTitle sub="Separate account: Her money / My money / Total. Press a tile.">Cards</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <PressCard label="Her money"><div style={{ color: 'var(--hers)', fontWeight: 700, fontSize: 13 }}>● HER MONEY</div><Money amount={c(120_000)} size={30} weight={700} /><div style={{ fontSize: 13, color: 'var(--text-2)' }}>Loan fund · not yours to spend</div></PressCard>
          <PressCard label="My money"><div style={{ color: 'var(--mine)', fontWeight: 700, fontSize: 13 }}>● MY MONEY</div><Money amount={c(380_000)} size={30} weight={700} /><div style={{ fontSize: 13, color: 'var(--text-2)' }}>Your own savings</div></PressCard>
          <PressCard label="Total"><div style={{ color: 'var(--text-2)', fontWeight: 700, fontSize: 13 }}>TOTAL</div><Money amount={c(500_000)} size={30} weight={700} /><div style={{ fontSize: 13, color: 'var(--text-2)' }}>Should match the bank app</div></PressCard>
        </div>
      </section>

      <section>
        <SectionTitle sub="CVD-validated series colors, hover tooltips, and a table view behind every chart.">Charts</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 16 }}>
          <Glass strong><IncomeExpenseChart title="Income vs expenses (specimen)" data={SPECIMEN_FLOW} /></Glass>
          <Glass strong><GroupDonut title="Spending by group (specimen)" data={SPECIMEN_GROUPS} /></Glass>
        </div>
      </section>
    </div>
  );
}
