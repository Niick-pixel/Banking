/**
 * Inventory: the products you sell, what's in stock, prices and margins, and sales.
 * Stock goes down by itself when you log a Sale (Add a movement → Sale) and comes
 * back if you delete it. Use − / + for anything else (restock, damaged, gift).
 */
import { useMemo, useState } from 'react';
import { Minus, Plus, ShoppingBag, Upload } from 'lucide-react';
import { useLedger } from '../app/data';
import { usePref } from '../app/prefs';
import { usePersisted } from '../app/persist';
import { useQuickAdd } from '../app/QuickAdd';
import { Glass, Pill } from '../design/components';
import { ChipGroup } from '../design/components/ChipGroup';
import { InfoTip } from '../design/components/InfoTip';
import { PageHeader, Sheet, Toast } from '../ui/Sheet';
import { adjustStock, newId, saveProduct } from '../db/repo';
import { mergeImported, parseInventory, productMath, sales, stockOf, unitsSold } from '../domain/inventory';
import { ProductSchema, type Product } from '../domain/schemas';
import { gridFromXlsx } from '../import/grid';
import { formatMoney, parseAmountInput } from '../lib/money';
import { formatDateCR, todayISO } from '../lib/dates';

const crc = (n: number) => formatMoney(n, 'CRC');
const pct = (x: number) => `${Math.round(x * 100)}%`;
type Show = 'all' | 'in' | 'out';

export default function Inventory() {
  const l = useLedger();
  const qa = useQuickAdd();
  const [margins, setMargins] = usePref('storeMargins');
  const [show, setShow] = usePersisted<Show>('inv.show', 'all');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Product | 'new' | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const sold = useMemo(() => unitsSold(l.transactions), [l.transactions]);
  const products = l.products.filter((p) => !p.archived);
  const rows = products.map((p) => ({ p, stock: stockOf(p, sold), m: productMath(p, margins) }))
    .filter((r) => (show === 'all' || (show === 'in' ? r.stock > 0 : r.stock <= 0)) && (!q.trim() || `${r.p.code} ${r.p.name} ${r.p.category}`.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0) || a.p.code.localeCompare(b.p.code) || a.p.name.localeCompare(b.p.name));
  const all = products.map((p) => ({ p, stock: Math.max(0, stockOf(p, sold)) }));
  const units = all.reduce((s, r) => s + r.stock, 0);
  const atCost = all.reduce((s, r) => s + r.stock * (r.p.unitCost + r.p.shipping), 0);
  const atPrice = all.reduce((s, r) => s + r.stock * r.p.price, 0);
  const pmap = useMemo(() => new Map(l.products.map((p) => [p.id, p])), [l.products]);
  const saleRows = useMemo(() => sales(l.transactions, pmap), [l.transactions, pmap]);
  const month = todayISO().slice(0, 7);
  const monthSales = saleRows.filter((r) => r.tx.date.startsWith(month));
  const mRev = monthSales.reduce((s, r) => s + r.revenue, 0), mProfit = monthSales.reduce((s, r) => s + r.profit, 0);

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

  return (
    <div className="fit">
      <PageHeader title="Inventory" sub="What you sell and what's in stock. Log a sale from here or with Add → Sale: stock goes down by itself.">
        <label className="btn" style={{ cursor: 'pointer' }}><Upload size={15} /> Import Excel
          <input type="file" accept=".xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
        </label>
        <button className="btn btn-primary" onClick={() => setEdit('new')}><Plus size={15} /> Product</button>
      </PageHeader>
      {err && <Glass strong pad={12} role="alert" style={{ color: 'var(--expense)', flex: 'none' }}>{err}</Glass>}

      <div className="inv-kpis">
        <Glass pad={14}><span className="stat-label">In stock</span><b className="stat-value">{all.filter((r) => r.stock > 0).length} <span className="small faint">of {products.length} products</span></b><span className="small faint">{units} units</span></Glass>
        <Glass pad={14}><span className="stat-label">Stock value <InfoTip text="What the units on hand cost you (cost + shipping), and what they'd bring in at your sale prices." /></span><b className="stat-value money">{crc(atCost)}</b><span className="small faint">sells for {crc(atPrice)} · profit {crc(atPrice - atCost)}</span></Glass>
        <Glass pad={14}><span className="stat-label">Sales this month</span><b className="stat-value money" style={{ color: 'var(--income)' }}>{crc(mRev)}</b><span className="small faint">{monthSales.reduce((s, r) => s + r.qty, 0)} units · profit {crc(mProfit)}</span></Glass>
        <Glass pad={14}><span className="stat-label">Margins <InfoTip text="Minimum and maximum margin. They set each product's lowest and highest sensible price: cost ÷ (1 − margin)." /></span>
          <span className="inv-margins">
            <label>Min <input className="input" inputMode="decimal" aria-label="Minimum margin %" defaultValue={Math.round(margins.min * 100)} onBlur={(e) => { const v = Number(e.target.value) / 100; if (v >= 0 && v < 1) void setMargins({ ...margins, min: v }); }} />%</label>
            <label>Max <input className="input" inputMode="decimal" aria-label="Maximum margin %" defaultValue={Math.round(margins.max * 100)} onBlur={(e) => { const v = Number(e.target.value) / 100; if (v >= 0 && v < 1) void setMargins({ ...margins, max: v }); }} />%</label>
          </span>
        </Glass>
      </div>

      <div className="inv-grid fill">
        <Glass strong pad={14} className="inv-list">
          <div className="inv-tools">
            <input className="input" type="search" placeholder="Search code, product, category…" aria-label="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
            <ChipGroup<Show> inline compact size="sm" label="Show" value={show} onChange={(v) => v && setShow(v)}
              options={[{ value: 'all', label: `All ${products.length}` }, { value: 'in', label: 'In stock' }, { value: 'out', label: 'Out of stock' }]} />
          </div>
          {products.length === 0 ? (
            <div className="bell-empty"><ShoppingBag size={28} /><b>No products yet</b><span className="small">Import your store Excel (sheet "Inventario") or add a product.</span></div>
          ) : (
            <div className="scroll-box fill" tabIndex={0} aria-label="Products">
              <table className="table inv-table">
                <thead><tr><th>Product</th><th className="num">Cost <InfoTip text="Unit cost + shipping per unit." /></th><th className="num">Price</th><th className="num">Margin</th><th className="num">Min – max</th><th className="num">In stock</th><th /></tr></thead>
                <tbody>{rows.map(({ p, stock, m }) => (
                  <tr key={p.id} className={stock <= 0 ? 'inv-out' : ''}>
                    <td><button type="button" className="inv-name" onClick={() => setEdit(p)} title="Edit product"><b>{p.name}</b><span className="small faint">{[p.code, p.category].filter(Boolean).join(' · ')}{p.notes ? ` · ${p.notes}` : ''}</span></button></td>
                    <td className="num money">{crc(m.totalCost)}</td>
                    <td className="num money">{crc(p.price)}</td>
                    <td className="num"><span className="money">{crc(m.margin)}</span><br /><span className="small" style={{ color: m.marginPct < margins.min ? 'rgb(var(--loss))' : m.marginPct > margins.max ? 'rgb(var(--amber))' : 'rgb(var(--win))' }}>{pct(m.marginPct)}</span></td>
                    <td className="num small faint money">{crc(m.minPrice)} – {crc(m.maxPrice)}</td>
                    <td className="num">
                      <span className="inv-stock">
                        <button type="button" className="btn btn-sm btn-ghost" aria-label={`Take one ${p.name} out of stock`} disabled={stock <= 0} onClick={() => void adjustStock(p.id, -1)}><Minus size={14} /></button>
                        {stock > 0 ? <b>{stock}</b> : <Pill tone="expense">Out</Pill>}
                        <button type="button" className="btn btn-sm btn-ghost" aria-label={`Add one ${p.name} to stock`} onClick={() => void adjustStock(p.id, 1)}><Plus size={14} /></button>
                      </span>
                    </td>
                    <td className="num"><button type="button" className="btn btn-sm btn-primary" disabled={stock <= 0} onClick={() => qa.open(undefined, 'sale', p.id)}>Sell</button></td>
                  </tr>
                ))}</tbody>
              </table>
              {rows.length === 0 && <p className="small muted" style={{ padding: 12 }}>Nothing matches.</p>}
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

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'New product' : 'Edit product'}>
        {edit && <ProductForm product={edit === 'new' ? undefined : edit} stock={edit === 'new' ? 0 : stockOf(edit, sold)} onDone={() => setEdit(null)} />}
      </Sheet>
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

function ProductForm({ product, stock, onDone }: { product?: Product; stock: number; onDone: () => void }) {
  const [margins] = usePref('storeMargins');
  const m = (n?: number) => (n ? String(n / 100) : '');
  const [f, setF] = useState({ code: product?.code ?? '', name: product?.name ?? '', category: product?.category ?? '', unitCost: m(product?.unitCost), shipping: m(product?.shipping), price: m(product?.price), notes: product?.notes ?? '', stock: String(stock) });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const amt = (s: string) => parseAmountInput(s, 'CRC') ?? 0;
  const math = productMath({ unitCost: amt(f.unitCost), shipping: amt(f.shipping), price: amt(f.price) }, margins);
  async function save() {
    if (!f.name.trim()) return setErr('Give it a name');
    const want = Math.max(0, Math.round(Number(f.stock) || 0));
    const now = Date.now();
    const base: Product = product ?? { id: newId(), code: '', name: '', category: '', currency: 'CRC', unitCost: 0, shipping: 0, price: 0, stockIn: 0, stockOut: 0, notes: '', archived: false, createdAt: now, updatedAt: now };
    // "In stock" is what you see on the shelf: move stockIn so on-hand equals it, keeping the sales history intact.
    const stockIn = base.stockIn + (want - stock);
    const next = { ...base, code: f.code.trim(), name: f.name.trim(), category: f.category.trim(), unitCost: amt(f.unitCost), shipping: amt(f.shipping), price: amt(f.price), notes: f.notes.trim(),
      stockIn: stockIn >= 0 ? stockIn : base.stockIn, stockOut: stockIn >= 0 ? base.stockOut : base.stockOut - stockIn };
    const r = ProductSchema.safeParse(next);
    if (!r.success) return setErr(r.error.issues[0]?.message ?? 'Check the fields');
    await saveProduct(r.data);
    onDone();
  }
  return (
    <form style={{ display: 'grid', gap: 12 }} onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="grid2">
        <div className="field"><label htmlFor="pf-n">Product</label><input id="pf-n" data-autofocus className="input" value={f.name} onChange={set('name')} /></div>
        <div className="field"><label htmlFor="pf-c">Code</label><input id="pf-c" className="input" value={f.code} onChange={set('code')} placeholder="SKU-007" /></div>
      </div>
      <div className="grid2">
        <div className="field"><label htmlFor="pf-cat">Category</label><input id="pf-cat" className="input" value={f.category} onChange={set('category')} /></div>
        <div className="field"><label htmlFor="pf-s">In stock now</label><input id="pf-s" className="input" inputMode="numeric" value={f.stock} onChange={set('stock')} /></div>
      </div>
      <div className="grid3">
        <div className="field"><label htmlFor="pf-u">Unit cost</label><input id="pf-u" className="input" inputMode="decimal" value={f.unitCost} onChange={set('unitCost')} /></div>
        <div className="field"><label htmlFor="pf-sh">Shipping per unit</label><input id="pf-sh" className="input" inputMode="decimal" value={f.shipping} onChange={set('shipping')} /></div>
        <div className="field"><label htmlFor="pf-p">Sale price</label><input id="pf-p" className="input" inputMode="decimal" value={f.price} onChange={set('price')} /></div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Total cost <b className="money">{crc(math.totalCost)}</b> · margin <b className="money">{crc(math.margin)}</b> ({pct(math.marginPct)}) · sensible price {crc(math.minPrice)} – {crc(math.maxPrice)} <span className="derived">· derived</span></p>
      <div className="field"><label htmlFor="pf-no">Notes</label><input id="pf-no" className="input" value={f.notes} onChange={set('notes')} /></div>
      {err && <p className="small" role="alert" style={{ color: 'var(--expense)', margin: 0 }}>{err}</p>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {product && <button type="button" className="btn btn-ghost" style={{ marginRight: 'auto' }} onClick={async () => { await saveProduct({ ...product, archived: true }); onDone(); }}>Remove product</button>}
        <button type="submit" className="btn btn-primary">Save</button>
      </div>
    </form>
  );
}
