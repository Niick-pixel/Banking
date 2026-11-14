# Windows desktop app: installer, OTA updates, data in a folder you choose

> **Status:** D1 (vault + sync engine), D2 (Tauri shell + OneDrive folder) and D3 (signed updater + release pipeline) are **built**. Choices made: **OneDrive**, **no code signing for now**. D4's conflict handling is mostly done too (merge + conflicted-copy detection). D5 (encryption + Windows Hello app lock) is also **built**. Remaining: D6 (tray icon, start with Windows).
>
> **Your one-time setup** before the first release:
> 1. GitHub → repo **Settings → Secrets and variables → Actions → New repository secret**:
>    - `TAURI_SIGNING_PRIVATE_KEY` = the full contents of `colon-updater.key`
>    - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = the contents of `updater-key-password.txt`
>    Store both files offline too (password manager / USB). Never commit them.
> 2. Merge the work into `main`, then publish a version: `git tag v0.3.0 && git push origin v0.3.0`.
> 3. Download `Aufwind_0.3.0_x64-setup.exe` from the release → run → **More info → Run anyway** (unsigned) → pick `OneDrive\Aufwind` on first launch.
> 4. From then on, every new `v*` tag reaches the installed app on its own (checked at start and every 6 h).

Goal: install Aufwind on Windows with a normal installer. It updates itself, and your data is a file in a folder you pick (inside OneDrive, Google Drive or Dropbox), so the cloud keeps it safe and you never depend on the browser's storage.

## 1. Decisions

| Topic | Choice | Why |
|---|---|---|
| Desktop shell | **Tauri 2** | Wraps the same React app. ~10 MB installer (Electron is ~150 MB). Uses Windows' built-in WebView2, which supports `backdrop-filter`, so the glass looks identical. Rust backend for file access. |
| Installer | **NSIS `.exe`** (per-user, no admin needed) | Can update itself silently. MSI is better for corporate rollout, which you don't need. |
| OTA updates | **`tauri-plugin-updater`** + **GitHub Releases** | Free hosting. Each release carries a `latest.json` manifest. The app checks it at startup and every 6 h, downloads the update, **verifies its signature**, installs and restarts. |
| Update signing | Tauri updater key pair (Ed25519 / minisign) | Mandatory. Without the private key nobody, including someone who takes over the repo, can push an update your app will accept. The private key lives only in GitHub Actions secrets and an offline backup. |
| Windows code signing | **Optional (decide later)** | Without it, SmartScreen says "Windows protected your PC → More info → Run anyway" on the *first* install. Updates aren't affected because they're verified by the updater key. Azure Trusted Signing costs ~US$10/month and removes the warning. |
| Builds | GitHub Actions `windows-latest` runner | A Windows installer can't be built in this Linux sandbox. CI builds, signs and publishes on every `v*` tag. |
| Data location | **A folder you choose** (e.g. `OneDrive\Aufwind\`) | See §3. |

> The repo is public, so release builds are public too. That's fine: the app contains **no data**. Your data only ever lives in your folder.

## 2. Release / OTA pipeline

```
git tag v0.4.0 && git push --tags
        │
        ▼
GitHub Actions (windows-latest)
  1. npm ci && npm test            ← a money-logic test failure blocks the release
  2. tauri build (NSIS)            → Aufwind_0.4.0_x64-setup.exe
  3. sign update bundle            (TAURI_SIGNING_PRIVATE_KEY secret)
  4. create GitHub Release, upload .exe + .sig + latest.json
        │
        ▼
Installed app on your PC
  on start / every 6 h → GET latest.json
  newer version? → toast "Update 0.4.0 ready — what's new: …" [Restart now] [Later]
  → download → verify signature → **snapshot your data file** → install → relaunch
```

Safety rules for updates:
- **Data migrations are versioned and forward-only.** Before any update that changes the data format, the app writes `backups/pre-update-<version>-<date>.aufwind`.
- Updates that fail the signature check are discarded and reported.
- Channels: `stable` by default. An optional `beta` toggle in Settings uses a separate `latest-beta.json`.
- "What's new" notes come from the release body.

## 3. Data in a cloud-synced folder (the hard part, done right)

Cloud sync clients (OneDrive, Google Drive, Dropbox) are **not** safe for a live database file. If they upload a SQLite file mid-write, or two PCs edit at once, you get corruption or "conflicted copy" files. So:

**Working store vs. vault file**
- The app works on a **local working database** in AppData (fast, never touched by sync).
- After every change (debounced ~2 s) and on close, it writes a **vault file** to your folder:
  `<your folder>/Colon/aufwind-data.aufwind`. This is one JSON document (optionally encrypted, see below) holding every record.
- Writes are **atomic**: write `aufwind-data.aufwind.tmp` → flush → rename over the old file. The sync client only ever sees a complete file.

**Folder layout**
```
OneDrive/Aufwind/
  aufwind-data.aufwind            ← the vault (source of truth across devices)
  backups/
    2026-11-14.aufwind          ← daily snapshot, keeps 30 daily + 12 monthly
    pre-update-0.4.0.aufwind
    pre-import-<batch>.aufwind  ← before every Excel import
  exports/                    ← XLSX/CSV/PDF you generate
  attachments/                ← receipt photos, by id
```

**Opening the app**
1. Read the vault's header: `{ formatVersion, revision, savedAt, deviceId, checksum }`.
2. If the vault's `revision` is newer than the working DB (you used another PC), load it.
3. If both changed since the last common revision, show a **conflict screen** instead of guessing: "This PC: 3 changes · Vault: 5 changes". Records merge by id and `updatedAt`. True conflicts (same record edited on both) are listed for you to pick.
4. If the checksum fails (a truncated sync), fall back to the newest good backup and tell you.
5. Sync "conflicted copy" files the cloud client creates (e.g. `aufwind-data (1).aufwind`) are detected and offered for merge.

**Encryption (optional, recommended because the folder lives in a cloud)**
- Password → PBKDF2-SHA256 (600k iterations) → AES-256-GCM via WebCrypto.
- The cloud provider then only stores ciphertext.
- If you forget the password, the data can't be recovered. The app makes you confirm you've stored it, and Windows Hello can unlock a locally cached key.

**Browser/PWA version keeps working**
- It uses the same vault format: Settings → Export/Import vault.
- In Chromium browsers it can also link the folder directly (File System Access API).

## 4. Implementation phases (desktop track)

These slot in after the core ledger and import, because they wrap a working app.

| Step | Work | Done when |
|---|---|---|
| D1 | Storage adapter: one `persist()` interface, Dexie (web) and Tauri file backend. Vault format + checksums + atomic write. | Unit tests: round-trip, truncated-file recovery, merge by `updatedAt`. |
| D2 | Tauri 2 scaffold (`src-tauri/`), folder picker on first run, backups rotation, "Open data folder" button. | `tauri dev` runs; vault appears in the chosen folder. |
| D3 | Updater plugin + signing keys + `latest.json`. GitHub Actions release workflow. | Tag `v0.x.0-test` → installer on Releases → an older installed build updates itself. |
| D4 | Conflict screen, conflicted-copy detection, pre-update/pre-import snapshots. | Simulated two-device edit merges correctly. |
| D5 | Optional encryption + Windows Hello unlock, auto-lock. | Vault unreadable without the password; a wrong password never corrupts it. |
| D6 | Polish: tray icon (quick add), start with Windows (optional), file association for `.aufwind`, code signing if you choose it. | |

## 5. What you'll need to do (once)

1. Choose the folder (inside OneDrive / Google Drive / Dropbox) on the first launch.
2. In GitHub repo **Settings → Secrets → Actions**, add `TAURI_SIGNING_PRIVATE_KEY` and its password. I'll generate the key pair and walk you through it. Keep the offline copy somewhere safe: losing it means future updates must be installed manually once.
3. Decide on code signing (§1). It's optional.
