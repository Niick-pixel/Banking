/**
 * Inventory: your product list, edited like the spreadsheet. Click any cell to change it
 * (code, product, category, unit cost, shipping, price, stock, notes); the totals, margins and
 * price range recalculate as you type. Restock logs a new shipment with its own cost.
 * Stock goes down by itself when you log a Sale and comes back if you delete it.
 */
import { useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Columns3, Minus, PackagePlus, Plus, ShoppingBag, Trash2, Upload } from 'lucide-react';
import { useLedger } from '../app/data';
import { usePref } from '../app/prefs';
import { usePersisted } from '../app/persist';
import { useQuickAdd } from '../app/QuickAdd';
import { Glass } from '../design/components';
import { ChipGroup } from '../design/components/ChipGroup';
import { InfoTip } from '../design/components/InfoTip';
import { PageHeader, Sheet, Toast } from '../ui/Sheet';
import { adjustStock, newId, saveProduct, saveTransaction } from '../db/repo';
import { mergeImported, parseInventory, productMath, restock, sales, stockOf, unitsSold } from '../domain/inventory';
import { ProductSchema, TransactionSchema, type Product } from '../domain/schemas';
import { gridFromXlsx } from '../import/grid';
import { formatMoney, parseAmountInput } from '../lib/money';
import { formatDateCR, todayISO } from '../lib/dates';

const crc = (n: number) => formatMoney(n, 'CRC');
const pct = (x: number) => `${Math.round(x * 100)}%`;
type Show = 'all' | 'in' | 'out';

/** Columns like the workbook. `edit` columns are typed into; the rest are calculated. */
const COLS = [
  { id: 'code', label: 'Code', edit: true },
  { id: 'name', label: 'Product', edit: true, always: true },
  { id: 'category', label: 'Category', edit: true },
  { id: 'unitCost', label: 'Unit cost', edit: true, num: true },
  { id: 'shipping', label: 'Shipping / unit', edit: true, num: true },
  { id: 'totalCost', label: 'Total cost', num: true },
  { id: 'price', label: 'Sale price', edit: true, num: true },
  { id: 'margin', label: 'Margin ₡', num: true },
  { id: 'marginPct', label: 'Margin %', num: true },
  { id: 'minPrice', label: 'Min price', num: true },
  { id: 'maxPrice', label: 'Max price', num: true },
  { id: 'stock', label: 'In stock', edit: true, num: true, always: true },
  { id: 'value', label: 'Stock value', num: true },
  { id: 'sold', label: 'Sold', num: true },
  { id: 'notes', label: 'Notes', edit: true },
] as const;
type ColId = (typeof COLS)[number]['id'];
const DEFAULT_COLS: ColId[] = ['code', 'name', 'category', 'unitCost', 'shipping', 'totalCost', 'price', 'margin', 'marginPct', 'minPrice', 'maxPrice', 'stock', 'notes'];

export default function Inventory() {
  const l = useLedger();
  const qa = useQuickAdd();
  const [margins, setMargins] = usePref('storeMargins');
  const [show, setShow] = usePersisted<Show>('inv.show', 'all');
  const [cols, setCols] = usePersisted<ColId[]>('inv.cols', DEFAULT_COLS);
  const [sort, setSort] = usePersisted<{ by: ColId; desc: boolean }>('inv.sort', { by: 'code', desc: false });
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [pickCols, setPickCols] = useState(false);
  const [restockOf, setRestockOf] = useState<Product | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [focusId, setFocusId] = useState<string | null>(null);
  const sold = useMemo(() => unitsSold(l.transactions), [l.transactions]);
  const products = l.products.filter((p) => !p.archived);
  const categories = [...new Set(products.map((p) => p.category.trim()).filter(Boolean))].sort();
  const visible = COLS.filter((c) => ('always' in c && c.always) || cols.includes(c.id));

  const rows = products.map((p) => {
    const stock = stockOf(p, sold), m = productMath(p, margins);
    const v: Record<ColId, number | string> = { code: p.code, name: p.name, category: p.category, unitCost: p.unitCost, shipping: p.shipping, totalCost: m.totalCost, price: p.price, margin: m.margin, marginPct: m.marginPct, minPrice: m.minPrice, maxPrice: m.maxPrice, stock, value: Math.max(0, stock) * m.totalCost, sold: sold.get(p.id) ?? 0, notes: p.notes };
    return { p, stock, m, v };
  }).filter((r) => (show === 'all' || (show === 'in' ? r.stock > 0 : r.stock <= 0)) && (!cat || r.p.category.trim() === cat)
    && (!q.trim() || `${r.p.code} ${r.p.name} ${r.p.category} ${r.p.notes}`.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => {
      const x = a.v[sort.by], y = b.v[sort.by];
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return (sort.desc ? -c : c) || a.p.name.localeCompare(b.p.name);
    });
  const all = products.map((p) => ({ p, stock: Math.max(0, stockOf(p, sold)) }));
  const units = all.reduce((s, r) => s + r.stock, 0);
  const atCost = all.reduce((s, r) => s + r.stock * (r.p.unitCost + r.p.shipping), 0);
  const atPrice = all.reduce((s, r) => s + r.stock * r.p.price, 0);
  const pmap = useMemo(() => new Map(l.products.map((p) => [p.id, p])), [l.products]);
  const saleRows = useMemo(() => sales(l.transactions, pmap), [l.transactions, pmap]);
  const month = todayISO().slice(0, 7);
  const monthSales = saleRows.filter((r) => r.tx.date.startsWith(month));
  const mRev = monthSales.reduce((s, r) => s + r.revenue, 0), mProfit = monthSales.reduce((s, r) => s + r.profit, 0);

  async function patch(p: Product, field: ColId, raw: string, stockNow: number) {
    const amt = (s: string) => Math.max(0, parseAmountInput(s, 'CRC') ?? 0);
    let next: Product = p;
    if (field === 'name') { if (!raw.trim()) return; next = { ...p, name: raw.trim() }; }
    else if (field === 'code' || field === 'category' || field === 'notes') next = { ...p, [field]: raw.trim() };
    else if (field === 'unitCost' || field === 'shipping' || field === 'price') next = { ...p, [field]: amt(raw) };
    else if (field === 'stock') {
      const want = Math.max(0, Math.round(Number(raw.replace(/[^\d.-]/g, '')) || 0));
      if (want !== stockNow) await adjustStock(p.id, want - stockNow);
      return;
    }
    if (JSON.stringify(next) !== JSON.stringify(p)) await saveProduct(ProductSchema.parse(next));
  }
  async function addRow() {
    const now = Date.now();
    const p = ProductSchema.parse({ id: newId(), name: 'New product', category: cat ?? '', createdAt: now, updatedAt: now });
    await saveProduct(p);
    setShow('all'); setQ(''); setFocusId(p.id);
  }
  async function importFile(f: File) {
    setErr('');
    try {
      const r = parseInventory(await gridFromXlsx(await f.arrayBuffer()));
      if (!r || !r.products.length) { setErr("Couldn't find a product list in that file. It needs a header row with Product (Producto) and Price (Precio de venta) or Stock."); return; }
      const { products: merged, added, updated } = mergeImported(r.products, l.products, sold, newId, Date.now());
      for (const p of merged) await saveProduct(ProductSchema.parse(p));
      if (r.margins) await setMargins(r.margins);
      setToast(`Imported from "${r.sheet}": ${added} new, ${updated} updated${r.margins ? `, margins ${pct(r.margins.min)}–${pct(r.margins.max)}` : ''}`);
    } catch (e) { setErr(`Couldn't read this file: ${e instanceof Error ? e.message : e}`); }
  }
  const cell = (r: (typeof rows)[number], c: (typeof COLS)[number]) => {
    const v = r.v[c.id];
    if ('edit' in c && c.edit) {
      const shown = c.id === 'stock' ? String(r.stock) : 'num' in c && c.num ? String((v as number) / 100) : String(v);
      return <EditCell key={`${r.p.id}:${c.id}:${shown}`} value={shown} num={'num' in c && !!c.num} money={'num' in c && c.id !== 'stock'} wide={c.id === 'name' || c.id === 'notes'} autoFocus={focusId === r.p.id && c.id === 'name'}
        label={`${c.label} of ${r.p.name}`} onCommit={(s) => { if (focusId) setFocusId(null); void patch(r.p, c.id, s, r.stock); }} />;
    }
    if (c.id === 'marginPct') return <span style={{ color: r.m.marginPct < margins.min ? 'rgb(var(--loss))' : r.m.marginPct > margins.max ? 'rgb(var(--amber))' : 'rgb(var(--win))' }}>{pct(r.m.marginPct)}</span>;
    if (c.id === 'sold') return <span>{v}</span>;
    return <span className="money">{crc(v as number)}</span>;
  };

  return (
    <div className="fit">
      <PageHeader title="Inventory" sub="Click any cell to change it, like in Excel. Costs, margins and price range update by themselves.">
        <label className="btn" style={{ cursor: 'pointer' }}><Upload size={15} /> Import Excel
          <input type="file" accept=".xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
        </label>
        <button className="btn btn-primary" onClick={() => void addRow()}><Plus size={15} /> Product</button>
      </PageHeader>
      {err && <Glass strong pad={12} role="alert" style={{ color: 'var(--expense)', flex: 'none' }}>{err}</Glass>}

      <div className="inv-kpis">
        <Glass pad={14}><span className="stat-label">In stock</span><b className="stat-value">{all.filter((r) => r.stock > 0).length} <span className="small faint">of {products.length} products</span></b><span className="small faint">{units} units</span></Glass>
        <Glass pad={14}><span className="stat-label">Stock value <InfoTip text="What the units on hand cost you (cost + shipping), and what they'd bring in at your sale prices." /></span><b className="stat-value money">{crc(atCost)}</b><span className="small faint">sells for {crc(atPrice)} · profit {crc(atPrice - atCost)}</span></Glass>
        <Glass pad={14}><span className="stat-label">Sales this month</span><b className="stat-value money" style={{ color: 'var(--income)' }}>{crc(mRev)}</b><span className="small faint">{monthSales.reduce((s, r) => s + r.qty, 0)} units · profit {crc(mProfit)}</span></Glass>
        <Glass pad={14}><span className="stat-label">Margins <InfoTip text="Minimum and maximum margin. They set each product's lowest and highest sensible price: cost ÷ (1 − margin). Margin % turns red below the minimum and amber above the maximum." /></span>
          <span className="inv-margins">
            <label>Min <input className="input" inputMode="decimal" aria-label="Minimum margin %" defaultValue={Math.round(margins.min * 100)} onBlur={(e) => { const v = Number(e.target.value) / 100; if (v >= 0 && v < 1) void setMargins({ ...margins, min: v }); }} />%</label>
            <label>Max <input className="input" inputMode="decimal" aria-label="Maximum margin %" defaultValue={Math.round(margins.max * 100)} onBlur={(e) => { const v = Number(e.target.value) / 100; if (v >= 0 && v < 1) void setMargins({ ...margins, max: v }); }} />%</label>
          </span>
        </Glass>
      </div>

      <div className="inv-grid fill">
        <Glass strong pad={14} className="inv-list">
          <div className="inv-tools">
            <input className="input" type="search" placeholder="Search code, product, category, notes…" aria-label="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
            <ChipGroup<Show> inline compact size="sm" label="Show" value={show} onChange={(v) => v && setShow(v)}
              options={[{ value: 'all', label: `All ${products.length}` }, { value: 'in', label: 'In stock' }, { value: 'out', label: 'Out of stock' }]} />
            <span style={{ position: 'relative' }}>
              <button className="btn btn-sm" aria-expanded={pickCols} onClick={() => setPickCols((x) => !x)}><Columns3 size={14} /> Columns</button>
              {pickCols && (
                <div className="inv-colpick glass glass-strong" role="group" aria-label="Columns to show">
                  {COLS.filter((c) => !('always' in c && c.always)).map((c) => (
                    <label key={c.id}><input type="checkbox" checked={cols.includes(c.id)} onChange={(e) => setCols(e.target.checked ? [...cols, c.id] : cols.filter((x) => x !== c.id))} /> {c.label}</label>
                  ))}
                  <button className="btn btn-sm btn-ghost" onClick={() => setCols(DEFAULT_COLS)}>Reset</button>
                </div>
              )}
            </span>
          </div>
          {categories.length > 1 && <ChipGroup<string> inline compact size="sm" label="Category" value={cat} allowNone onChange={setCat} options={categories.map((c) => ({ value: c, label: c }))} />}
          {products.length === 0 ? (
            <div className="bell-empty"><ShoppingBag size={28} /><b>No products yet</b><span className="small">Import your store Excel (sheet "Inventario") or add a product.</span></div>
          ) : (
            <div className="scroll-box fill" tabIndex={0} aria-label="Products">
              <table className="table inv-table">
                <thead><tr>
                  {visible.map((c) => (
                    <th key={c.id} className={'num' in c && c.num ? 'num' : ''} aria-sort={sort.by === c.id ? (sort.desc ? 'descending' : 'ascending') : undefined}>
                      <button type="button" className="inv-th" onClick={() => setSort({ by: c.id, desc: sort.by === c.id ? !sort.desc : false })}>
                        {c.label}{sort.by === c.id && (sort.desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
                      </button>
                    </th>
                  ))}
                  <th><span className="sr-only">Actions</span></th>
                </tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.p.id} className={r.stock <= 0 ? 'inv-out' : ''}>
                    {visible.map((c) => (
                      <td key={c.id} className={`${'num' in c && c.num ? 'num' : ''} ${c.id === 'stock' ? 'inv-stock-cell' : ''}`}>
                        {c.id === 'stock' ? (
                          <span className="inv-stock">
                            <button type="button" className="btn btn-sm btn-ghost" aria-label={`Take one ${r.p.name} out of stock`} disabled={r.stock <= 0} onClick={() => void adjustStock(r.p.id, -1)}><Minus size={13} /></button>
                            {cell(r, c)}
                            <button type="button" className="btn btn-sm btn-ghost" aria-label={`Add one ${r.p.name} to stock`} onClick={() => void adjustStock(r.p.id, 1)}><Plus size={13} /></button>
                          </span>
                        ) : cell(r, c)}
                      </td>
                    ))}
                    <td className="inv-actions">
                      <button type="button" className="btn btn-sm btn-primary" disabled={r.stock <= 0} onClick={() => qa.open(undefined, 'sale', r.p.id)}>Sell</button>
                      <button type="button" className="btn btn-sm" title="A new shipment: units and what they cost" onClick={() => setRestockOf(r.p)}><PackagePlus size={14} /> Restock</button>
                      <button type="button" className="btn btn-sm btn-ghost" aria-label={`Remove ${r.p.name}`} title="Remove product (sales history stays)" onClick={() => { if (confirm(`Remove "${r.p.name}"? Its past sales stay in Activity.`)) void saveProduct({ ...r.p, archived: true }); }}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
              {rows.length === 0 && <p className="small muted" style={{ padding: 12 }}>Nothing matches.</p>}
              <button type="button" className="btn btn-ghost btn-sm" style={{ margin: 8 }} onClick={() => void addRow()}><Plus size={14} /> Add a row</button>
            </div>
          )}
        </Glass>

        <Glass strong pad={14} className="inv-sales">
          <h2 className="card-h" style={{ margin: 0 }}>Latest sales <span className="n">n {saleRows.length}</span></h2>
          {saleRows.length === 0 ? <p className="small muted" style={{ margin: 0 }}>No sales yet. Tap Sell on a product, or Add → Sale.</p> : (
            <div className="scroll-box fill" tabIndex={0} aria-label="Latest sales">
              {saleRows.slice(0, 60).map((r) => (
                <button key={r.tx.id} type="button" className="fund-act-row" onClick={() => qa.open(r.tx)} title="Open this sale">
                  <span className="small faint">{formatDateCR(r.tx.date).slice(0, 5)}</span>
                  <span className="fund-act-what"><span>{r.qty} × {r.product?.name ?? 'Deleted product'}</span><span className="small faint">profit {crc(r.profit)}</span></span>
                  <b className="money" style={{ color: 'rgb(var(--win))' }}>+{crc(r.revenue)}</b>
                </button>
              ))}
            </div>
          )}
        </Glass>
      </div>

      <Sheet open={!!restockOf} onClose={() => setRestockOf(null)} title={restockOf ? `Restock ${restockOf.name}` : ''}>
        {restockOf && <RestockForm product={restockOf} onHand={stockOf(restockOf, sold)} onDone={(msg) => { setRestockOf(null); if (msg) setToast(msg); }} />}
      </Sheet>
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

/** A spreadsheet cell: shows the value, edits in place, saves on Enter or when you click away (Esc cancels). */
function EditCell({ value, onCommit, num, money, wide, label, autoFocus }: { value: string; onCommit: (v: string) => void; num?: boolean; money?: boolean; wide?: boolean; label: string; autoFocus?: boolean }) {
  const [v, setV] = useState(value);
  const cancel = useRef(false);
  const shown = money && v !== '' && Number.isFinite(Number(v)) ? formatMoney(Math.round(Number(v) * 100), 'CRC') : v;
  const [editing, setEditing] = useState(!!autoFocus);
  return editing ? (
    <input className={`inv-cell ${num ? 'num' : ''} ${wide ? 'wide' : ''}`} aria-label={label} autoFocus value={v} inputMode={num ? 'decimal' : undefined}
      onFocus={(e) => e.target.select()} onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { cancel.current = true; setV(value); (e.target as HTMLInputElement).blur(); } }}
      onBlur={() => { setEditing(false); if (cancel.current) { cancel.current = false; return; } if (v !== value) onCommit(v); }} />
  ) : (
    <button type="button" className={`inv-cell-btn ${num ? 'num' : ''} ${wide ? 'wide' : ''} ${!v ? 'empty' : ''}`} aria-label={`${label}: ${shown || 'empty'}. Click to edit`} onClick={() => setEditing(true)}>
      {wide && label.startsWith('Product') ? <b>{shown}</b> : shown || <span className="faint">—</span>}
    </button>
  );
}

function RestockForm({ product, onHand, onDone }: { product: Product; onHand: number; onDone: (msg?: string) => void }) {
  const l = useLedger();
  const m = (n: number) => String(n / 100);
  const [qty, setQty] = useState('1');
  const [cost, setCost] = useState(m(product.unitCost));
  const [ship, setShip] = useState(m(product.shipping));
  const [date, setDate] = useState(todayISO());
  const [mode, setMode] = useState<'new' | 'average'>('new');
  const payFrom = l.accounts.filter((a) => !a.archived && ['checking', 'cash', 'credit_card'].includes(a.type));
  const [log, setLog] = useState<string>('none');
  const expenseCats = l.categories.filter((c) => !c.archived && ['Fixed', 'Living', 'Discretionary'].includes(c.group));
  const [catId, setCatId] = useState(expenseCats.find((c) => /store|tienda|inventory|inventario|stock|mercader/i.test(c.name))?.id ?? '');
  const [err, setErr] = useState('');
  const n = Math.max(0, Math.round(Number(qty) || 0));
  const uc = parseAmountInput(cost, 'CRC') ?? 0, sh = parseAmountInput(ship, 'CRC') ?? 0;
  const preview = n ? restock(product, onHand, { date, qty: n, unitCost: uc, shipping: sh }, mode) : null;
  async function save() {
    if (!n) return setErr('How many units arrived?');
    if (log !== 'none' && !catId) return setErr('Pick a category for the expense');
    await saveProduct(ProductSchema.parse(restock(product, onHand, { date, qty: n, unitCost: uc, shipping: sh }, mode)));
    if (log !== 'none' && (uc + sh) * n > 0) {
      const now = Date.now();
      await saveTransaction(TransactionSchema.parse({ id: newId(), kind: 'expense', date, dateEstimated: false, currency: 'CRC', description: `Stock: ${n} × ${product.name}`, tags: ['inventory'], notes: '', from: { accountId: log }, amount: (uc + sh) * n, categoryId: catId, createdAt: now, updatedAt: now }));
    }
    onDone(`${n} × ${product.name} added to stock`);
  }
  return (
    <form style={{ display: 'grid', gap: 12 }} onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <p className="small muted" style={{ margin: 0 }}>{onHand} in stock now, at {crc(product.unitCost)} + {crc(product.shipping)} shipping each.</p>
      <div className="grid3">
        <div className="field"><label htmlFor="rs-q">Units arrived</label><input id="rs-q" data-autofocus className="input" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        <div className="field"><label htmlFor="rs-c">Unit cost</label><input id="rs-c" className="input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
        <div className="field"><label htmlFor="rs-s">Shipping per unit</label><input id="rs-s" className="input" inputMode="decimal" value={ship} onChange={(e) => setShip(e.target.value)} /></div>
      </div>
      <div className="field" style={{ maxWidth: 200 }}><label htmlFor="rs-d">Date</label><input id="rs-d" className="input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
      {(uc !== product.unitCost || sh !== product.shipping) && onHand > 0 && (
        <ChipGroup<'new' | 'average'> size="sm" label="Cost from now on" value={mode} onChange={(v) => v && setMode(v)} info="New: every unit is valued at this shipment's cost. Average: blends it with the units already on the shelf (weighted by how many)."
          options={[{ value: 'new', label: `This shipment's cost` }, { value: 'average', label: 'Average with what I have' }]} />
      )}
      {preview && <p className="small" style={{ margin: 0 }}>After: <b>{onHand + n}</b> in stock, cost <b className="money">{crc(preview.unitCost)}</b> + <b className="money">{crc(preview.shipping)}</b> shipping, margin <b>{pct(productMath(preview).marginPct)}</b> at {crc(product.price)}.</p>}
      <ChipGroup<string> size="sm" label="Also log what I paid" value={log} onChange={(v) => v && setLog(v)} info={`Adds an expense of ${crc((uc + sh) * n)} so your budget sees the purchase.`}
        options={[{ value: 'none', label: 'No' }, ...payFrom.map((a) => ({ value: a.id, label: `From ${a.name.replace(/\s*\((checking|savings)\)$/i, '')}` }))]} />
      {log !== 'none' && <ChipGroup<string> size="sm" label="Expense category" value={catId || null} onChange={(v) => setCatId(v ?? '')} options={expenseCats.map((c) => ({ value: c.id, label: c.name }))} />}
      {err && <p className="small" role="alert" style={{ color: 'var(--expense)', margin: 0 }}>{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" type="submit">Add to stock</button></div>
    </form>
  );
}

