/**
 * Store inventory: products, stock on hand, margins and sales.
 * Stock is derived (stockIn − stockOut − units sold), so deleting or undoing a sale
 * gives the units back without any bookkeeping.
 */
import type { CellValue, Grid } from '../import/grid';
import type { Product, Transaction } from './schemas';

export interface MarginPrefs { min: number; max: number }
export const DEFAULT_MARGINS: MarginPrefs = { min: 0.2, max: 0.55 };

/** Units sold per product, from movements that reference it. */
export function unitsSold(txs: Transaction[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of txs) if (t.productId && t.kind === 'income') out.set(t.productId, (out.get(t.productId) ?? 0) + (t.qty ?? 1));
  return out;
}

export function stockOf(p: Product, sold: Map<string, number>): number {
  return p.stockIn - p.stockOut - (sold.get(p.id) ?? 0);
}

export interface ProductMath {
  totalCost: number; margin: number; marginPct: number; minPrice: number; maxPrice: number;
}
/** Same formulas as the workbook: total cost = cost + shipping; min/max price give the chosen margins. */
export function productMath(p: Pick<Product, 'unitCost' | 'shipping' | 'price'>, m: MarginPrefs = DEFAULT_MARGINS): ProductMath {
  const totalCost = p.unitCost + p.shipping;
  const margin = p.price - totalCost;
  return {
    totalCost, margin, marginPct: p.price ? margin / p.price : 0,
    minPrice: Math.round(totalCost / (1 - m.min)), maxPrice: Math.round(totalCost / (1 - m.max)),
  };
}

export interface SaleRow { tx: Transaction; product?: Product; qty: number; revenue: number; cost: number; profit: number }
/** Every sale (income movement with a product), newest first, with its profit at today's product cost. */
export function sales(txs: Transaction[], products: Map<string, Product>): SaleRow[] {
  return txs.filter((t) => t.kind === 'income' && t.productId).map((t) => {
    const product = products.get(t.productId!);
    const qty = t.qty ?? 1;
    const revenue = t.kind === 'income' ? t.amount : 0;
    const cost = product ? (product.unitCost + product.shipping) * qty : 0;
    return { tx: t, product, qty, revenue, cost, profit: revenue - cost };
  }).sort((a, b) => b.tx.date.localeCompare(a.tx.date) || b.tx.createdAt - a.tx.createdAt);
}

// ── Import from the store workbook (sheet "Inventario") ─────────────────────
const norm = (v: CellValue | undefined) => (v === null || v === undefined ? '' : String(v).trim().replace(/\s+/g, ' '));
const key = (v: CellValue | undefined) => norm(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const num = (v: CellValue | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v.replace(/[₡,\s]/g, ''))) ? Number(v.replace(/[₡,\s]/g, '')) : null);
const minor = (v: CellValue | undefined) => Math.max(0, Math.round((num(v) ?? 0) * 100));

const COLS: Record<keyof ImportedProduct, RegExp> = {
  code: /^(codigo|code|sku)/, name: /^(producto|product|nombre|name)/, category: /^(categoria|category)/,
  unitCost: /^(costo unitario|unit cost|costo$)/, shipping: /^(envio|shipping)/, price: /^(precio de venta|sale price|price|precio$)/,
  stock: /^(stock|existencia|cantidad|qty)/, notes: /^(notas|notes)/,
};
export interface ImportedProduct { code: string; name: string; category: string; unitCost: number; shipping: number; price: number; stock: number; notes: string }
export interface InventoryImport { sheet: string; products: ImportedProduct[]; margins?: MarginPrefs }

/** Find the inventory sheet by its header row (Código / Producto / …), never by cell positions. */
export function parseInventory(grid: Grid): InventoryImport | null {
  const sheets = [...grid.sheets].sort((a, b) => Number(/invent/i.test(b.name)) - Number(/invent/i.test(a.name)));
  for (const sh of sheets) {
    const h = sh.rows.findIndex((r) => r.some((c) => COLS.name.test(key(c))) && r.some((c) => COLS.price.test(key(c)) || COLS.stock.test(key(c))));
    if (h < 0) continue;
    const head = sh.rows[h]!;
    const col = Object.fromEntries((Object.keys(COLS) as (keyof ImportedProduct)[]).map((k) => [k, head.findIndex((c) => COLS[k].test(key(c)))])) as Record<keyof ImportedProduct, number>;
    const products: ImportedProduct[] = [];
    for (const r of sh.rows.slice(h + 1)) {
      const name = norm(r[col.name]);
      if (!name) continue;
      products.push({
        code: col.code >= 0 ? norm(r[col.code]) : '', name, category: col.category >= 0 ? norm(r[col.category]) : '',
        unitCost: col.unitCost >= 0 ? minor(r[col.unitCost]) : 0, shipping: col.shipping >= 0 ? minor(r[col.shipping]) : 0,
        price: col.price >= 0 ? minor(r[col.price]) : 0, stock: col.stock >= 0 ? Math.max(0, Math.round(num(r[col.stock]) ?? 0)) : 0,
        notes: col.notes >= 0 ? norm(r[col.notes]) : '',
      });
    }
    // "Margen mínimo: 0.2 · Margen máximo: 0.55" above the header.
    let margins: MarginPrefs | undefined;
    for (const r of sh.rows.slice(0, h)) {
      const iMin = r.findIndex((c) => /margen minimo|min(imum)? margin/.test(key(c)));
      const iMax = r.findIndex((c) => /margen maximo|max(imum)? margin/.test(key(c)));
      const a = iMin >= 0 ? num(r[iMin + 1]) : null, b = iMax >= 0 ? num(r[iMax + 1]) : null;
      if (a !== null && b !== null && a >= 0 && a < 1 && b >= 0 && b < 1) margins = { min: a, max: b };
    }
    return { sheet: sh.name, products, margins };
  }
  return null;
}

/** Imported rows → products, matching existing ones by code (or name) so a re-import updates instead of duplicating. */
export function mergeImported(rows: ImportedProduct[], existing: Product[], sold: Map<string, number>, newId: () => string, now: number): { products: Product[]; added: number; updated: number } {
  let added = 0, updated = 0;
  const products = rows.map((r) => {
    const match = existing.find((p) => (r.code && p.code === r.code) || (!r.code && p.name.toLowerCase() === r.name.toLowerCase()));
    if (match) {
      updated++;
      // The sheet's stock is "on hand now": keep units already sold in the app and set stockIn so on-hand equals it.
      const stockIn = r.stock + match.stockOut + (sold.get(match.id) ?? 0);
      return { ...match, code: r.code || match.code, name: r.name, category: r.category, unitCost: r.unitCost, shipping: r.shipping, price: r.price, stockIn, notes: r.notes || match.notes, archived: false, updatedAt: now };
    }
    added++;
    return { id: newId(), code: r.code, name: r.name, category: r.category, currency: 'CRC' as const, unitCost: r.unitCost, shipping: r.shipping, price: r.price, stockIn: r.stock, stockOut: 0, notes: r.notes, archived: false, createdAt: now, updatedAt: now };
  });
  return { products, added, updated };
}
