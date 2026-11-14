import { useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useCssVar } from '../../app/theme';
import { formatMoney, type Minor } from '../../lib/money';
import { Segmented } from '.';

const fmt = (v: number) => formatMoney(v as Minor, 'CRC');
const fmtShort = (v: number) => {
  const c = v / 100;
  return Math.abs(c) >= 1e6 ? `₡${(c / 1e6).toFixed(1)}M` : `₡${Math.round(c / 1000)}k`;
};

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass glass-strong" style={{ padding: '10px 14px', borderRadius: 14, fontSize: 13 }}>
      {label && <div style={{ fontWeight: 700, marginBottom: 6 }}>{label}</div>}
      {payload.map((p) => (
        <div key={p.name} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color }} aria-hidden />
          <span style={{ color: 'var(--text-2)' }}>{p.name}</span>
          <span className="money" style={{ marginLeft: 'auto', fontWeight: 600, paddingLeft: 12 }}>{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Every chart ships a table view: screen readers and CVD readers get the exact numbers. */
function DataTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: (string | number)[][] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
      <caption style={{ textAlign: 'left', color: 'var(--text-2)', paddingBottom: 8 }}>{caption}</caption>
      <thead><tr>{columns.map((c, i) => <th key={c} style={{ textAlign: i ? 'right' : 'left', padding: '6px 8px', color: 'var(--text-2)', fontWeight: 600, borderBottom: '1px solid var(--glass-hairline)' }}>{c}</th>)}</tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={String(r[0])}>{r.map((v, i) => <td key={i} className="money" style={{ textAlign: i ? 'right' : 'left', padding: '6px 8px', borderBottom: '1px solid var(--glass-hairline)' }}>{typeof v === 'number' ? fmt(v) : v}</td>)}</tr>
      ))}</tbody>
    </table>
  );
}

export interface MonthFlow { month: string; income: number; expenses: number }

export function IncomeExpenseChart({ data, title }: { data: MonthFlow[]; title: string }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const reduce = useReducedMotion();
  const [inc, exp, grid, axis] = useCssVar(['--chart-income', '--chart-expense', '--chart-grid', '--chart-axis']);
  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: 17 }}>{title}</span>
        <Segmented label="Chart view" value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />
      </figcaption>
      {view === 'chart' ? (
        <div style={{ height: 260 }} role="img" aria-label={`${title}. Switch to Table for exact values.`}>
          <ResponsiveContainer>
            <BarChart data={data} barGap={2} barCategoryGap="28%" margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={grid} />
              <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: axis, fontSize: 12 }} />
              <YAxis tickFormatter={fmtShort} tickLine={false} axisLine={false} width={56} tick={{ fill: axis, fontSize: 12 }} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--accent-soft)', radius: 8 } as object} />
              <Legend iconType="circle" iconSize={10} wrapperStyle={{ fontSize: 13, color: 'var(--text-2)' }} />
              <Bar isAnimationActive={!reduce} dataKey="income" name="Income" fill={inc} radius={[4, 4, 0, 0]} />
              <Bar isAnimationActive={!reduce} dataKey="expenses" name="Expenses" fill={exp} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <DataTable caption={title} columns={['Month', 'Income', 'Expenses', 'Net']} rows={data.map((d) => [d.month, d.income, d.expenses, d.income - d.expenses])} />
      )}
    </figure>
  );
}

export interface Slice { name: string; value: number }

export function GroupDonut({ data, title }: { data: Slice[]; title: string }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  // Fixed categorical order — group N always gets slot N.
  const colors = useCssVar(['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5']);
  const [surface] = useCssVar(['--solid-surface']);
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: 17 }}>{title}</span>
        <Segmented label="Chart view" value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />
      </figcaption>
      {view === 'chart' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 16, alignItems: 'center', justifyItems: 'stretch' }} role="img" aria-label={`${title}. Switch to Table for exact values.`}>
          <div style={{ height: 200, position: 'relative', maxWidth: 220, width: '100%', justifySelf: 'center' }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius="66%" outerRadius="100%" paddingAngle={1.5} cornerRadius={4} stroke={surface} strokeWidth={2} isAnimationActive={false}>
                  {data.map((d, i) => <Cell key={d.name} fill={colors[i % colors.length]} />)}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', textAlign: 'center' }}>
              <div><div style={{ fontSize: 12, color: 'var(--text-2)' }}>Total</div><div className="money" style={{ fontWeight: 700, fontSize: 18 }}>{fmtShort(total)}</div></div>
            </div>
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {data.map((d, i) => (
              <li key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }}>
                <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: colors[i % colors.length], flex: 'none' }} />
                <span style={{ color: 'var(--text-2)' }}>{d.name}</span>
                <span className="money" style={{ marginLeft: 'auto', fontWeight: 600 }}>{Math.round((d.value / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <DataTable caption={title} columns={['Group', 'Amount']} rows={data.map((d) => [d.name, d.value])} />
      )}
    </figure>
  );
}
