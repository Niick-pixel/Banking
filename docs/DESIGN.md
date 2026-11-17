# Aufwind design system (v0.9)

Calm, dense, Apple-like: warm translucent glass on a paper-coloured ground, soft spring motion, every screen fits the window.

- **Tokens**: `src/design/tokens.css` (base + aliases) and `src/design/themes.css` (Paper, Graphite, Sage, Terracotta, Ledger × light/dark). Accents and meaning colours (win, loss, amber, save) are `r g b` triples: `rgb(var(--accent) / .12)` is a tint. No component holds a literal colour. `node scripts/contrast.mjs` checks 4.5:1 on the ground.
- **Surfaces**: `.glass` = translucent fill, 1px `--glass-stroke`, a 1px highlight on the top edge only, layered shadow (`--shadow-card`, `--shadow-panel`). No blur unless Transparency → Frosted. Cards inside cards are hairline groups (`.group`). Corners scale with `--rk`.
- **Type**: system UI stack; titles 18–20px semibold; body 12–13px; field labels 10.5px uppercase, tracked, `--text-faint`; numbers `tabular-nums`; key figures 24px semibold with a faint caption and their `n`.
- **Controls**: `ChipGroup` (tap-chips; single or multi with a cap; hidden-not-disabled options with a reason; `required` dot; flashes when a save fails; arrows/digits/Space), `Segmented` (gliding pill), `.btn` / `.btn-primary` pills with keycaps, `.input` (glass, 12px), `InfoTip` ⓘ (renders at page level).
- **Layout**: the shell is the window; pages use `.fit` (a column) and put long content in `.scroll-box`. Dialogs (`Sheet`) have a header line (title, faint caption, actions), an optional context strip, the body, and a footer with the status on the left and the primary action on the right; a wide dialog keeps one size across its steps.
- **Motion**: `src/design/motion.ts`: base 340/25, snappy 520/30, bouncy 420/22.5, soft 240/21.5, size 260/30.5. Enter at opacity 0 / y+6, exit to y−6 in ~0.13s. Reduced motion: opacity only.
- **Copy**: plain, sentence case, one hint per field behind ⓘ; "Still to tap: …" in the footer; derived values say "· derived", guesses are amber and say "guess"; every number shows its n.
- **Checks before shipping**: screenshots at 1920×1080 and 1440×900 (no page scroll, columns end level, no empty blocks), light and dark, keyboard only (Tab/arrows move, digits pick, Enter confirms, Esc closes and asks first when something was entered), axe audit.
