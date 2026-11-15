import { useEffect, useState } from 'react';
import { rateForDay } from '../app/fx';
import { usePref } from '../app/prefs';
import { Glass, Money, Pill, Segmented } from '../design/components';
import { PageHeader } from '../ui/Sheet';
import { cdp, futureValue, monthsToTarget, programmedSavings, type Frequency } from '../domain/calculators';
import { amortize, accelerate } from '../domain/debts';
import { cuotaDate } from '../domain/installments';
import { convert, formatMoney, parseAmountInput } from '../lib/money';
import { formatDateCR, todayISO } from '../lib/dates';
import { useAvgIncome } from './Debts';

type Tab = 'cdp' | 'programmed' | 'loan' | 'whatif' | 'fx';
const amt = (s: string) => parseAmountInput(s, 'CRC') ?? 0;
const num = (s: string) => { const n = Number(s.replace(',', '.')); return Number.isFinite(n) ? n : 0; };

function Field({ id, label, value, onChange, hint, type = 'text' }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string; type?: string }) {
  return (
    <div className="field"><label htmlFor={id}>{label}</label>
      <input id={id} className="input" inputMode={type === 'date' ? undefined : 'decimal'} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="small muted">{hint}</span>}</div>
  );
}

/** Rates are inputs you verify yourself; the app never states a bank's rate as fact. */
function RateField({ id, label, rate, verified, onRate, onVerified }: { id: string; label: string; rate: number; verified?: string; onRate: (n: number) => void; onVerified: (d: string) => void }) {
  const stale = !verified || (Date.now() - Date.parse(verified)) / 86_400_000 > 30;
  return (
    <div className="grid2">
      <div className="field"><label htmlFor={id}>{label}</label><input id={id} className="input" inputMode="decimal" value={rate || ''} placeholder="e.g. 4.5" onChange={(e) => onRate(num(e.target.value))} /></div>
      <div className="field"><label htmlFor={`${id}-v`}>Rate last checked</label><input id={`${id}-v`} className="input" type="date" value={verified ?? ''} onChange={(e) => onVerified(e.target.value)} />
        {stale && <span className="small" style={{ color: 'var(--debt)' }}>Check the bank's current rate</span>}</div>
    </div>
  );
}

const Row = ({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontWeight: strong ? 750 : undefined }}><span className={strong ? undefined : 'muted'}>{k}</span><span className="money">{v}</span></div>
);

export default function Calculators() {
  const [tab, setTab] = useState<Tab>('cdp');
  const [rates, setRates] = usePref('calcRates');
  const avgIncome = useAvgIncome();
  const today = todayISO();

  // CDP
  const [cdpAmt, setCdpAmt] = useState('1m');
  const [cdpDays, setCdpDays] = useState('180');
  const c = cdp(amt(cdpAmt), num(cdpDays), rates.cdpAnnualRatePct, rates.withholdingPct);
  // Programmed savings
  const [pMonthly, setPMonthly] = useState('70k');
  const [pMonths, setPMonths] = useState('12');
  const [pTax, setPTax] = useState(false);
  const start = { year: Number(today.slice(0, 4)) + (today.slice(5, 7) === '12' ? 1 : 0), month: today.slice(5, 7) === '12' ? 1 : Number(today.slice(5, 7)) + 1 };
  const freqs: Frequency[] = ['monthly', 'quincenal', 'weekly'];
  const prog = freqs.map((f) => programmedSavings(amt(pMonthly), Math.max(1, Math.min(120, num(pMonths))), rates.programmedAnnualRatePct, f, start, pTax ? rates.withholdingPct : 0));
  // Loan
  const [lBal, setLBal] = useState('500k');
  const [lRate, setLRate] = useState('8');
  const [lPay, setLPay] = useState('90k');
  const [lExtra, setLExtra] = useState('');
  const first = cuotaDate(today, 2);
  const loan = amortize(amt(lBal), Math.round(num(lRate) * 100), amt(lPay), first);
  const acc = amt(lExtra) ? accelerate(amt(lBal), Math.round(num(lRate) * 100), amt(lPay), amt(lExtra), first) : null;
  // What if
  const [wExtra, setWExtra] = useState('20k');
  const [wMonths, setWMonths] = useState('12');
  const [wRate, setWRate] = useState('0');
  const [wTarget, setWTarget] = useState('');
  const fv = futureValue(amt(wExtra), Math.max(1, num(wMonths)), num(wRate));
  const toTarget = amt(wTarget) ? monthsToTarget(amt(wTarget), amt(wExtra), num(wRate)) : null;

  return (
    <>
      <PageHeader title="Calculators" sub="Costa Rica money math. Rates are yours to enter and verify. Nothing here is a bank's official rate." />
      <div style={{ marginBottom: 16 }}>
        <Segmented<Tab> label="Calculator" value={tab} onChange={setTab} options={[{ value: 'cdp', label: 'CDP' }, { value: 'programmed', label: 'Ahorro programado' }, { value: 'loan', label: 'Loan payoff' }, { value: 'whatif', label: 'What if I save more' }, { value: 'fx', label: 'Dollars ↔ colones' }]} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: 16, alignItems: 'start' }}>
        {tab === 'cdp' && <>
          <Glass strong style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Certificado a plazo (CDP)</h2>
            <Field id="cdp-a" label="Amount" value={cdpAmt} onChange={setCdpAmt} />
            <Field id="cdp-d" label="Days" value={cdpDays} onChange={setCdpDays} hint="30, 90, 180, 360…" />
            <RateField id="cdp-r" label="Annual rate %" rate={rates.cdpAnnualRatePct} verified={rates.cdpVerifiedOn} onRate={(n) => void setRates({ ...rates, cdpAnnualRatePct: n })} onVerified={(d) => void setRates({ ...rates, cdpVerifiedOn: d })} />
            <Field id="cdp-w" label="Tax withheld on interest %" value={String(rates.withholdingPct)} onChange={(v) => void setRates({ ...rates, withholdingPct: num(v) })} hint="Default 15%. Confirm what applies to your instrument." />
          </Glass>
          <Glass strong style={{ display: 'grid', gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Result</h2>
            {!rates.cdpAnnualRatePct ? <p className="muted">Enter the rate the bank offers you.</p> : <>
              <Row k="Gross interest (amount × rate × days / 360)" v={formatMoney(c.gross, 'CRC')} />
              <Row k={`Withholding ${rates.withholdingPct}%`} v={`−${formatMoney(c.withholding, 'CRC')}`} />
              <Row k="Net interest" v={formatMoney(c.net, 'CRC')} strong />
              <Row k="You get back at maturity" v={formatMoney(c.maturity, 'CRC')} strong />
              <Row k="Net annual yield" v={`${c.netAnnualPct.toFixed(2)}%`} />
              <p className="small muted" style={{ margin: 0 }}>Matures around {formatDateCR(addDays(today, num(cdpDays)))} if opened today.</p>
            </>}
          </Glass>
        </>}

        {tab === 'programmed' && <>
          <Glass strong style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Programmed savings</h2>
            <p className="small muted" style={{ margin: 0 }}>Like a goal-savings plan: fixed deposits, interest capitalised daily.</p>
            <Field id="ps-m" label="Monthly amount" value={pMonthly} onChange={setPMonthly} />
            <Field id="ps-t" label="Term (months)" value={pMonths} onChange={setPMonths} />
            <RateField id="ps-r" label="Annual rate %" rate={rates.programmedAnnualRatePct} verified={rates.programmedVerifiedOn} onRate={(n) => void setRates({ ...rates, programmedAnnualRatePct: n })} onVerified={(d) => void setRates({ ...rates, programmedVerifiedOn: d })} />
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={pTax} onChange={(e) => setPTax(e.target.checked)} /> Withhold {rates.withholdingPct}% tax on interest</label>
          </Glass>
          <Glass strong style={{ display: 'grid', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>By deposit frequency</h2>
            {!rates.programmedAnnualRatePct && <p className="muted small" style={{ margin: 0 }}>Enter a rate to see the interest.</p>}
            <table className="table">
              <thead><tr><th>Deposits</th><th className="num">You put in</th><th className="num">Interest</th><th className="num">Final</th><th className="num">vs monthly</th></tr></thead>
              <tbody>{prog.map((r) => (
                <tr key={r.frequency}><td>{{ monthly: 'Monthly (payday)', quincenal: 'Quincenal (15th + last day)', weekly: 'Weekly' }[r.frequency]}<div className="small muted">{r.deposits} deposits</div></td>
                  <td className="num">{formatMoney(r.deposited, 'CRC')}</td><td className="num">{formatMoney(r.interestGross - r.withholding, 'CRC')}</td><td className="num"><b>{formatMoney(r.final, 'CRC')}</b></td>
                  <td className="num">{r.frequency === 'monthly' ? '—' : <span style={{ color: 'var(--income)' }}>{formatMoney(r.final - prog[0]!.final - (r.deposited - prog[0]!.deposited), 'CRC', { signed: true })}</span>}</td></tr>
              ))}</tbody>
            </table>
            <p className="small muted" style={{ margin: 0 }}>"vs monthly" is the extra interest from depositing earlier, excluding any difference in amount deposited (weekly = monthly × 12 ÷ 52).</p>
          </Glass>
        </>}

        {tab === 'loan' && <>
          <Glass strong style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Loan payoff</h2>
            <Field id="l-b" label="Balance owed" value={lBal} onChange={setLBal} />
            <div className="grid2"><Field id="l-r" label="Annual rate %" value={lRate} onChange={setLRate} /><Field id="l-p" label="Monthly payment" value={lPay} onChange={setLPay} /></div>
            <Field id="l-x" label="Extra per month (optional)" value={lExtra} onChange={setLExtra} />
          </Glass>
          <Glass strong style={{ display: 'grid', gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Result</h2>
            {loan.never ? <Pill tone="expense">The payment doesn't cover the monthly interest. It never gets paid off.</Pill> : <>
              <Row k="Months" v={loan.months} strong />
              <Row k="Paid off on" v={loan.payoffDate ? formatDateCR(loan.payoffDate) : '—'} />
              <Row k="Total interest" v={formatMoney(loan.totalInterest, 'CRC')} />
              <Row k="Total paid" v={formatMoney(loan.totalPaid, 'CRC')} />
              <Row k="Last payment" v={formatMoney(loan.rows.at(-1)?.payment ?? 0, 'CRC')} />
              {avgIncome > 0 && <Row k="Payment as % of your income" v={`${((amt(lPay) / avgIncome) * 100).toFixed(1)}%`} />}
              {acc && !acc.faster.never && <p style={{ margin: '8px 0 0' }}>With +{formatMoney(amt(lExtra), 'CRC')}/month: done {formatDateCR(acc.faster.payoffDate!)}, <b>{acc.monthsSaved}</b> month(s) sooner, saving <b>{formatMoney(acc.interestSaved, 'CRC')}</b>.</p>}
            </>}
          </Glass>
        </>}

        {tab === 'whatif' && <>
          <Glass strong style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>What if I save more?</h2>
            <Field id="w-x" label="Extra saved per month" value={wExtra} onChange={setWExtra} />
            <div className="grid2"><Field id="w-m" label="For (months)" value={wMonths} onChange={setWMonths} /><Field id="w-r" label="Annual rate % (0 if just a savings account)" value={wRate} onChange={setWRate} /></div>
            <Field id="w-t" label="Reach a target (optional)" value={wTarget} onChange={setWTarget} hint="e.g. 6 months of essentials" />
          </Glass>
          <Glass strong style={{ display: 'grid', gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Result</h2>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}><Money amount={fv.final} size={34} weight={800} tone="savings" /><span className="muted small">after {num(wMonths)} months</span></div>
            <Row k="You put in" v={formatMoney(fv.contributed, 'CRC')} />
            <Row k="Interest" v={formatMoney(fv.interest, 'CRC')} />
            {avgIncome > 0 && <Row k="Adds to your savings rate" v={`+${((amt(wExtra) / avgIncome) * 100).toFixed(1)} pts`} />}
            {toTarget !== null && <Row k="Months to reach the target" v={toTarget === Infinity ? 'never' : `${toTarget} (${formatDateCR(cuotaDate(today, toTarget + 1))})`} strong />}
          </Glass>
        </>}

        {tab === 'fx' && <FxCalculator />}
      </div>
    </>
  );
}

/** Convert any amount at the rate of any day (BCCR → market → your own). */
function FxCalculator() {
  const [date, setDate] = useState(todayISO());
  const [dir, setDir] = useState<'USD' | 'CRC'>('USD');
  const [raw, setRaw] = useState('100');
  const [rateRaw, setRateRaw] = useState('');
  const [info, setInfo] = useState('');
  useEffect(() => {
    let off = false;
    setInfo('Getting the rate…');
    void rateForDay(date).then((q) => { if (off) return; if (q) { setRateRaw(String(q.rate / 100)); setInfo(`${q.source === 'BCCR' ? `BCCR ${q.side}` : 'Market'} rate of ${formatDateCR(q.rateDate)}`); } else setInfo('No rate available: type one.'); }).catch(() => !off && setInfo('No rate available: type one.'));
    return () => { off = true; };
  }, [date]);
  const rate = parseAmountInput(rateRaw, 'CRC');
  const v = parseAmountInput(raw, dir);
  const out = v && rate ? convert(v, dir, dir === 'USD' ? 'CRC' : 'USD', rate) : null;
  return (
    <>
      <Glass strong style={{ display: 'grid', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Dollars ↔ colones</h2>
        <Segmented<'USD' | 'CRC'> label="Direction" value={dir} onChange={setDir} options={[{ value: 'USD', label: '$ → ₡' }, { value: 'CRC', label: '₡ → $' }]} />
        <Field id="fx-amt" label={dir === 'USD' ? 'Dollars' : 'Colones'} value={raw} onChange={setRaw} />
        <div className="grid2">
          <Field id="fx-date" type="date" label="On the day" value={date} onChange={setDate} />
          <Field id="fx-rate" label="Rate (₡ per $1)" value={rateRaw} onChange={(x) => { setRateRaw(x); setInfo('Your rate'); }} hint={info} />
        </div>
      </Glass>
      <Glass strong style={{ display: 'grid', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Result</h2>
        <b className="money" style={{ fontSize: 34 }}>{out ? formatMoney(out, dir === 'USD' ? 'CRC' : 'USD', { decimals: 2 }) : '—'}</b>
        <span className="small muted">Set the rate source and your BCCR token in Settings → Exchange rates.</span>
      </Glass>
    </>
  );
}

function addDays(d: string, n: number) {
  const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10);
}
