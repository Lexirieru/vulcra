# `@/components/ui` — Vulcra shared primitives (Enosys reskin)

Owner: **Worker A2**. Import everything from `@/components/ui` (barrel). All
colors come from the `--color-*` / `--font-*` tokens A1 defines in
`globals.css` (spec §2) via `var()` arbitrary values — no hardcoded hex.
Everything is server-component-safe (no `"use client"`, no handlers except
where noted). The global `:focus-visible` ring covers focus styling; all
interactive elements are real `<button>`/`<a>`/`<Link>` with ≥40px hit targets.

## Layout & surfaces

### `Card`
White surface, radius 20px, 1px `--color-line` border, soft shadow.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `padded` | `boolean` | `true` | `false` removes the `p-5 sm:p-6` padding (used by `SectionCard`). |
| …rest | `div` props | — | `className`, `children`, etc. spread onto the `<div>`. |

### `CardTitle`
`<h2>` styled `text-base font-semibold` ink. Accepts all heading props.

### `SectionCard`
Titled card (Enosys detail card): header row (icon · title/subtitle · action),
then content.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `title` | `ReactNode` | required | Rendered as `<h2>`. |
| `subtitle` | `ReactNode` | — | Muted line under the title. |
| `icon` | `ReactNode` | — | e.g. `<TokenIcon symbol="vUSD" />` or `<Sticker …/>`. |
| `action` | `ReactNode` | — | Right side of the header, e.g. a `PillButton`. |
| `bleed` | `boolean` | `false` | Removes content side-padding so a `DataTable` runs edge-to-edge (the table's first/last cells add their own gutter). |
| `className`, `children` | | | |

```tsx
<SectionCard title="Borrow vUSD" subtitle="against various collateral assets" bleed>
  <DataTable columns={cols} rows={rows} caption="Borrow markets" />
</SectionCard>
```

### `HeroCard`
The big Dashboard "Borrow"/"Earn" cards. Renders one whole-card `<Link>`
(min-height 208–224px, radius 24px, white text, arrow chip that nudges on
hover; motion is killed globally under `prefers-reduced-motion`).

| Prop | Type | Default | Notes |
|---|---|---|---|
| `tone` | `'navy' \| 'blue'` | required | navy = Borrow, blue = Earn. |
| `title` | `ReactNode` | required | Big headline. |
| `desc` | `ReactNode` | required | Small copy under the title. |
| `icon` | `ReactNode` | — | Top-left slot, e.g. `<TokenIcon symbol="vUSD" size={44} />`. |
| `href` | `string` | required | Internal route (`/borrow`, `/earn`). |
| `className` | `string` | — | |

## Actions

### `PillButton`
Rounded-full CTA. Renders a real `<button>` by default; with `href` it renders
a Next `<Link>` (href starting `/` or `#`) or plain `<a>` (external). All sizes
are ≥40px tall.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `variant` | `'primary' \| 'ghost' \| 'dark'` | `'primary'` | primary = brand pink; ghost = hairline border on transparent; dark = navy. |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Heights 40 / 44 / 48px. |
| `href` | `string` | — | Switches to link rendering. |
| `as` | `'button' \| 'a'` | inferred | Only a type-level hint; `href` decides the element. |
| `disabled` | `boolean` | — | On links renders `aria-disabled` + unfocusable. |
| …rest | button/anchor props | — | `onClick`, `type` (default `"button"`), `target`, … |

```tsx
<PillButton href={`/borrow/${branch.key}`} size="sm" variant="ghost">Borrow</PillButton>
```

### `Button` *(legacy — kept for the pre-reskin utility pages)*
Same API as before (`variant: 'primary' | 'secondary' | 'ghost' | 'danger'`,
`size: 'sm' | 'md' | 'lg'`, button props), restyled to the light theme and
rounded-full. New code should prefer `PillButton`.

## Data display

### `DataTable<T>`
Enosys-style table: `--color-surface-2` header band, hairline row dividers,
hover rows, horizontal scroll wrapper. Purely presentational — put links or
`PillButton`s in cells rather than row click handlers.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `columns` | `DataTableColumn<T>[]` | required | See below. |
| `rows` | `T[]` | required | |
| `rowKey` | `(row, i) => React.Key` | index | Pass a real key for dynamic lists. |
| `caption` | `string` | — | Screen-reader-only `<caption>` (recommended). |
| `empty` | `ReactNode` | `"—"` | Shown in a full-width cell when `rows` is empty. |
| `rowClassName` | `(row, i) => string \| undefined` | — | e.g. `"opacity-50"` for greyed "Soon" rows. |
| `className` | `string` | — | On the scroll wrapper. |

`DataTableColumn<T>`: `{ key: string; header: ReactNode; align?: 'left'|'right'|'center'; cell: (row, i) => ReactNode; headerClassName?; cellClassName? }`.
**Use `align: 'right'` for every numeric column** — it also applies `tabular-nums`.

```tsx
const cols: DataTableColumn<Branch>[] = [
  { key: "coll", header: "Collateral", cell: (b) => (
      <span className="flex items-center gap-2.5">
        <TokenIcon symbol={b.collateralSymbol} alt="" /> {b.label}
      </span>
    ) },
  { key: "rate", header: "Avg rate p.a.", align: "right", cell: (b) => <RatePill value={b.rate ?? "—"} /> },
  { key: "cta", header: <span className="sr-only">Action</span>, align: "right",
    cell: (b) => <PillButton size="sm" variant="ghost" href={`/borrow/${b.key}`}>Borrow</PillButton> },
];
```

### `Badge`
Pill chip. `tone`: `'neutral' | 'brand' | 'blue' | 'navy' | 'green' | 'orange' | 'warning' | 'danger'`
(+ legacy aliases `'ember'`→brand, `'healthy'`→green). Spreads `<span>` props.

### `RatePill`
Badge preset for rates: semibold + `tabular-nums`.

| Prop | Type | Default |
|---|---|---|
| `value` | `ReactNode` | required — e.g. `"5.2% p.a."` |
| `tone` | `BadgeTone` | `'green'` |
| `className` | `string` | — |

### `Stat` *(legacy)*
Vertical stat block: `{ label: string; value: ReactNode; sub?: ReactNode; tone?: 'neutral'|'healthy'|'green'|'warning'|'danger' }`.

### `StatItem`
Compact inline stat for the fixed bottom stats bar (B1): `icon · label · value`
in one row, nowrap.

| Prop | Type | Default |
|---|---|---|
| `label` | `ReactNode` | required |
| `value` | `ReactNode` | required — semibold, `tabular-nums` |
| `icon` | `ReactNode` | — e.g. `<TokenIcon symbol="FXRP" size={18} alt="" />` |
| `className` | `string` | — |

## Brand

### `TokenIcon`
Circular token chip. Symbol lookup is case-insensitive:
FXRP/XRP/STXRP → `/brand/logos/xrp.svg`; FLR/WFLR/C2FLR/WC2FLR/SFLR →
`/brand/logos/flare.svg`; vUSD → white "V" on a brand-pink coin
(`vusd-mark.svg` is a white glyph — never render it without this chip).
Unknown symbols render a lettered fallback chip.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `symbol` | `string` | required | |
| `size` | `number` | `28` | Chip diameter in px. |
| `alt` | `string` | `` `${symbol} logo` `` | Pass `alt=""` when the symbol text sits right next to it (marks it decorative). |
| `className` | `string` | — | |

### `Sticker`
Landing-page sticker SVG, decorative by default (`alt=""` + `aria-hidden`).

| Prop | Type | Default | Notes |
|---|---|---|---|
| `name` | `StickerName` | required | `sticker-camera/hand/heart/phone/smiley`, `footer-sticker-100/boom/camera/hands/heart/smiley`, `star-blob`. Paths resolve to `/brand/stickers/…`, `/brand/footer-stickers/…`, `/brand/star-blob.svg`. |
| `size` | `number` | `64` | px box. |
| `rotate` | `number` | `0` | Degrees of playful tilt, e.g. `-8`. |
| `alt` | `string` | `""` | Set only if the sticker carries meaning. |
| `className` | `string` | — | |

### `Wordmark`
The Vulcra brand mark, `fill="currentColor"` (set color via text classes).

| Prop | Type | Default | Notes |
|---|---|---|---|
| `variant` | `'script' \| 'mark'` | `'script'` | script = cursive "Vulcra" inline-SVG `<text>` (italic 700, `--font-script`), same as the landing nav; mark = small coin (white vUSD "V" on brand-pink circle). |
| `size` | `number` | `40` / `28` | Height in px (script keeps the landing's 4:1 ratio; mark is a circle). |
| `className` | `string` | — | e.g. `text-[var(--color-ink)]` on the script variant. |

## Forms & states *(legacy, restyled light)*

- `Input` — `forwardRef` `<input>`: h-11, radius 12px, hairline border,
  `tabular-nums`, brand border on focus. All input props.
- `Field({ label, htmlFor, hint?, error?, children })` — label + control +
  hint/error line.
- `Skeleton({ className })` — pulse block (`aria-hidden`).
- `EmptyState({ title, description?, action? })` — dashed placeholder card.
- `ErrorState({ title?, description?, onRetry? })` — danger-tinted card;
  `onRetry` needs a client component.
