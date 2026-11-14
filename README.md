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

## Windows app

The desktop app (Tauri) keeps your data in one file, `colon-data.colon`, in a folder you choose (OneDrive recommended), and updates itself from GitHub Releases. See [`docs/DESKTOP_PLAN.md`](docs/DESKTOP_PLAN.md).

```bash
npm run desktop:dev      # needs Rust; on Windows also WebView2 (preinstalled on Win 10/11)
```

Releases: bump the version in `package.json` and `src-tauri/Cargo.toml`, then push a `v*` tag. GitHub Actions builds the signed installer and `latest.json`.
