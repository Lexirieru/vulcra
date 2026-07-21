# Vulcra brand assets — final URL map (A1 theme)

Copied from `../landingpage/public/` per `FE_ENOSYS_SPEC.md` §1. Reference these
with plain `<img src="…">` / `next/image` / CSS `url(…)` — paths are absolute
from the site root.

## Logos — `/brand/logos/`

| URL | What it is | Use for |
| --- | --- | --- |
| `/brand/logos/xrp.svg` | XRP "X" mark, dark | `TokenIcon` FXRP · XRP on light surfaces |
| `/brand/logos/xrp-white.svg` | XRP mark, white | XRP on dark surfaces (navy/blue hero cards) |
| `/brand/logos/xrp.png` | XRP raster fallback | og-images / places SVG can't go |
| `/brand/logos/flare.svg` | Flare mark, colour | `TokenIcon` WFLR / WC2FLR / FLR on light surfaces |
| `/brand/logos/flare-white.svg` | Flare mark, white | FLR on dark surfaces |
| `/brand/logos/flare.png` | Flare raster fallback | og-images / raster contexts |
| `/brand/logos/vusd-mark.svg` | Cursive "V" coin glyph, **white** | vUSD `TokenIcon` — needs a coloured chip behind it (brand pink/navy); invisible on white |
| `/brand/logos/vusd-white.svg` | vUSD wordmark, white | vUSD branding on dark surfaces |

## Card stickers — `/brand/stickers/` (was "Card-Sticker SVG")

`/brand/stickers/sticker-camera.svg` · `sticker-hand.svg` · `sticker-heart.svg`
· `sticker-phone.svg` · `sticker-smiley.svg`

For the `Sticker` UI primitive (playful accents on cards, Enosys-style warmth).

## Footer stickers — `/brand/footer-stickers/` (was "Footer-Sticker SVG")

`/brand/footer-stickers/footer-sticker-100.svg` · `footer-sticker-boom.svg`
· `footer-sticker-camera.svg` · `footer-sticker-hands.svg`
· `footer-sticker-heart.svg` · `footer-sticker-smiley.svg`

Footer / stats-bar decorations.

## Misc

| URL | What it is |
| --- | --- |
| `/brand/star-blob.svg` | Orange star blob (was "Navbar SVG/nav-work-blob.svg") — nav accent behind the active tab / labels |

## Fonts — `/fonts/`

| URL | Family | Notes |
| --- | --- | --- |
| `/fonts/Epilogue-VariableFont_wght.ttf` | Epilogue (wght 100–900) | body/UI — already wired via `next/font/local` in `layout.tsx`; use the `--font-sans` token, don't re-declare |
| `/fonts/DMSans-VariableFont_opsz,wght.ttf` | DM Sans (opsz+wght) | alt face — `--font-alt` token |

## Tokens

Colour/font tokens live in `src/app/globals.css` (`@theme`) — see
`FE_ENOSYS_SPEC.md` §2. Use Tailwind utilities (`bg-bg`, `bg-surface`,
`text-ink`, `text-muted`, `border-line`, `bg-brand`, `text-brand-ink`,
`bg-blue`, `bg-navy`, `text-green`, `font-sans`, `font-alt`, `font-display`,
`font-script`, …) — no hardcoded hex in components.
