import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mergeImported, parseInventory, productMath, restock, sales, stockOf, unitsSold } from './inventory';
import type { Product, Transaction } from './schemas';
import type { Grid } from '../import/grid';

const prod = (id: string, over: Partial<Product> = {}): Product => ({ id, code: id, name: `P ${id}`, category: '', currency: 'CRC', unitCost: 1_000_000, shipping: 200_000, price: 2_000_000, stockIn: 2, stockOut: 0, notes: '', archived: false, restocks: [], createdAt: 0, updatedAt: 0, ...over });
const sale = (id: string, productId: string, qty: number, amount: number): Transaction => ({ id, kind: 'income', date: '2026-11-20', dateEstimated: false, currency: 'CRC', description: '', tags: [], notes: '', to: { accountId: 'chk' }, amount, categoryId: 'sales', productId, qty, createdAt: 0, updatedAt: 0 });

describe('inventory', () => {
  it('derives stock from added − removed − sold', () => {
    const p = prod('a', { stockIn: 5, stockOut: 1 });
    const sold = unitsSold([sale('s1', 'a', 2, 1), sale('s2', 'b', 9, 1)]);
    expect(stockOf(p, sold)).toBe(2);
    expect(stockOf(p, unitsSold([]))).toBe(4); // deleting the sale gives the units back
  });
  it('matches the workbook formulas', () => {
    const m = productMath({ unitCost: 1_000_000, shipping: 200_000, price: 2_000_000 }, { min: 0.2, max: 0.55 });
    expect(m.totalCost).toBe(1_200_000);
    expect(m.margin).toBe(800_000);
    expect(m.marginPct).toBeCloseTo(0.4, 6);
    expect(m.minPrice).toBe(1_500_000);
    expect(m.maxPrice).toBe(2_666_667);
  });
  it('restock: new cost or weighted average with what is on the shelf', () => {
    const p = prod('a', { unitCost: 1_000_000, shipping: 0 });
    const r = { date: '2026-11-25', qty: 2, unitCost: 1_600_000, shipping: 100_000 };
    expect(restock(p, 2, r, 'new')).toMatchObject({ stockIn: 4, unitCost: 1_600_000, shipping: 100_000 });
    expect(restock(p, 2, r, 'average')).toMatchObject({ stockIn: 4, unitCost: 1_300_000, shipping: 50_000 });
    expect(restock(p, 2, r, 'new').restocks).toHaveLength(1);
  });
  it('a sale keeps the cost it had when sold', () => {
    const t = { ...sale('s1', 'a', 1, 2_000_000), costEach: 500_000 };
    expect(sales([t], new Map([['a', prod('a')]]))[0]!.profit).toBe(1_500_000);
  });
  it('profit per sale', () => {
    const r = sales([sale('s1', 'a', 2, 4_600_000)], new Map([['a', prod('a')]]));
    expect(r[0]!.profit).toBe(4_600_000 - 2 * 1_200_000);
  });
  it('reads a sheet by its headers and finds the margins', () => {
    const grid: Grid = { sheets: [
      { name: 'Ventas', rows: [['Fecha', 'Código', 'Producto', 'Cantidad'], [null, 'X-1', 'thing', 1]] },
      { name: 'Inventario', rows: [['Catálogo'], ['Margen mínimo:', 0.2, 'Margen máximo:', 0.55], ['Código', 'Producto', 'Categoría', 'Costo unitario (₡)', 'Envío por unidad (₡)', 'Costo total (₡)', 'Precio de venta (₡)', 'Margen (₡)', 'Stock actual', 'Notas'],
        ['X-1', 'Lamp', 'Home', 10000, 5000, 15000, 24000, 9000, 2, 'nice'], [null, null, null, null, null, 0, null, 0, null, null]] },
    ] };
    const r = parseInventory(grid)!;
    expect(r.sheet).toBe('Inventario');
    expect(r.margins).toEqual({ min: 0.2, max: 0.55 });
    expect(r.products).toEqual([{ code: 'X-1', name: 'Lamp', category: 'Home', unitCost: 1_000_000, shipping: 500_000, price: 2_400_000, stock: 2, notes: 'nice' }]);
  });
  it('re-import updates by code and keeps "on hand" equal to the sheet', () => {
    const existing = [prod('a', { code: 'X-1', stockIn: 5 })];
    const { products, added, updated } = mergeImported([{ code: 'X-1', name: 'Lamp', category: '', unitCost: 1, shipping: 0, price: 2, stock: 3, notes: '' }, { code: 'X-2', name: 'New', category: '', unitCost: 1, shipping: 0, price: 2, stock: 1, notes: '' }], existing, new Map([['a', 2]]), () => 'n1', 9);
    expect([added, updated]).toEqual([1, 1]);
    expect(stockOf(products[0]!, new Map([['a', 2]]))).toBe(3);
  });
});

const REAL = 'private/store.xlsx';
describe.runIf(existsSync(REAL))('store workbook (local only)', () => {
  it('reads every product row (no business data asserted: the repo is public)', async () => {
    const { gridFromXlsx } = await import('../import/grid');
    const buf = readFileSync(REAL);
    const r = parseInventory(await gridFromXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)))!;
    expect(r.products.length).toBeGreaterThan(0);
    expect(r.products.every((p) => p.name && p.price >= 0 && Number.isInteger(p.stock))).toBe(true);
    expect(r.margins).toBeDefined();
  });
});
