// Checks every theme's accent, meaning colours and text against its ground (WCAG 4.5:1).
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../src/design/themes.css', import.meta.url), 'utf8');
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
let fail = 0;
for (const m of css.matchAll(/\[data-palette="(\w+)"\]\[data-theme="(\w+)"\] \{([^}]*)\}/g)) {
  const [, pal, mode, body] = m;
  const get = (n) => body.match(new RegExp(`--${n}: ([^;]+);`))?.[1].trim();
  const bg = hex(get('bg')), raised = hex(get('bg-raised'));
  const rows = [['text-faint', hex(get('text-faint'))], ...['accent', 'win', 'loss', 'amber'].map((n) => [n, get(n).split(/\s+/).map(Number)])];
  const out = rows.map(([n, c]) => { const r = Math.min(ratio(c, bg), ratio(c, raised)); if (r < 4.5) fail++; return `${n} ${r.toFixed(2)}${r < 4.5 ? ' ✗' : ''}`; });
  console.log(`${pal.padEnd(10)} ${mode.padEnd(5)} ${out.join('  ')}`);
}
process.exit(fail ? 1 : 0);
