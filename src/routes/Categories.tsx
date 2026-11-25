/**
 * Categories: add, rename, regroup, budget, merge or archive what you spend on.
 * Anything added here appears in the Tracker (budget) right away.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLedger } from '../app/data';
import { Glass, Pill } from '../design/components';
import { PageHeader, Sheet } from '../ui/Sheet';
import { CATEGORY_GROUPS, type Category } from '../domain/schemas';
import { budgetFor } from '../domain/tracker';
import { mergeCategory, newId, saveBudget, saveCategory } from '../db/repo';
import { formatMoney, parseAmountInput } from '../lib/money';
import { todayISO } from '../lib/dates';
import { usePersisted } from '../app/persist';

type Group = Category['group'];
const GROUP_LABEL: Record<Group, string> = { Income: 'Income', Fixed: 'Fixed costs', Living: 'Living / variable', Discretionary: 'Discretionary', 'Debt Service': 'Debt service', Savings: 'Savings' };
const BUDGET_WORD: Record<Group, string> = { Income: 'Expected / month', Fixed: 'Budget / month', Living: 'Budget / month', Discretionary: 'Budget / month', 'Debt Service': 'Budget / month', Savings: 'Target / month' };

/** Budget → Categories (a view of the Budget page, top right). */
export default function Categories({ embedded }: { embedded?: boolean } = {}) {
  const l = useLedger();
  const month = todayISO().slice(0, 7);
  const [showArchived, setShowArchived] = usePersisted('categories.archived', false);
  const [adding, setAdding] = useState<Group | null>(null);
  const [merging, setMerging] = useState<Category | null>(null);
  const flow = l.flows.get(month);
  const uses = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of l.transactions) {
      if ('categoryId' in t && t.categoryId) m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + 1);
      if (t.kind === 'expense') for (const s of t.splits ?? []) m.set(s.categoryId, (m.get(s.categoryId) ?? 0) + 1);
    }
    return m;
  }, [l.transactions]);
  const update = (c: Category, patch: Partial<Category>) => void saveCategory({ ...c, ...patch });

  return (
    <div className="fit">
      {embedded ? (
        <div className="small muted" style={{ display: 'flex', gap: 12, alignItems: 'center', flex: 'none' }}>
          <span style={{ flex: 1 }}>What your money goes to. Add, rename, budget or regroup here; changes show up in the Budget straight away.</span>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>
        </div>
      ) : (
      <PageHeader title="Categories" sub="What your money goes to. Add, rename or regroup here; new categories show up in the Tracker straight away.">
        <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>
      </PageHeader>)}
      <div className="scroll-box fill" tabIndex={0} aria-label="List" style={{ display: 'grid', alignContent: 'start', paddingRight: 4, gap: 16 }}>
        {CATEGORY_GROUPS.map((g) => {
          const cats = l.categories.filter((c) => c.group === g && (showArchived || !c.archived)).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
          return (
            <Glass key={g} strong pad={18} style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <h2 style={{ margin: 0, fontSize: 16 }}>{GROUP_LABEL[g]} <span className="muted small">· {cats.filter((c) => !c.archived).length}</span></h2>
                <button className="btn btn-sm" onClick={() => setAdding(g)}>+ Add to {GROUP_LABEL[g].toLowerCase()}</button>
              </div>
              <div className="cat-row cat-head" aria-hidden><span>Name</span><span>Group</span><span>{BUDGET_WORD[g]}</span><span>This month</span><span /></div>
              {cats.map((c) => {
                const budget = budgetFor(l.budgets, c.id, month);
                const actual = flow?.byCategory.get(c.id) ?? 0;
                const over = budget > 0 && (g === 'Savings' ? actual < budget : g !== 'Income' && actual > budget);
                return (
                  <div key={c.id} className="cat-row" style={{ opacity: c.archived ? 0.55 : 1 }}>
                    <input className="input" aria-label={`Name of ${c.name}`} defaultValue={c.name} key={`${c.id}-${c.name}`}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.name) update(c, { name: v }); else e.target.value = c.name; }}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                    <select className="input" aria-label={`Group of ${c.name}`} value={c.group} onChange={(e) => update(c, { group: e.target.value as Group })}>{CATEGORY_GROUPS.map((x) => <option key={x} value={x}>{GROUP_LABEL[x]}</option>)}</select>
                    <BudgetInput key={`${c.id}-${budget}`} label={`${BUDGET_WORD[g]} for ${c.name}`} value={budget} onSave={(v) => void saveBudget(c.id, '*', v)} />
                    <span className="money small" style={{ color: over ? 'var(--expense)' : undefined }}>{actual ? formatMoney(actual, 'CRC') : '—'}<span className="muted"> · {uses.get(c.id) ?? 0} movement{(uses.get(c.id) ?? 0) === 1 ? '' : 's'}</span></span>
                    <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      {g !== 'Income' && g !== 'Savings' && <button className={`btn btn-sm ${c.discretionary ? '' : 'btn-ghost'}`} aria-pressed={c.discretionary} title="Avoidable spending is what the Coach and insights look at first" onClick={() => update(c, { discretionary: !c.discretionary })}>{c.discretionary ? 'Avoidable ✓' : 'Avoidable'}</button>}
                      <button className="btn btn-ghost btn-sm" onClick={() => setMerging(c)}>Merge…</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => update(c, { archived: !c.archived })}>{c.archived ? 'Restore' : 'Archive'}</button>
                    </span>
                  </div>
                );
              })}
              {!cats.length && <p className="small muted" style={{ margin: 0 }}>Nothing here yet.</p>}
            </Glass>
          );
        })}
      </div>
      <p className="small muted" style={{ marginTop: 16 }}>The monthly amount here is the default for every month. To change one month only, click its cell in <Link to="/tracker">the Tracker</Link>. Archiving hides a category from new movements and the Tracker; past movements keep it.</p>

      <Sheet open={!!adding} onClose={() => setAdding(null)} title="New category">
        {adding && <AddForm group={adding} onDone={() => setAdding(null)} />}
      </Sheet>
      <Sheet open={!!merging} onClose={() => setMerging(null)} title={merging ? `Merge “${merging.name}” into…` : ''}>
        {merging && <MergeForm from={merging} uses={uses.get(merging.id) ?? 0} onDone={() => setMerging(null)} />}
      </Sheet>
    </div>
  );
}

function BudgetInput({ value, onSave, label }: { value: number; onSave: (v: number) => void; label: string }) {
  const [raw, setRaw] = useState(value ? String(value / 100) : '');
  const commit = () => { const v = raw.trim() ? parseAmountInput(raw, 'CRC') : 0; if (v === null) { setRaw(value ? String(value / 100) : ''); return; } if (v !== value) onSave(v); };
  return <input className="input" inputMode="decimal" aria-label={label} placeholder="none" value={raw} onChange={(e) => setRaw(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

function AddForm({ group, onDone }: { group: Group; onDone: () => void }) {
  const l = useLedger();
  const [name, setName] = useState('');
  const [g, setG] = useState<Group>(group);
  const [raw, setRaw] = useState('');
  const [avoidable, setAvoidable] = useState(group === 'Discretionary');
  const [err, setErr] = useState('');
  async function save() {
    const n = name.trim();
    if (!n) return setErr('Give it a name');
    if (l.categories.some((c) => !c.archived && c.name.toLowerCase() === n.toLowerCase())) return setErr('There is already a category with that name');
    const amount = raw.trim() ? parseAmountInput(raw, 'CRC') : 0;
    if (amount === null) return setErr("Can't read the amount");
    const now = Date.now();
    const id = newId();
    const order = Math.max(0, ...l.categories.filter((c) => c.group === g).map((c) => c.sortOrder)) + 1;
    await saveCategory({ id, name: n, group: g, discretionary: avoidable, sortOrder: order, archived: false, createdAt: now, updatedAt: now });
    if (amount) await saveBudget(id, '*', amount);
    onDone();
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: 'grid', gap: 12 }}>
      <div className="field"><label htmlFor="cat-n">Name</label><input id="cat-n" data-autofocus className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Gym, Pet, Gifts…" /></div>
      <div className="grid2">
        <div className="field"><label htmlFor="cat-g">Group</label><select id="cat-g" className="input" value={g} onChange={(e) => setG(e.target.value as Group)}>{CATEGORY_GROUPS.map((x) => <option key={x} value={x}>{GROUP_LABEL[x]}</option>)}</select></div>
        <div className="field"><label htmlFor="cat-b">{BUDGET_WORD[g]}</label><input id="cat-b" className="input" inputMode="decimal" placeholder="optional, e.g. 25k" value={raw} onChange={(e) => setRaw(e.target.value)} /></div>
      </div>
      {g !== 'Income' && g !== 'Savings' && <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={avoidable} onChange={(e) => setAvoidable(e.target.checked)} /> Avoidable spending</label>}
      {err && <p role="alert" style={{ color: 'var(--expense)', margin: 0 }}>{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" type="submit">Add category</button></div>
      <Pill tone="neutral">Shows up in the Tracker and Quick Add right away</Pill>
    </form>
  );
}

function MergeForm({ from, uses, onDone }: { from: Category; uses: number; onDone: () => void }) {
  const l = useLedger();
  const targets = l.categories.filter((c) => !c.archived && c.id !== from.id);
  const [to, setTo] = useState(targets.find((c) => c.group === from.group)?.id ?? targets[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  async function go() { setBusy(true); try { await mergeCategory(from.id, to); onDone(); } finally { setBusy(false); } }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void go(); }} style={{ display: 'grid', gap: 12 }}>
      <div className="field"><label htmlFor="mg-to">Move everything into</label>
        <select id="mg-to" data-autofocus className="input" value={to} onChange={(e) => setTo(e.target.value)}>
          {CATEGORY_GROUPS.map((g) => <optgroup key={g} label={GROUP_LABEL[g]}>{targets.filter((c) => c.group === g).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>)}
        </select></div>
      <p className="small muted" style={{ margin: 0 }}>{uses} movement{uses === 1 ? '' : 's'}, plus recurring bills and budgets, move to the chosen category. “{from.name}” is then archived. Each moved movement can be undone from its history.</p>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" type="submit" disabled={busy || !to}>Merge</button></div>
    </form>
  );
}
