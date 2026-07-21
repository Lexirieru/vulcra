# Vulcra dApp — Enosys-style reskin (MASTER SPEC — single source of truth)

**PM: Fable. Workers: Opus 4.8 xhigh.** Read this fully before touching code. It is the
contract that keeps 6 parallel workers consistent. Do not deviate from token names,
component APIs, or file ownership without saying so in your `worker_done`.

## 0. Mission
Reskin the existing Vulcra dApp (`frontend/`, Next.js src/app, TS, wagmi/reown, XRPL)
to **look and flow like Enosys Loans** (`loans.enosys.global`) **using the landing
page's design language** (fonts, colours, stickers, SVGs, cursive wordmark).
This is a **UI reskin + restructure, NOT a rewrite** — keep ALL existing logic, hooks,
contract wiring, and no-mock real data. Our stablecoin is **vUSD** (Enosys calls it
"CDP Dollar" — we use **vUSD** everywhere).

Direction: **light theme** (Enosys is light; our landing is cream/light). Clean tables +
cards like Enosys, warmed with the landing's playful accents (stickers, cursive wordmark,
brand pink/blue). Drop the old dark "forge/ember" theme entirely.

## 1. Landing assets — copy into the dApp (MANDATORY to reuse)
Source: `../landingpage/public/` (same worktree). Worker A1 copies these into
`frontend/public/brand/`:
- `assets/logos/` → xrp.svg, xrp-white.svg, flare.svg, flare-white.svg, vusd-mark.svg, vusd-white.svg, xrp.png, flare.png
- `assets/Card-Sticker SVG/` → sticker-camera/hand/heart/phone/smiley.svg
- `assets/Footer-Sticker SVG/` → footer-sticker-100/boom/camera/hands/heart/smiley.svg
- `assets/Navbar SVG/nav-work-blob.svg` (orange star blob)
- fonts: `public/fonts/Epilogue-VariableFont_wght.ttf`, `public/fonts/DMSans-VariableFont_opsz,wght.ttf`
Keep folder names kebab/simple (rename "Card-Sticker SVG" → `stickers/`). Document the
final paths in `frontend/public/brand/README.md` so page workers know the URLs.

## 2. Design tokens — Worker A1 writes these into `globals.css` (@theme)
Light palette derived from the landing (`landingpage/app/styles/base.css`):
```
--color-bg:        #f0ebe6   /* cream page bg */
--color-surface:   #ffffff   /* cards */
--color-surface-2: #f6f2ee   /* subtle panels / table header */
--color-ink:       #1a1a1a   /* primary text */
--color-muted:     #6b6560
--color-line:      #e4ddd4   /* borders */
--color-brand:     #E62058   /* Flare/Vulcra pink — primary CTA */
--color-brand-ink: #ffffff
--color-blue:      #4b69f0   /* Enosys-like accent card / "Earn" */
--color-navy:      #10142b   /* dark hero card ("Borrow") */
--color-green:     #29725f   /* healthy */
--color-orange:    #f5693c
--color-maroon:    #a0325a
--color-warning:   #e8a13a
--color-danger:    #e5484d
--font-sans: 'Epilogue', ui-sans-serif, system-ui, sans-serif;   /* body/UI */
--font-alt:  'DM Sans', var(--font-sans);
--font-display: 'Times New Roman', Georgia, serif;               /* italic accents */
--font-script: 'Brush Script MT','Snell Roundhand','Segoe Script', cursive; /* Vulcra wordmark */
```
Fonts via `@font-face` (or next/font/local) in A1. Body: cream bg, ink text, Epilogue.
Keep the existing `:focus-visible` ring + `prefers-reduced-motion` block (recolour ring to brand).

## 3. Shared UI primitives — Worker A2 builds in `frontend/src/components/ui/`
Keep `cn()`. Export these (TypeScript, accessible: real button/a, focus rings, ≥40px hit):
- `Card({className, children})` — white surface, radius 20px, 1px `--color-line`, soft shadow.
- `SectionCard({title, subtitle?, icon?, action?, children})` — titled card (Enosys detail card).
- `HeroCard({tone: 'navy'|'blue', title, desc, icon, href})` — the big Borrow/Earn cards.
- `PillButton({variant:'primary'|'ghost'|'dark', size?, as?, href?, ...})` — rounded-full; primary = brand pink.
- `DataTable({columns, rows})` OR compose `<table>` — Enosys style: light header row, hairline row dividers, right-aligned numerics, hover row.
- `TokenIcon({symbol, size?})` — maps FXRP→xrp.svg, WFLR/WC2FLR→flare.svg (wrap FLR), vUSD→vusd-mark.svg, XRP→xrp.svg, FLR→flare.svg. Circular chip.
- `Sticker({name, size?, rotate?})` — renders a landing sticker svg from `/brand/stickers/…`.
- `Wordmark({className?})` — cursive "Vulcra" (inline SVG `<text>` with `--font-script`, italic 700), same as landing nav. Also a small `mark` variant (vusd-mark.svg coin).
- `Badge({tone, children})` / `RatePill` — pill chips for rates/status.
- `StatItem({label, value, icon?})` — for the bottom stats bar.
Provide sensible props + defaults. A1 tokens exist by the time you compile; import CSS vars via Tailwind arbitrary values or utility classes. Write a short `components/ui/README.md` listing each component's props for the page workers.

## 4. Pages / layout — mirror Enosys (tabs: Dashboard · Borrow · Earn · Incentives)
Wallet address chip on the right. Bottom fixed stats bar. Keep utility routes reachable.
- **AppShell (B1)** `components/shell/AppShell.tsx`: top nav = `<Wordmark/>` (left) + tab nav [Dashboard `/`, Borrow `/borrow`, Earn `/earn`, Incentives `/incentives`] (center) + `<ConnectButton/>` (right, keep existing). Bottom **stats bar** (fixed): TVL, vUSD supply, and per-token prices (FXRP, FLR/WFLR) from `useFtsoPrice`. Footer: "Vulcra — multi-collateral CDP stablecoin on Flare Coston2 · Chain 114 · testnet". Keep `NetworkGuard`. Secondary links (Redeem, Guardian, Liquidations, XRPL mint) go in a "More"/overflow menu or within Borrow. Reuse existing `ConnectButton`, `BranchSwitch`, `NetworkGuard`, `useBranch`.
- **Dashboard (B2)** `src/app/page.tsx`: "Open your first position" H1; two `HeroCard`s (Borrow=navy, Earn=blue) exactly like Enosys copy but vUSD; then two `SectionCard`s:
  (a) "Borrow vUSD against various collateral assets" table — cols Collateral · Avg rate p.a. · Max LTV · Total debt · [Borrow→/borrow/<key>]. Rows from `BRANCHES` (fxrp, wflr live). Optionally show STXRP + SFLR as greyed "Soon" rows to match Enosys 4-row look (mark disabled). Pull live rate/LTV/debt from hooks where available; static placeholders clearly labelled otherwise.
  (b) "Earn rewards with vUSD" table — cols Pool · APR · 7d APR · Pool size · [Earn→/earn]. Stability-pool rows per collateral.
- **Borrow (B3)** `src/app/borrow/page.tsx` + `src/app/borrow/[collateral]/page.tsx`: reskin the EXISTING `components/vault/BorrowComposer.tsx` (do not rewrite its logic/hooks) into the Enosys borrow layout — collateral selector (FXRP/WFLR + soon), Collateral input, Loan (vUSD) input, Interest-rate input (% per year → vUSD/year), and a "Redemptions in a nutshell" explainer card. FXRP branch keeps the XRPL-native mint mode (existing `/xrpl` flow) surfaced here.
- **Earn + Incentives (B4)** `src/app/earn/page.tsx`, `src/app/incentives/page.tsx`: Earn = "Deposit vUSD to earn rewards" + stability-pool cards (TVL/APR/7d APR/Deposit) — **structural scaffold** (user extends with real staking later; wire what hooks exist, clearly mark placeholders, NO fake numbers presented as real). Incentives = simple Enosys-style incentives page.

## 5. Data & correctness (NO MOCKS)
- Collateral registry: `src/config/branches.ts` (fxrp, wflr; addresses/feeds there). vUSD is the shared stablecoin.
- Reuse hooks: `useFtsoPrice`, `useVault`, `useInterest`, `useVaultAction`, `usePersonalAccount`, `useXrplWallet`. Do NOT invent contract calls.
- Any value you cannot source live must be visibly a placeholder ("—" / "soon"), never a fabricated number dressed as real.
- Keep testnet/Coston2 wording. Keep `NEXT_PUBLIC_*` env-driven config.

## 6. File ownership (do NOT edit another worker's files)
- A1 theme: `globals.css`, `public/brand/**`, `public/fonts/**`, `layout.tsx` (font wiring + metadata/favicon), `components/brand/Wordmark helper if shared` (coordinate: Wordmark lives in ui/, A2 owns it — A1 only provides fonts/tokens).
- A2 uikit: `components/ui/**` only.
- B1 shell: `components/shell/AppShell.tsx`, bottom stats bar comp, footer; route group wiring. (Reuses ConnectButton/BranchSwitch/NetworkGuard as-is.)
- B2 dashboard: `src/app/page.tsx` + dashboard-only subcomponents under `components/dashboard/**`.
- B3 borrow: `src/app/borrow/**` + reskin `components/vault/BorrowComposer.tsx` (+ vault subcomponents it owns).
- B4 earn/incentives: `src/app/earn/**`, `src/app/incentives/**`, `components/earn/**`.
Shared edits to `layout.tsx` → only A1 (fonts/metadata) and B1 (AppShell mount) touch it; coordinate via worker_done notes.

## 7. Definition of done (every worker)
- `cd frontend && npm run build` (or `next build --webpack`) passes for your area (no type/lint breakers you introduced).
- Uses the design tokens + primitives (no hardcoded hex outside tokens; no old ember colours).
- Accessible: real `<button>`/`<a>`, visible focus, labels, alt/aria, ≥40px touch, responsive 375/768/1280.
- Reduced-motion respected for any animation.
- Report `worker_done` with: files changed, what's placeholder vs live, and anything the next phase must know.
