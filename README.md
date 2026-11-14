# Colón

A local-first personal finance and banking tracker for Costa Rica (CRC/USD, quincenas, aguinaldo, Asociación Solidarista), with a liquid-glass UI. It replaces a hand-built Excel workbook.

- Spec: see the build brief. Plan, decisions and open questions: [`docs/PLAN.md`](docs/PLAN.md)
- Money is stored as integer céntimos only (`src/lib/money.ts`).
- Your data stays in your browser (IndexedDB). `.xlsx` files are git-ignored so personal workbooks never get committed.

```bash
npm install
```

```bash
npm run dev      # then open http://localhost:5173/design
```

```bash
npm test
```
