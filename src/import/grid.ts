/** A workbook reduced to plain values, so the parser never depends on a library or on cell styles. */
export type CellValue = string | number | boolean | Date | null;
export interface Sheet { name: string; rows: CellValue[][] }
export interface Grid { sheets: Sheet[] }

/** Load an .xlsx (ArrayBuffer) into a Grid using exceljs. Formula cells yield their cached result. */
export async function gridFromXlsx(data: ArrayBuffer): Promise<Grid> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const sheets: Sheet[] = [];
  wb.eachSheet((ws) => {
    // rowCount can be 1,048,576 when formatting runs to the bottom; only visit rows that hold values.
    const rows: CellValue[][] = [];
    const width = Math.min(ws.columnCount, 200);
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      while (rows.length < r - 1) rows.push([]);
      const vals: CellValue[] = [];
      for (let c = 1; c <= width; c++) {
        const cell = row.getCell(c);
        // Merged cells repeat the master's value in exceljs; keep only the master.
        vals.push(cell.isMerged && cell.master.address !== cell.address ? null : normalize(cell.value));
      }
      rows.push(vals);
    });
    sheets.push({ name: ws.name, rows });
  });
  return { sheets };
}

function normalize(v: unknown): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('result' in o) return normalize(o.result);
    if ('richText' in o && Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join('');
    if ('text' in o) return String(o.text);
    if ('error' in o) return null;
  }
  return null;
}
