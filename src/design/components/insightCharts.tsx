/**
 * Insight charts: month waterfall, spending pace, daily spending calendar.
 * Every chart has a hover layer, a Table view, and clicks through to the filtered Transactions.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useCssVar, useTheme } from '../../app/theme';
import { DataTable, fmt, fmtShort } from './charts';
import { Segmented } from '.';
import type { WaterStep } from '../../domain/spending';
import { usePersisted } from '../../app/persist';

function Frame({ title, sub, children, table }: { title: string; sub?: ReactNode; children: ReactNode; table: ReactNode }) {
  const [view, setView] = usePersisted<'chart' | 'table'>(`view.${title}`, 'chart');
  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ display: 'grid' }}><span style={{ fontWeight: 700, fontSize: 17 }}>{title}</span>{sub && <span className="small muted">{sub}</span>}</span>
        <Segmented label={`${title} view`} value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />
      </figcaption>
      {view === 'chart' ? children : table}
    </figure>
  );
}

const Tip = ({ title, rows }: { title: string; rows: [string, string, string?][] }) => (
  <div className="glass glass-strong" style={{ padding: '10px 14px', borderRadius: 14, fontSize: 13, minWidth: 180 }}>
    <div style={{ fontWeight: 700, marginBottom: 6 }}>{title}</div>
    {rows.map(([k, v, c]) => (
      <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {c && <span style={{ width: 10, height: 10, borderRadius: 3, background: c }} aria-hidden />}
        <span style={{ color: 'var(--text-2)' }}>{k}</span>
        <span className="money" style={{ marginLeft: 'auto', fontWeight: 600, paddingLeft: 12 }}>{v}</span>
      </div>
    ))}
  </div>
);

const Legend = ({ items }: { items: { label: string; color: string | undefined; dashed?: boolean }[] }) => (
  <ul style={{ display: 'flex', gap: 16, flexWrap: 'wrap', listStyle: 'none', margin: '8px 0 0', padding: 0, fontSize: 13, color: 'var(--text-2)' }}>
    {items.map((i) => (
      <li key={i.label} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span aria-hidden style={{ width: 16, height: 0, borderTop: `2px ${i.dashed ? 'dashed' : 'solid'} ${i.color}` }} />{i.label}
      </li>
    ))}
  </ul>
);

// ── Waterfall ─────────────────────────────────────────────────────────────
export function MonthWaterfall({ steps, month, title = 'Where the month’s money went' }: { steps: WaterStep[]; month: string; title?: string }) {
  const nav = useNavigate();
  const reduce = useReducedMotion();
  const [inc, exp, sav, axis, grid, text3] = useCssVar(['--chart-income', '--chart-expense', '--chart-1', '--chart-axis', '--chart-grid', '--text-3']);
  const color = (s: WaterStep) => (s.kind === 'start' ? inc : s.kind === 'subtotal' || s.kind === 'end' ? text3 : s.group === 'Savings' ? sav : exp);
  const data = steps.map((s) => ({ ...s, range: [s.lo, s.hi] as [number, number] }));
  const open = (s: WaterStep) => {
    if (s.group === 'Savings') nav(`/transactions?month=${month}&kind=savings`);
    else if (s.group) nav(`/transactions?month=${month}&group=${encodeURIComponent(s.group)}`);
    else if (s.kind === 'start') nav(`/transactions?month=${month}&kind=income`);
  };
  return (
    <Frame title={title} sub="Income, minus each kind of spending and what you saved, down to free cash. Click a bar to see its movements."
      table={<DataTable caption={title} columns={['Step', 'Amount']} rows={steps.map((s) => [s.name, s.value])} />}>
      <div style={{ height: 280 }} role="img" aria-label={`${title}. ${steps.map((s) => `${s.name} ${fmt(s.value)}`).join(', ')}.`}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={grid} />
            <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: axis, fontSize: 12 }} interval={0} />
            <YAxis tickFormatter={fmtShort} tickLine={false} axisLine={false} width={60} tick={{ fill: axis, fontSize: 12 }} />
            <ReferenceLine y={0} stroke={axis} strokeOpacity={0.5} />
            <Tooltip cursor={{ fill: 'var(--accent-soft)', radius: 8 } as object}
              content={({ active, payload }) => active && payload?.[0] ? (() => { const s = payload[0].payload as WaterStep; return <Tip title={s.name} rows={[[s.kind === 'down' ? 'Takes away' : 'Total', fmt(s.value), color(s)], ...(s.kind === 'down' ? [['Left after', fmt(s.value < 0 ? s.lo : s.hi)] as [string, string]] : [])]} />; })() : null} />
            <Bar dataKey="range" radius={4} isAnimationActive={!reduce} onClick={(d) => open(d as unknown as WaterStep)} style={{ cursor: 'pointer' }}>
              {data.map((s) => <Cell key={s.name} fill={color(s)} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Legend items={[{ label: 'Income', color: inc }, { label: 'Spending', color: exp }, { label: 'Saved', color: sav }, { label: 'Totals', color: text3 }]} />
    </Frame>
  );
}

// ── Pace ──────────────────────────────────────────────────────────────────
export function SpendingPace({ month, days, today, thisMonth, lastMonth, budget, label }: {
  month: string; days: number; today: number; thisMonth: number[]; lastMonth: number[]; budget: number; label: string;
}) {
  const nav = useNavigate();
  const reduce = useReducedMotion();
  const [exp, axis, grid, text3, accent] = useCssVar(['--chart-expense', '--chart-axis', '--chart-grid', '--text-3', '--chart-1']);
  const data = Array.from({ length: days }, (_, i) => ({
    day: i + 1,
    now: i < thisMonth.length ? thisMonth[i] : undefined,
    last: lastMonth[Math.min(i, lastMonth.length - 1)],
    budget: budget ? Math.round((budget * (i + 1)) / days) : undefined,
  }));
  const spent = thisMonth.at(-1) ?? 0;
  const projected = today ? Math.round((spent / today) * days) : 0;
  const title = 'Spending pace';
  return (
    <Frame title={title} sub={<>{label}. At this pace: <b className="money">{fmt(projected)}</b>{budget ? <> vs a <b className="money">{fmt(budget)}</b> budget</> : null}. Click a day to see it.</>}
      table={<DataTable caption={title} columns={['Day', 'This month', 'Last month', 'Budget pace']} rows={data.filter((d) => d.day <= today || d.day % 5 === 0).map((d) => [String(d.day), d.now ?? '—', d.last ?? 0, d.budget ?? '—'])} />}>
      {spent === 0 && today > 0 ? (
        <p className="muted" style={{ margin: '8px 0 0', minHeight: 200, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
          No dated spending this month yet. Rows imported from the workbook have no day, so pace starts with what you log from now on.
        </p>
      ) : <>
      <div style={{ height: 260 }} role="img" aria-label={`${title}: spent ${fmt(spent)} by day ${today}; projected ${fmt(projected)}${budget ? ` against ${fmt(budget)}` : ''}.`}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            onClick={(e) => { const d = (e as { activeLabel?: number } | null)?.activeLabel; if (d && d <= today) nav(`/transactions?date=${month}-${String(d).padStart(2, '0')}`); }}>
            <CartesianGrid vertical={false} stroke={grid} />
            <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: axis, fontSize: 12 }} ticks={[1, 5, 10, 15, 20, 25, days]} />
            <YAxis tickFormatter={fmtShort} tickLine={false} axisLine={false} width={60} tick={{ fill: axis, fontSize: 12 }} />
            <Tooltip cursor={{ stroke: axis, strokeDasharray: '3 3' }}
              content={({ active, payload, label: d }) => active && payload?.length ? (
                <Tip title={`Day ${d}`} rows={[
                  ...(payload.find((p) => p.dataKey === 'now') ? [['This month', fmt(Number(payload.find((p) => p.dataKey === 'now')!.value)), exp] as [string, string, string]] : []),
                  ['Last month', fmt(Number(payload.find((p) => p.dataKey === 'last')?.value ?? 0)), text3],
                  ...(budget ? [['Budget pace', fmt(Number(payload.find((p) => p.dataKey === 'budget')?.value ?? 0)), accent] as [string, string, string]] : []),
                ]} />) : null} />
            {budget > 0 && <Line dataKey="budget" name="Budget pace" stroke={accent} strokeWidth={2} strokeDasharray="6 5" dot={false} isAnimationActive={!reduce} />}
            <Line dataKey="last" name="Last month" stroke={text3} strokeWidth={2} dot={false} isAnimationActive={!reduce} />
            <Line dataKey="now" name="This month" stroke={exp} strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={!reduce} />
            <ReferenceLine x={today} stroke={axis} strokeOpacity={0.35} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <Legend items={[{ label: 'This month', color: exp }, { label: 'Last month', color: text3 }, ...(budget ? [{ label: 'Budget pace', color: accent, dashed: true }] : [])]} />
      </>}
    </Frame>
  );
}

// ── Calendar heatmap ──────────────────────────────────────────────────────
const SEQ_LIGHT = ['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'];
const SEQ_DARK = ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#b7d3f6'];
const DOW = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'];
const MS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function SpendingCalendar({ byDay, to, weeks = 26, estimated }: { byDay: Map<string, number>; to: string; weeks?: number; estimated: number }) {
  const nav = useNavigate();
  const { resolved } = useTheme();
  const ramp = resolved === 'dark' ? SEQ_DARK : SEQ_LIGHT;
  const [hover, setHover] = useState<{ d: string; v: number; x: number; y: number } | null>(null);
  const { cells, thresholds, months } = useMemo(() => {
    const end = new Date(`${to}T00:00:00Z`);
    const dow = (end.getUTCDay() + 6) % 7; // Monday = 0
    const start = new Date(end); start.setUTCDate(end.getUTCDate() - dow - (weeks - 1) * 7);
    const cells: { d: string; v: number; w: number; r: number }[] = [];
    const months: { w: number; label: string }[] = [];
    for (let i = 0; ; i++) {
      const t = new Date(start); t.setUTCDate(start.getUTCDate() + i);
      if (t > end) break;
      const d = t.toISOString().slice(0, 10);
      const w = Math.floor(i / 7), r = i % 7;
      if ((t.getUTCDate() === 1 || i === 0) && !(months.length && w - months.at(-1)!.w < 3)) months.push({ w, label: MS[t.getUTCMonth()]! });
      else if (t.getUTCDate() === 1 && months.length && w - months.at(-1)!.w < 3) months[months.length - 1] = { w, label: MS[t.getUTCMonth()]! };
      cells.push({ d, v: byDay.get(d) ?? 0, w, r });
    }
    // Quantile buckets over spending days, so one huge day doesn't wash out the rest.
    const vals = cells.map((c) => c.v).filter((v) => v > 0).sort((a, b) => a - b);
    const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] ?? 0;
    return { cells, thresholds: [q(0.2), q(0.4), q(0.6), q(0.8)], months };
  }, [byDay, to, weeks]);
  const bucket = (v: number) => (v <= 0 ? -1 : thresholds.filter((t) => v > t).length);
  const S = 16, G = 3, L = 30, T = 18;
  const W = L + weeks * (S + G), H = T + 7 * (S + G);
  const total = cells.reduce((s, c) => s + c.v, 0);
  const active = cells.filter((c) => c.v > 0).length;
  const title = 'Daily spending';
  return (
    <Frame title={title} sub={<>Last {weeks} weeks · {fmt(total)} over {active} spending days{estimated ? ` · ${estimated} undated workbook rows not placed on a day` : ''}. Click a day to see it.</>}
      table={<DataTable caption={title} columns={['Day', 'Spent']} rows={cells.filter((c) => c.v > 0).reverse().slice(0, 60).map((c) => [c.d.split('-').reverse().join('/'), c.v])} />}>
      <div style={{ position: 'relative', overflowX: 'auto' }} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', minWidth: 640 }} role="img" aria-label={`${title}: ${fmt(total)} over ${active} days. Switch to Table for each day.`}>
          {months.map((m) => <text key={`${m.w}${m.label}`} x={L + m.w * (S + G)} y={11} fontSize={11} fill="var(--text-3)">{m.label}</text>)}
          {DOW.map((d, i) => d && <text key={d} x={0} y={T + i * (S + G) + 12} fontSize={10} fill="var(--text-3)">{d}</text>)}
          {cells.map((c) => {
            const b = bucket(c.v);
            return (
              <rect key={c.d} x={L + c.w * (S + G)} y={T + c.r * (S + G)} width={S} height={S} rx={4}
                fill={b < 0 ? 'var(--input-bg)' : ramp[b]} stroke={hover?.d === c.d ? 'var(--text)' : 'none'} strokeWidth={1.5}
                style={{ cursor: c.v ? 'pointer' : 'default', transition: 'fill .4s' }}
                onMouseEnter={(e) => { const r = (e.target as SVGRectElement).getBoundingClientRect(); const p = (e.currentTarget.ownerSVGElement!.parentElement!).getBoundingClientRect(); setHover({ d: c.d, v: c.v, x: r.left - p.left + r.width / 2, y: r.top - p.top }); }}
                onClick={() => c.v && nav(`/transactions?date=${c.d}`)} />
            );
          })}
        </svg>
        {hover && (
          <div style={{ position: 'absolute', left: hover.x, top: hover.y - 8, transform: 'translate(-50%, -100%)', pointerEvents: 'none', zIndex: 2 }}>
            <Tip title={new Date(`${hover.d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })} rows={[['Spent', hover.v ? fmt(hover.v) : 'nothing']]} />
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--text-2)', marginTop: 8 }}>
        Less {ramp.map((c) => <span key={c} aria-hidden style={{ width: 14, height: 14, borderRadius: 4, background: c }} />)} More
      </div>
    </Frame>
  );
}
