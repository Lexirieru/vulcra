# landingpage/ — marketing site (separate from the dApp)

The public **landing/marketing** experience for Vulcra — animation-heavy, storytelling. This is NOT
the app (that's `frontend/`); it shares no code with it. Repurposed from a GSAP creative-agency
template ("truus"), with Vulcra content (XRP → FXRP → borrow vUSD, Coston2).

## Stack

- **Next.js 15** (App Router) — **JavaScript**, not TypeScript (`.jsx`, `jsconfig.json`).
- **GSAP 3** (scroll-driven animation) + **Lenis** (smooth scroll). No Three.js.
- Single page: `app/page.jsx` composes the section components.

## Layout

- `app/` — `page.jsx` (the landing), `layout.jsx`, `globals.css`, `styles/` (per-section CSS).
- `components/` — section/effect components: `VimeoHero`, `Showreel`, `DoubleMarquee`,
  `HorizontalWords`, `MotionCards`, `ServiceCards`, `Navbar`, `Footer`, `SmoothScroll` (Lenis),
  `CursorBubble`, `TransitionScribble`, `SvgSymbols`.
- `lib/`, `public/` (assets), `docs/`.

## Run

```bash
npm install
npm run dev            # Next dev — DEFAULT PORT 3000
```

> ⚠️ **Port clash:** the dApp (`frontend/`) also uses `:3000`. Run the landing on another port when
> both are up: `npm run dev -- -p 3001` (or start only one at a time).

## QA notes (static)

- The npm package is still named **`truus`** (template default) — rename to something Vulcra-specific
  before it ships.
- Template residue remains in `app/styles/navbar.css` / `responsive.css` class names/comments (cosmetic).
- `VimeoHero` embeds Vimeo (external) — verify the video id/asset is Vulcra's, not the template's, and
  that it degrades gracefully offline.
- Heavy GSAP/Lenis motion — check `prefers-reduced-motion` before considering it done.

## 🔒 Security
Secrets (if any) only in gitignored `.env`. Never commit `.env`, `references/`, or `VULCRA_PRD.md`.
