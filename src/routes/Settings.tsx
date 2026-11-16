import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Bell, Coins, Compass, ArrowUp, ArrowDown, Database, DollarSign, HelpCircle, LayoutDashboard, Palette, PieChart, RefreshCw, Shield, type LucideIcon } from 'lucide-react';
import { Glass, Pill, Segmented } from '../design/components';
import { PageHeader } from '../ui/Sheet';
import { APP_VERSION, chooseFolder, hasSavedFolderNeedingPermission, openDataFolder, reconnectFolder, suggestedFolder, useSync } from '../sync';
import { isTauri, supportsFolderAccess } from '../sync/backends';
import { checkForUpdate, type UpdateInfo } from '../sync/updater';
import { PALETTES, useTheme, type Appearance, type DarkPalette, type LightPalette } from '../app/theme';
import { useHealth, useLedger } from '../app/data';
import { backupFileText, backupIsEncrypted, restoreFromFileText } from '../sync/backup';
import { EncryptionPanel } from './EncryptionPanel';
import { LockPanel } from './LockPanel';
import { saveFile } from '../export/download';
import { todayISO } from '../lib/dates';
import { usePref } from '../app/prefs';
import { notificationsAllowed } from '../app/reminders';
import { DASH_CARDS, type FxPrefs } from '../domain/prefs';
import { formatMoney, parseAmountInput } from '../lib/money';
import { CATEGORY_GROUPS, type Category } from '../domain/schemas';
import { saveCategory } from '../db/repo';
import { rateForDay } from '../app/fx';
import { startTour } from '../app/Tour';
import { ChipGroup } from '../design/components/ChipGroup';
import { readPersisted, writePersisted } from '../app/persist';
import { RULES } from '../coach/rules';
import { COACH_DEFAULTS } from '../coach/prefs';
import type { CoachPrefs, WindfallTarget } from '../coach/types';

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const ago = (ms?: number) => {
  if (!ms) return 'never';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString('es-CR');
};

function backupLabel(n: string) {
  const m = /^(\d{4}-\d{2}-\d{2})\.aufwind$/.exec(n);
  if (m) return `Daily · ${m[1]!.split('-').reverse().join('/')}`;
  const e = /^(pre-update|pre-import|pre-restore|pre-merge|merged|corrupt)-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})/.exec(n);
  if (e) return `${{ 'pre-update': 'Before update', 'pre-import': 'Before import', 'pre-restore': 'Before restore', 'pre-merge': 'Before merge', merged: 'Merged copy', corrupt: 'Damaged copy' }[e[1]!]} · ${e[2]!.split('-').reverse().join('/')} ${e[3]}:${e[4]} UTC`;
  return n;
}

type CatId = 'coach' | 'appearance' | 'dashboard' | 'money' | 'budgets' | 'fx' | 'notifications' | 'data' | 'security' | 'updates' | 'help';
const CATS: { id: CatId; label: string; icon: LucideIcon; blurb: string; desktopOnly?: boolean }[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette, blurb: 'Themes, size, motion' },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, blurb: 'Which cards to show' },
  { id: 'coach', label: 'Coach', icon: Compass, blurb: 'Rules, tone, alerts' },
  { id: 'money', label: 'Money & targets', icon: Coins, blurb: 'Savings, payroll, rates' },
  { id: 'budgets', label: 'Budgets & categories', icon: PieChart, blurb: 'Alerts, names, groups' },
  { id: 'fx', label: 'Exchange rates', icon: DollarSign, blurb: 'BCCR and dollar expenses' },
  { id: 'notifications', label: 'Notifications', icon: Bell, blurb: 'Bills and due dates' },
  { id: 'data', label: 'Data & sync', icon: Database, blurb: 'Folder, backups, import' },
  { id: 'security', label: 'Security', icon: Shield, blurb: 'Encryption and app lock' },
  { id: 'updates', label: 'Updates', icon: RefreshCw, blurb: 'Version and updates', desktopOnly: true },
  { id: 'help', label: 'Help & about', icon: HelpCircle, blurb: 'Guided tour, shortcuts' },
];

/** A titled block inside a category. */
function Section({ title, sub, children, id }: { title: string; sub?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <Glass strong style={{ display: 'grid', gap: 12 }} id={id}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
        {sub && <p className="muted small" style={{ margin: '4px 0 0' }}>{sub}</p>}
      </div>
      {children}
    </Glass>
  );
}

/** A label + control row. */
function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="set-row">
      <div><div>{label}</div>{hint && <div className="small muted">{hint}</div>}</div>
      <div className="set-ctl">{children}</div>
    </div>
  );
}

/** Money input that saves on blur (céntimos). */
function MoneyField({ value, onSave, label }: { value: number; onSave: (v: number) => void; label: string }) {
  const [raw, setRaw] = useState(String(value / 100));
  useEffect(() => setRaw(String(value / 100)), [value]);
  return <input className="input" style={{ width: 160, textAlign: 'right' }} aria-label={label} inputMode="decimal" value={raw} onChange={(e) => setRaw(e.target.value)}
    onBlur={() => { const v = parseAmountInput(raw, 'CRC'); if (v !== null && v !== value) onSave(v); else setRaw(String(value / 100)); }} />;
}

function NumberField({ value, onSave, label, min, max, step = 1, suffix }: { value: number; onSave: (v: number) => void; label: string; min: number; max: number; step?: number; suffix?: string }) {
  const [raw, setRaw] = useState(String(value));
  useEffect(() => setRaw(String(value)), [value]);
  return <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><input className="input" style={{ width: 90, textAlign: 'right' }} aria-label={label} type="number" min={min} max={max} step={step} value={raw} onChange={(e) => setRaw(e.target.value)}
    onBlur={() => { const v = Number(raw); if (Number.isFinite(v) && v >= min && v <= max) onSave(v); else setRaw(String(value)); }} />{suffix && <span className="muted small">{suffix}</span>}</span>;
}

// ── Appearance ────────────────────────────────────────────────────────────
function AppearancePanel() {
  const { appearance: a, set, resolved } = useTheme();
  const card = (p: (typeof PALETTES)[number]) => {
    const selected = p.mode === 'light' ? a.light === p.id : a.dark === p.id;
    return (
      <button key={p.id} type="button" className={`theme-card ${selected ? 'selected' : ''}`} aria-pressed={selected}
        onClick={() => set(p.mode === 'light' ? { light: p.id as LightPalette, ...(a.mode === 'dark' ? { mode: 'light' } : {}) } : { dark: p.id as DarkPalette, ...(a.mode === 'light' ? { mode: 'dark' } : {}) })}>
        <span className="theme-preview" style={{ background: `radial-gradient(60% 80% at 20% 20%, ${p.swatch[1]}, transparent), radial-gradient(50% 70% at 85% 30%, ${p.swatch[2]}, transparent), radial-gradient(60% 70% at 50% 100%, ${p.swatch[3]}, transparent), ${p.swatch[0]}` }}>
          <span className="theme-preview-glass" data-mode={p.mode} />
        </span>
        <span className="theme-name">{p.name}{selected && <Pill tone="income">In use</Pill>}</span>
        <span className="small muted">{p.blurb}</span>
      </button>
    );
  };
  return (
    <>
      <Section title="Mode" sub={a.mode === 'auto' ? `Following Windows, now ${resolved}. Each mode keeps its own theme.` : 'Each mode keeps its own theme, so switching back and forth is one click.'}>
        <Segmented<Appearance['mode']> label="Mode" value={a.mode} onChange={(mode) => set({ mode })} options={[{ value: 'auto', label: 'Match Windows' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
      </Section>
      <Section title="Light themes">
        <div className="theme-grid">{PALETTES.filter((p) => p.mode === 'light').map(card)}</div>
      </Section>
      <Section title="Dark themes">
        <div className="theme-grid">{PALETTES.filter((p) => p.mode === 'dark').map(card)}</div>
      </Section>
      <Section title="Layout">
        <Row label="Content width" hint="Full uses the whole screen; Centered keeps lines short on very wide monitors.">
          <Segmented<Appearance['width']> label="Content width" value={a.width} onChange={(width) => set({ width })} options={[{ value: 'full', label: 'Full' }, { value: 'wide', label: 'Wide' }, { value: 'centered', label: 'Centered' }]} />
        </Row>
        <Row label="Density" hint="Compact fits more on screen.">
          <Segmented<Appearance['density']> label="Density" value={a.density} onChange={(density) => set({ density })} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
        </Row>
        <Row label="Text & control size" hint={isTauri() ? 'Auto makes everything a little larger on 2K and 4K monitors.' : 'Applies in the Windows app. In a browser, use Ctrl + and Ctrl −.'}>
          <Segmented label="Size" value={String(a.uiScale)} onChange={(v) => set({ uiScale: Number(v) })} options={[{ value: '0', label: 'Auto' }, { value: '0.9', label: 'S' }, { value: '1', label: 'M' }, { value: '1.12', label: 'L' }, { value: '1.25', label: 'XL' }]} />
        </Row>
      </Section>
      <Section title="Glass & motion">
        <Row label="Transparency" hint="Solid replaces the blur with opaque panels: easier on older GPUs and on the eyes.">
          <Segmented<Appearance['transparency']> label="Transparency" value={a.transparency} onChange={(transparency) => set({ transparency })} options={[{ value: 'auto', label: 'Glass' }, { value: 'reduced', label: 'Solid' }]} />
        </Row>
        <Row label="Animations" hint="Smooth: slow, soft transitions everywhere. Quick: the same, faster. Off: instant.">
          <Segmented<Appearance['motion']> label="Animations" value={a.motion} onChange={(motion) => set({ motion })} options={[{ value: 'smooth', label: 'Smooth' }, { value: 'quick', label: 'Quick' }, { value: 'off', label: 'Off' }]} />
        </Row>
        <p className="small muted" style={{ margin: 0 }}>Appearance is saved on this PC only, so each device can look its best.</p>
      </Section>
    </>
  );
}

function DashboardPanel() {
  const [hidden, setHidden] = usePref('dashHidden');
  return (
    <Section title="Dashboard cards" sub="Turn off the cards you don't use. The month figures at the top always show.">
      <ChipGroup<string> multi label="Show on the dashboard" aside={`${DASH_CARDS.length - hidden.length} of ${DASH_CARDS.length}`}
        value={DASH_CARDS.map((c) => c.id).filter((id) => !hidden.includes(id))} onChange={(on) => void setHidden(DASH_CARDS.map((c) => c.id).filter((id) => !on.includes(id)))}
        options={DASH_CARDS.map((c) => ({ value: c.id, label: c.label }))} spread={false} />
    </Section>
  );
}

const WINDFALL_LABEL: Record<WindfallTarget, string> = { replenish: 'Replenish self-loans', hers: 'Her loan fund', emergency: 'Emergency fund', sinking: 'Year-end funds (marchamo, December)', free: 'Free money (capped)' };

function CoachPanel() {
  const [c, setC] = usePref('coach');
  const [st, setSt] = usePref('coachState');
  const save = (patch: Partial<CoachPrefs>) => void setC({ ...c, ...patch });
  const ruleCfg = (id: string) => c.rules[id] ?? {};
  const setRule = (id: string, patch: Record<string, number | boolean>) => save({ rules: { ...c.rules, [id]: { ...ruleCfg(id), ...patch } } });
  const move = (i: number, d: -1 | 1) => { const o = [...c.windfallOrder]; const j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j]!, o[i]!]; save({ windfallOrder: o }); };
  return (
    <>
      <Section title="Coach" sub="Deterministic rules over your own data. Nothing leaves this device, and nothing changes unless you tap an action.">
        <Row label="Coach on"><input type="checkbox" aria-label="Coach on" checked={c.enabled} onChange={(e) => save({ enabled: e.target.checked })} /></Row>
        <Row label="Tone" hint="Direct: blunt, numbers first. Gentle: same numbers, softer words.">
          <Segmented<CoachPrefs['tone']> label="Tone" value={c.tone} onChange={(tone) => save({ tone })} options={[{ value: 'direct', label: 'Direct' }, { value: 'gentle', label: 'Gentle' }]} />
        </Row>
        <Row label="Buffer" hint="Kept aside in safe-to-spend and the forecast."><MoneyField label="Buffer" value={c.buffer} onSave={(v) => save({ buffer: v })} /></Row>
        <Row label="Work hours per month" hint="For “≈ N hours of work” next to purchases."><NumberField label="Work hours" value={c.workHoursPerMonth} min={40} max={320} onSave={(v) => save({ workHoursPerMonth: v })} /></Row>
        <Row label="Show hours of work from"><MoneyField label="Hours note threshold" value={c.hoursNoteMin} onSave={(v) => save({ hoursNoteMin: v })} /></Row>
      </Section>
      <Section title="Alerts on your desktop" sub="Only warnings and critical alerts are pushed. Everything else waits in the Inbox.">
        <Row label="Send notifications"><input type="checkbox" aria-label="Send notifications" checked={c.push} onChange={async (e) => { if (e.target.checked && !(await notificationsAllowed(true))) return; save({ push: e.target.checked }); }} /></Row>
        <Row label="At most per day"><NumberField label="Pushes per day" value={c.maxPushPerDay} min={0} max={10} onSave={(v) => save({ maxPushPerDay: v })} /></Row>
        <Row label="Quiet hours" hint="No notifications in this window.">
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><NumberField label="Quiet from" value={c.quietStart} min={0} max={23} suffix=":00 to" onSave={(v) => save({ quietStart: v })} /><NumberField label="Quiet until" value={c.quietEnd} min={0} max={23} suffix=":00" onSave={(v) => save({ quietEnd: v })} /></span>
        </Row>
        <Row label="Repeat a warning after"><NumberField label="Warning cooldown" value={c.cooldownWarningDays} min={1} max={30} suffix="days" onSave={(v) => save({ cooldownWarningDays: v })} /></Row>
        <Row label="Repeat a critical alert after"><NumberField label="Critical cooldown" value={c.cooldownCriticalDays} min={1} max={30} suffix="days" onSave={(v) => save({ cooldownCriticalDays: v })} /></Row>
      </Section>
      <Section title="Cooling-off list">
        <Row label="Wait for items from"><MoneyField label="Cooling-off minimum" value={c.coolingMin} onSave={(v) => save({ coolingMin: v })} /></Row>
        <Row label="…for"><NumberField label="Short wait" value={c.coolingShortHours} min={1} max={240} suffix="hours" onSave={(v) => save({ coolingShortHours: v })} /></Row>
        <Row label="Longer wait from"><MoneyField label="Long wait threshold" value={c.coolingLong} onSave={(v) => save({ coolingLong: v })} /></Row>
        <Row label="…for"><NumberField label="Long wait" value={c.coolingLongDays} min={1} max={60} suffix="days" onSave={(v) => save({ coolingLongDays: v })} /></Row>
      </Section>
      <Section title="Windfall splitter" sub="When extra money arrives (aguinaldo, quinquenio, a sale), the Coach proposes a split in this order. Anything left after every need goes to the emergency fund.">
        <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
          {c.windfallOrder.map((t, i) => (
            <li key={t} className="check-card" style={{ justifyContent: 'space-between' }}>
              <span><b>{i + 1}.</b> {WINDFALL_LABEL[t]}</span>
              <span><button className="icon-btn" aria-label={`Move ${WINDFALL_LABEL[t]} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={16} /></button><button className="icon-btn" aria-label={`Move ${WINDFALL_LABEL[t]} down`} disabled={i === c.windfallOrder.length - 1} onClick={() => move(i, 1)}><ArrowDown size={16} /></button></span>
            </li>
          ))}
        </ol>
        <Row label="Free money at most"><NumberField label="Free money cap" value={Math.round(c.windfallFreeMaxPct * 100)} min={0} max={100} suffix="%" onSave={(v) => save({ windfallFreeMaxPct: v / 100 })} /></Row>
      </Section>
      <Section title="Rules" sub={<>Turn rules on or off and tune their thresholds. Marking an alert “not useful” 3 times halves that rule's weight. <button className="btn btn-ghost btn-sm" onClick={() => void setSt({ ...st, notUseful: {}, weights: {} })}>Reset weights</button> <button className="btn btn-ghost btn-sm" onClick={() => save({ rules: {} })}>Reset thresholds</button></>}>
        <div style={{ display: 'grid', gap: 10 }}>
          {RULES.map((r) => {
            const cfg = ruleCfg(r.id);
            const on = cfg.on !== false;
            const votes = st.notUseful[r.id] ?? 0;
            return (
              <div key={r.id} className="rule-row" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <input type="checkbox" style={{ marginTop: 4 }} aria-label={`${r.name} on`} checked={on} onChange={(e) => setRule(r.id, { on: e.target.checked })} />
              <details style={{ flex: 1 }}>
                <summary>
                  <span style={{ flex: 1 }}><b>{r.id} · {r.name}</b><br /><span className="small muted">{r.trigger}</span></span>
                  {votes > 0 && <Pill>{votes} not useful · weight {Math.pow(0.5, Math.floor(votes / 3))}</Pill>}
                </summary>
                {Object.keys(r.defaults).length > 0 && (
                  <div style={{ display: 'grid', gap: 4, padding: '8px 0 4px' }}>
                    {Object.entries(r.defaults).map(([k, def]) => {
                      const val = typeof cfg[k] === 'number' ? (cfg[k] as number) : def;
                      const money = /marchamo|december/.test(k);
                      const label = (r.labels as Record<string, string> | undefined)?.[k] ?? k;
                      return <Row key={k} label={label} hint={`Default ${money ? formatMoney(def as never, 'CRC') : def}`}>{money ? <MoneyField label={label} value={val} onSave={(v) => setRule(r.id, { [k]: v })} /> : <NumberField label={label} value={val} min={0} max={100000} step={def % 1 ? 0.01 : 1} onSave={(v) => setRule(r.id, { [k]: v })} />}</Row>;
                    })}
                  </div>
                )}
              </details>
              </div>
            );
          })}
        </div>
      </Section>
      <p className="small muted">Defaults: buffer {formatMoney(COACH_DEFAULTS.buffer as never, 'CRC')}, {COACH_DEFAULTS.workHoursPerMonth} h/month, quiet {COACH_DEFAULTS.quietStart}:00–{COACH_DEFAULTS.quietEnd}:00, max {COACH_DEFAULTS.maxPushPerDay} pushes a day.</p>
    </>
  );
}

function MoneyPanel() {
  const [rate, setRate] = usePref('savingsRateTarget');
  const [ef, setEf] = usePref('efTargetMonths');
  const [payroll, setPayroll] = usePref('payroll');
  const [calc, setCalc] = usePref('calcRates');
  return (
    <>
      <Section title="Targets">
        <Row label="Savings rate target" hint="Share of income you aim to save each month."><NumberField label="Savings rate target" value={Math.round(rate * 100)} min={0} max={90} suffix="%" onSave={(v) => void setRate(v / 100)} /></Row>
        <Row label="Emergency fund target" hint="Months of essential spending."><NumberField label="Emergency fund months" value={ef} min={1} max={24} suffix="months" onSave={(v) => void setEf(v)} /></Row>
      </Section>
      <Section title="Payroll" sub="Used for savings suggestions in Bills and the payroll savings floor in Savings & goals.">
        <Row label="My savings per quincena"><MoneyField label="My savings per quincena" value={payroll.mySavingsPerQuincena} onSave={(v) => void setPayroll({ ...payroll, mySavingsPerQuincena: v })} /></Row>
        <Row label="Association plan per quincena"><MoneyField label="Association plan per quincena" value={payroll.associationPerQuincena} onSave={(v) => void setPayroll({ ...payroll, associationPerQuincena: v })} /></Row>
        <Row label="Aporte obrero (monthly)"><MoneyField label="Aporte obrero" value={payroll.aporteObreroMonthly} onSave={(v) => void setPayroll({ ...payroll, aporteObreroMonthly: v })} /></Row>
        <Row label="Aporte patronal (monthly)"><MoneyField label="Aporte patronal" value={payroll.aportePatronalMonthly} onSave={(v) => void setPayroll({ ...payroll, aportePatronalMonthly: v })} /></Row>
      </Section>
      <Section title="Calculator rates" sub="Defaults for the CDP and programmed-savings calculators. Check your bank's current rates.">
        <Row label="CDP annual rate"><NumberField label="CDP annual rate" value={calc.cdpAnnualRatePct} min={0} max={30} step={0.05} suffix="%" onSave={(v) => void setCalc({ ...calc, cdpAnnualRatePct: v, cdpVerifiedOn: todayISO() })} /></Row>
        <Row label="Programmed savings annual rate"><NumberField label="Programmed savings rate" value={calc.programmedAnnualRatePct} min={0} max={30} step={0.05} suffix="%" onSave={(v) => void setCalc({ ...calc, programmedAnnualRatePct: v, programmedVerifiedOn: todayISO() })} /></Row>
        <Row label="Tax withheld on interest"><NumberField label="Withholding" value={calc.withholdingPct} min={0} max={50} step={0.5} suffix="%" onSave={(v) => void setCalc({ ...calc, withholdingPct: v })} /></Row>
      </Section>
    </>
  );
}

function BudgetsPanel() {
  const [warn, setWarn] = usePref('budgetWarnPct');
  const l = useLedger();
  const [showArchived, setShowArchived] = useState(false);
  const cats = l.categories.filter((c) => showArchived || !c.archived);
  const update = (c: Category, patch: Partial<Category>) => void saveCategory({ ...c, ...patch, updatedAt: Date.now() });
  return (
    <>
      <Section title="Budget alerts">
        <Row label="Warn me at" hint="Tracker and Dashboard flag a category when it reaches this share of its budget; 100% is always flagged.">
          <NumberField label="Budget warning threshold" value={Math.round(warn * 100)} min={50} max={99} suffix="% of budget" onSave={(v) => void setWarn(v / 100)} />
        </Row>
        <p className="small muted" style={{ margin: 0 }}>Budget amounts are set per category and month in <Link to="/tracker">Budget → Tracker</Link>: click any amount.</p>
      </Section>
      <Section title="Categories" sub="Rename, regroup, mark as avoidable (used by insights), or archive a category you no longer use. History keeps its category.">
        <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Group</th><th>Avoidable</th><th>Archived</th></tr></thead>
            <tbody>
              {cats.map((c) => (
                <tr key={c.id} style={{ opacity: c.archived ? 0.55 : 1 }}>
                  <td><input className="input" aria-label={`Name of ${c.name}`} defaultValue={c.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.name) update(c, { name: v }); else e.target.value = c.name; }} /></td>
                  <td><select className="input" aria-label={`Group of ${c.name}`} value={c.group} onChange={(e) => update(c, { group: e.target.value as Category['group'] })}>{CATEGORY_GROUPS.map((g) => <option key={g}>{g}</option>)}</select></td>
                  <td><input type="checkbox" aria-label={`${c.name} is avoidable`} checked={c.discretionary} onChange={(e) => update(c, { discretionary: e.target.checked })} /></td>
                  <td><input type="checkbox" aria-label={`Archive ${c.name}`} checked={c.archived} onChange={(e) => update(c, { archived: e.target.checked })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

function FxPanel() {
  const [fx, setFx] = usePref('fx');
  const [test, setTest] = useState<string>('');
  const save = (patch: Partial<FxPrefs>) => void setFx({ ...fx, ...patch });
  return (
    <>
      <Section title="Dollar expenses" sub="When you add an expense in dollars, Aufwind converts it to colones at the rate of the day it was made. The rate, its date and source are saved with the expense, and you can always type your own (e.g. the exact rate on your card statement).">
        <Row label="Where rates come from">
          <Segmented<FxPrefs['source']> label="Rate source" value={fx.source} onChange={(source) => save({ source })} options={[{ value: 'auto', label: 'BCCR, then market' }, { value: 'bccr', label: 'BCCR only' }, { value: 'market', label: 'Market only' }, { value: 'manual', label: 'I type it' }]} />
        </Row>
        <Row label="Which BCCR rate" hint="Card purchases in dollars are usually charged near the sell (venta) rate.">
          <Segmented<FxPrefs['side']> label="BCCR side" value={fx.side} onChange={(side) => save({ side })} options={[{ value: 'sell', label: 'Sell (venta)' }, { value: 'buy', label: 'Buy (compra)' }]} />
        </Row>
      </Section>
      <Section title="BCCR web service" sub={<>The Banco Central publishes the official rate for free. Subscribe once at <b>gee.bccr.fi.cr → Indicadores → Servicio web</b>; they email you a token. Without it, Aufwind uses a free market rate, which is close to but not exactly BCCR's.</>}>
        <Row label="Name"><input className="input" aria-label="BCCR name" defaultValue={fx.bccrName} onBlur={(e) => save({ bccrName: e.target.value.trim() })} /></Row>
        <Row label="Email you subscribed with"><input className="input" type="email" aria-label="BCCR email" defaultValue={fx.bccrEmail} onBlur={(e) => save({ bccrEmail: e.target.value.trim() })} /></Row>
        <Row label="Token" hint="Stored in your data file (encrypted if you turned encryption on)."><input className="input" aria-label="BCCR token" defaultValue={fx.bccrToken} autoComplete="off" spellCheck={false} onBlur={(e) => save({ bccrToken: e.target.value.trim() })} /></Row>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn" onClick={async () => { setTest('Checking…'); try { const q = await rateForDay(todayISO(), fx); setTest(q ? `${q.source === 'BCCR' ? 'BCCR' : 'Market'} rate for ${q.rateDate.split('-').reverse().join('/')}: ${formatMoney(q.rate, 'CRC')} per $1` : 'No rate available right now. You can still type rates by hand.'); } catch (e) { setTest(`Failed: ${e}`); } }}>Test: get today's rate</button>
          {test && <span className="small" role="status">{test}</span>}
        </div>
      </Section>
    </>
  );
}

function NotificationsPanel({ onMsg }: { onMsg: (m: string) => void }) {
  const [notify, setNotify] = usePref('notifyBills');
  return (
    <Section title="Reminders" sub={isTauri() ? 'Shown in the Windows notification center while Aufwind is open or minimized.' : 'In the browser, notifications only appear while Aufwind is open in a tab.'}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={notify} onChange={async (e) => { if (e.target.checked) { const ok = await notificationsAllowed(true); if (!ok) { onMsg('Notifications are blocked. Allow them for Aufwind in your system settings.'); return; } } await setNotify(e.target.checked); }} />
        Notify me about bills, card due dates and pay due today or tomorrow, and about items waiting for confirmation
      </label>
    </Section>
  );
}

function DataPanel({ run }: { run: (label: string, fn: () => Promise<unknown>) => Promise<void> }) {
  const { engine, status } = useSync();
  const [backups, setBackups] = useState<string[]>([]);
  const [suggest, setSuggest] = useState<string | null>(null);
  const [needsPerm, setNeedsPerm] = useState(false);
  const health = useHealth();
  useEffect(() => { void suggestedFolder().then(setSuggest); void hasSavedFolderNeedingPermission().then(setNeedsPerm); }, []);
  useEffect(() => { if (engine) void engine.listBackups().then(setBackups); }, [engine, status?.revision]);
  return (
    <>
      <Section title="Data folder" sub={<>Your data is saved as one file, <code>aufwind-data.aufwind</code>, in a folder you choose. Put it in OneDrive and it's backed up and shared between your PCs. Daily backups live in its <code>backups</code> subfolder.</>}>
        {!engine && !needsPerm && (
          isTauri() || (supportsFolderAccess() && !isIOS()) ? (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {suggest && <button className="btn btn-primary" onClick={() => void run('Data folder set', () => chooseFolder(suggest))}>Use {suggest}</button>}
              <button className={`btn ${suggest ? '' : 'btn-primary'}`} onClick={() => void run('Data folder set', () => chooseFolder())}>Choose folder…</button>
            </div>
          ) : <Pill tone="debt">This browser can't save to a folder. Use the Windows app, or Chrome/Edge.</Pill>
        )}
        {needsPerm && <button className="btn btn-primary" onClick={() => void run('Reconnected', reconnectFolder)}>Reconnect data folder</button>}
        {engine && status && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px' }} className="small">
              <span className="muted">Location</span><code style={{ wordBreak: 'break-all' }}>{status.location}</code>
              <span className="muted">Status</span>
              <span>{status.phase === 'locked' ? <Pill tone="debt">Encrypted: enter the password in Security</Pill> : status.phase === 'error' ? <Pill tone="expense">{status.message}</Pill> : status.phase === 'syncing' ? 'Saving…' : status.dirty ? 'Changes waiting to save' : <Pill tone="income">✓ Saved {ago(status.lastSyncedAt)}</Pill>}</span>
              <span className="muted">Revision</span><span>{status.revision ?? '—'}{status.lastRemoteDevice && <span className="muted"> · last change from {status.lastRemoteDevice}</span>}</span>
            </div>
            {status.conflicts.length > 0 && <Pill tone="debt">{status.conflicts.length} record(s) were edited on two devices. The newer edit was kept, and the vault before the merge is in backups.</Pill>}
            {status.conflictedCopies.map((c) => (
              <div key={c} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <Pill tone="debt">OneDrive made a conflict copy: {c}</Pill>
                <button className="btn btn-sm" onClick={() => void run('Copy merged', () => engine.mergeConflictedCopy(c))}>Merge it in</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => void run('Saved', () => engine.syncNow())}>Save now</button>
              {isTauri() && <button className="btn" onClick={() => void openDataFolder()}>Open folder</button>}
              <button className="btn btn-ghost" onClick={() => void run('Data folder changed', () => chooseFolder())}>Change folder…</button>
            </div>
          </>
        )}
      </Section>

      {engine && (
        <Section title="Backups" sub="Kept: the last 30 days, the first of each month for a year, and the last 20 safety copies (before imports, updates, restores). Restoring makes that backup the data on every device; the current data is backed up first.">
          {backups.length === 0 ? <p className="muted" style={{ margin: 0 }}>None yet. The first daily backup appears tomorrow.</p> : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6, maxHeight: 320, overflow: 'auto' }}>
              {backups.map((b) => (
                <li key={b} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <span>{backupLabel(b)}</span>
                  <button className="btn btn-sm" onClick={() => { if (confirm(`Restore "${backupLabel(b)}" on all devices? Your current data is backed up first.`)) void run('Restored', () => engine.restore(b)); }}>Restore</button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      <Section title="Backup file" sub="A complete copy of your data in one file, the same format as the data folder. Restoring replaces the data on every synced device; your current data is backed up first when a folder is set.">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => void run('Backup saved', async () => saveFile(`Aufwind_backup_${todayISO()}.aufwind`, await backupFileText(), 'application/json'))}>Download backup</button>
          <label className="btn">Restore from file…<input type="file" accept=".aufwind,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f && confirm(`Replace all current data with "${f.name}"?`)) void run('Restored from file', async () => { const text = await f.text(); const pw = backupIsEncrypted(text) ? prompt('This backup is encrypted. Enter its data password:') ?? '' : undefined; return restoreFromFileText(text, pw); }); e.target.value = ''; }} /></label>
        </div>
      </Section>

      <Section title="Import workbook" sub="Bring in the Excel workbook you used before. It's previewed and checked against its own Tracker first, and every import can be undone.">
        <Link to="/import" className="btn" style={{ justifySelf: 'start' }}>Open import…</Link>
      </Section>

      <Section title="Data health" id="health">
        {health.length === 0 ? <Pill tone="income">✓ Nothing to check. Totals, funds, debts and statements agree.</Pill> : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
            {health.map((h) => (
              <li key={h.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                <Pill tone={h.level === 'error' ? 'expense' : h.level === 'warn' ? 'debt' : 'neutral'}>{h.level === 'error' ? 'fix' : h.level === 'warn' ? 'check' : 'info'}</Pill>
                <span><b>{h.title}</b><br /><span className="small muted">{h.detail}</span> <Link className="small" to={h.to}>Go →</Link></span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function SecurityPanel() {
  const { engine, status } = useSync();
  return (
    <>
      {engine && status ? <EncryptionPanel /> : <Section title="Encryption" sub="Choose a data folder first (Data & sync); then you can encrypt the data file with a password." ><span /></Section>}
      <LockPanel />
    </>
  );
}

function UpdatesPanel({ onMsg }: { onMsg: (m: string) => void }) {
  const [upd, setUpd] = useState<UpdateInfo | null | 'none' | 'checking'>(null);
  const [pct, setPct] = useState<number | null>(null);
  return (
    <Section title="Updates" sub="Aufwind checks for updates on start and every 6 hours. Updates are signed; anything that fails the signature check is discarded. Your data is backed up before installing.">
      <Row label="Installed version"><b>{APP_VERSION}</b></Row>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn" disabled={upd === 'checking'} onClick={async () => { setUpd('checking'); try { setUpd((await checkForUpdate()) ?? 'none'); } catch (e) { setUpd(null); onMsg(`Update check failed: ${e}`); } }}>Check now</button>
        {upd === 'none' && <Pill tone="income">You're on the latest version</Pill>}
        {upd && typeof upd === 'object' && (
          <>
            <Pill tone="savings">Version {upd.version} available</Pill>
            <button className="btn btn-primary" disabled={pct !== null} onClick={() => void upd.install(setPct)}>{pct === null ? 'Install & restart' : `Installing ${pct}%`}</button>
          </>
        )}
      </div>
      {upd && typeof upd === 'object' && upd.notes && <pre style={{ whiteSpace: 'pre-wrap', font: 'inherit', margin: 0 }} className="small">{upd.notes}</pre>}
    </Section>
  );
}

function HelpPanel() {
  const keys: [string, string][] = [['N', 'Quick add'], ['Ctrl K', 'Search pages and run commands'], ['Esc', 'Close a sheet or dialog'], ['← →', 'Move through the guided tour']];
  return (
    <>
      <Section title="Guided tour" sub="A short walk through every section: what it's for and how to use it.">
        <button className="btn btn-primary" style={{ justifySelf: 'start' }} onClick={() => startTour()}>Start the tour</button>
      </Section>
      <Section title="Keyboard shortcuts">
        <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '8px 18px' }}>
          {keys.map(([k, v]) => <Fragment key={k}><kbd className="kbd">{k}</kbd><span>{v}</span></Fragment>)}
        </div>
      </Section>
      <Section title="About Aufwind" sub="Rise on what you already have.">
        <p className="small" style={{ margin: 0 }}>Version {APP_VERSION}{isTauri() ? ' · Windows app' : ' · web'}. Your data stays on your devices and in the folder you choose; nothing is sent anywhere, except asking BCCR or the market-rate service for an exchange rate when you add a dollar expense.</p>
      </Section>
    </>
  );
}

export default function Settings() {
  const loc = useLocation();
  const nav = useNavigate();
  const { dur } = useTheme();
  const cats = CATS.filter((c) => !c.desktopOnly || isTauri());
  const fromUrl = new URLSearchParams(loc.search).get('c') as CatId | null;
  const lastCat = readPersisted<CatId>('settings.cat', 'appearance');
  const cat: CatId = loc.hash === '#health' ? 'data' : fromUrl && cats.some((c) => c.id === fromUrl) ? fromUrl : cats.some((c) => c.id === lastCat) ? lastCat : 'appearance';
  useEffect(() => writePersisted('settings.cat', cat), [cat]);
  const [msg, setMsg] = useState('');
  const current = cats.find((c) => c.id === cat)!;

  useEffect(() => { if (loc.hash) setTimeout(() => document.querySelector(loc.hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400); }, [loc.hash]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setMsg('');
    try { await fn(); setMsg(label); } catch (e) { setMsg(`Failed: ${e instanceof Error ? e.message : e}`); }
  }

  return (
    <>
      <PageHeader title="Settings" sub={`Aufwind ${APP_VERSION}${isTauri() ? ' · Windows app' : ' · web'}`} />
      <div className="settings-layout">
        <nav className="glass settings-cats" aria-label="Settings categories">
          {cats.map((c) => {
            const Icon = c.icon;
            const active = c.id === cat;
            return (
              <button key={c.id} type="button" className={`settings-cat ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} onClick={() => { setMsg(''); nav(`/settings?c=${c.id}`, { replace: true }); }}>
                {active && <motion.span layoutId="settings-cat-pill" className="settings-cat-pill" transition={{ type: 'spring', stiffness: 380, damping: 34, duration: dur(0.5) }} />}
                <Icon size={18} aria-hidden style={{ position: 'relative' }} />
                <span style={{ position: 'relative', display: 'grid' }}>{c.label}<small className="muted">{c.blurb}</small></span>
              </button>
            );
          })}
        </nav>
        <div style={{ minWidth: 0 }}>
          {msg && <Glass strong pad={14} style={{ marginBottom: 16 }} role="status">{msg}</Glass>}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={cat} className="settings-panel stagger" aria-label={current.label}
              initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0, transition: { duration: dur(0.45), ease: [0.2, 0.8, 0.2, 1] } }} exit={{ opacity: 0, x: -10, transition: { duration: dur(0.2) } }}>
              {cat === 'appearance' && <AppearancePanel />}
              {cat === 'dashboard' && <DashboardPanel />}
              {cat === 'coach' && <CoachPanel />}
              {cat === 'money' && <MoneyPanel />}
              {cat === 'budgets' && <BudgetsPanel />}
              {cat === 'fx' && <FxPanel />}
              {cat === 'notifications' && <NotificationsPanel onMsg={setMsg} />}
              {cat === 'data' && <DataPanel run={run} />}
              {cat === 'security' && <SecurityPanel />}
              {cat === 'updates' && <UpdatesPanel onMsg={setMsg} />}
              {cat === 'help' && <HelpPanel />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}
