# Brand — Vulcra

_Status: active_

Vulcra — a CDP stablecoin on Flare. Forge dollars from your XRP: lock FXRP, mint vUSD, repay to unlock. Built for the Flare Summer Signal hackathon.

## Identity: Forge / Ember

Dark, industrial, molten. Vulcra "forges" dollars from XRP, so the visual language is a forge: charcoal-iron surfaces lit by ember-orange heat. Confident and concrete, never frivolous.

**Flare adjacency without copying.** Vulcra owns the **amber / ember** hue lane (OKLCH hue ≈ 45–55, molten orange → gold). Flare's own brand lives in the coral / magenta / pink warm range. Sharing the warm, energetic family signals ecosystem adjacency; the distinct hue keeps Vulcra from imitating Flare. (If Flare's exact brand hues are ever confirmed to overlap this lane, nudge Vulcra's primary hotter/more golden.)

## Palette (OKLCH authoritative; hex is an approximate display aid)

Dark is canonical (dark-first). Light is derived from the same seeds for `prefers-color-scheme: light`.

### Seeds (dark)

| Role | OKLCH | Hex (approx) |
|---|---|---|
| bg-base | `oklch(0.145 0.012 47)` | `#17120D` |
| bg-elevated | `oklch(0.195 0.016 47)` | `#221A12` |
| primary (ember) | `oklch(0.70 0.19 47)` | `#F07C2A` |
| primary-soft | `oklch(0.82 0.13 55)` | `#F7B074` |
| fg-base | `oklch(0.96 0.008 60)` | `#F4F1EA` |

### Semantic tokens — dark (canonical)

| Token | OKLCH |
|---|---|
| `--background` | `oklch(0.145 0.012 47)` |
| `--foreground` | `oklch(0.96 0.008 60)` |
| `--card` | `oklch(0.195 0.016 47)` |
| `--popover` | `oklch(0.215 0.016 47)` |
| `--primary` | `oklch(0.70 0.19 47)` |
| `--primary-foreground` | `oklch(0.16 0.02 47)` |
| `--secondary` | `oklch(0.235 0.026 47)` |
| `--muted` | `oklch(0.215 0.016 47)` |
| `--muted-foreground` | `oklch(0.72 0.02 55)` |
| `--accent` | `oklch(0.255 0.03 50)` |
| `--border` | `oklch(0.285 0.018 47)` |
| `--input` | `oklch(0.235 0.016 47)` |
| `--ring` | `oklch(0.70 0.19 47)` |
| `--destructive` | `oklch(0.62 0.21 25)` |
| `--radius` | `0.75rem` |

### Signal tokens (custom, beyond shadcn)

| Token | OKLCH | Meaning |
|---|---|---|
| `--safe` | `oklch(0.74 0.13 162)` | healthy collateral |
| `--at-risk` | `oklch(0.62 0.21 25)` | near liquidation (== destructive) |
| `--warn` | `oklch(0.80 0.15 75)` | caution / amber |

### Light mode (derived, secondary)

`--background` `oklch(0.98 0.006 70)` · `--foreground` `oklch(0.2 0.02 45)` · `--card` `oklch(1 0 0)` · `--primary` `oklch(0.56 0.19 45)` · `--primary-foreground` `oklch(0.99 0 0)`. Full set in `src/app/globals.css`.

## Gradients

- `--gradient-forge` (accent, ember → molten gold): `linear-gradient(135deg, oklch(0.70 0.19 47) 0%, oklch(0.80 0.16 78) 100%)`. Utilities: `.bg-gradient-forge`, `.text-gradient-forge`.
- `--gradient-ambient` (hero forge glow): `radial-gradient(ellipse 80% 60% at 50% -10%, oklch(0.32 0.11 47 / 0.55) 0%, transparent 62%)`. Utility: `.bg-gradient-ambient`.

## Typography

- **Geist Sans** — display + body. Hero H1 uses heavy weight + tight tracking for a forged, industrial feel.
- **Geist Mono** — numbers, ratios, addresses, code, and technical chips.

Both are wired via `next/font/google` in `src/app/layout.tsx` (`--font-geist-sans`, `--font-geist-mono`), mapped to Tailwind `font-sans` / `font-mono`. Zero extra dependency.

## Voice

Confident, concrete, a little molten. Verbs of making — *forge, mint, lock, unlock*. No hype words ("revolutionary", "the future of"). Short declaratives. Numbers where they earn trust ("$100B+", "one payment", "no FLR"). Testnet honesty in the footer (Coston2, not financial advice).

## Dos & don'ts

- **Do** keep the page dark-first; ember is an accent, not a fill — most of the page is charcoal-iron with ember highlights on CTAs, headings' accent words, and status chips.
- **Do** pull every color from a token (`bg-primary`, `text-muted-foreground`, `border-border`); never hardcode hex in components.
- **Do** keep AA contrast: body ≥ 4.5:1, large text / icons ≥ 3:1.
- **Don't** use Flare's coral/magenta as a brand color — stay in the amber/ember lane.
- **Don't** over-saturate: one ember gradient per view (hero glow + accent CTA), not on every card.
