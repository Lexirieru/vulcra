"use client";

// Enosys-style borrow composer for opening a vault (light Vulcra theme): three
// spacious cards (Collateral → Loan → Interest rate) in a single column with big
// number inputs, a collateral selector (live branches + "soon" chips), projected
// liquidation price / CR, and the interest input+slider with per-year cost.
// Wiring is unchanged — it reuses the same hooks and calls
// openVault(collateral, mint, rateBps, prevHint, nextHint).
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { zeroAddress } from "viem";
import { ArrowDown, Gauge, Info } from "lucide-react";
import { Badge, Button, Card, PillButton, TokenIcon, cn } from "@/components/ui";
import { TxStatus } from "./TxStatus";
import {
  BRANCH_ORDER,
  BRANCHES,
  type BranchKey,
  type CollateralBranch,
} from "@/config/branches";
import {
  DUR,
  EASE,
  animate,
  gsap,
  prefersReducedMotion,
  useIsomorphicLayoutEffect,
} from "@/lib/gsap";
import { useFtsoPrice } from "@/hooks/useFtsoPrice";
import { useCollateralToken, useVaultParams } from "@/hooks/useVault";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { useTokenApproval, useVaultAction, useWrapNative } from "@/hooks/useVaultAction";
import { useInterestConfig } from "@/hooks/useInterest";
import {
  annualInterest18,
  collateralValueUsd18,
  computeCrBps,
  healthBand,
  liquidationPrice18,
  maxMintableVusd18,
} from "@/lib/vault-math";
import { formatBps, formatPrice, formatToken, formatUsd, parseAmount } from "@/lib/format";

const HINTS = [zeroAddress, zeroAddress] as const;
const RISK_LABEL = { healthy: "Low", warning: "Medium", danger: "High" } as const;

// Roadmap collaterals shown greyed-out in the selector (spec §4 — match the
// Enosys four-asset look without faking live markets).
const SOON = [
  { symbol: "STXRP", title: "Staked XRP — coming soon" },
  { symbol: "SFLR", title: "Staked FLR — coming soon" },
] as const;

function InfoRow({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted">{left}</span>
      <span className="tabular-nums text-ink">{right}</span>
    </div>
  );
}

/**
 * Collateral selector — a LOCAL toggle, not navigation. Picking an asset calls
 * `onSelect`; it does not link anywhere, so the page never changes route and
 * never remounts. Same shape as the Flare ↔ XRP `RailToggle`.
 *
 * Semantics are `radiogroup`/`radio` (pick one of a set) rather than tabs: the
 * choice re-frames the whole page — header, market panel and composer — not one
 * labelled tabpanel. Roving tabindex + arrow keys, per APG. Roadmap assets stay
 * inert "soon" chips.
 *
 * The active chip is one GSAP-animated pill that slides to the selected asset.
 * It tracks offsetTop/offsetHeight as well as left/width so it stays correct
 * when the row wraps on narrow viewports. Reduced motion snaps it instead.
 */
function CollateralSelector({
  activeKey,
  onSelect,
}: {
  activeKey: BranchKey;
  onSelect: (key: BranchKey) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const itemRefs = useRef<Partial<Record<BranchKey, HTMLButtonElement | null>>>({});
  const positioned = useRef(false);
  // Bumped by a ResizeObserver so the pill re-measures on wrap / font load.
  const [resizeTick, setResizeTick] = useState(0);

  useIsomorphicLayoutEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setResizeTick((n) => n + 1));
    ro.observe(list);
    return () => ro.disconnect();
  }, []);

  useIsomorphicLayoutEffect(() => {
    const pill = pillRef.current;
    const el = itemRefs.current[activeKey];
    if (!pill || !el) return;
    const to = {
      x: el.offsetLeft,
      y: el.offsetTop,
      width: el.offsetWidth,
      height: el.offsetHeight,
    };
    // First paint parks the pill; every later change slides it — the component
    // stays mounted now, so there is always something to tween from.
    if (!positioned.current || prefersReducedMotion()) {
      positioned.current = true;
      gsap.set(pill, { ...to, autoAlpha: 1 });
    } else {
      animate(pill, { ...to, autoAlpha: 1, duration: DUR.fast, ease: EASE.thumb });
    }
    return () => {
      gsap.killTweensOf(pill);
    };
  }, [activeKey, resizeTick]);

  const select = (k: BranchKey) => {
    onSelect(k);
    itemRefs.current[k]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = BRANCH_ORDER.indexOf(activeKey);
    const step = e.key === "ArrowRight" ? 1 : BRANCH_ORDER.length - 1;
    select(BRANCH_ORDER[(i + step) % BRANCH_ORDER.length]);
  };

  return (
    <div
      ref={listRef}
      role="radiogroup"
      aria-label="Collateral asset"
      onKeyDown={onKeyDown}
      className="relative flex flex-wrap items-center gap-1 rounded-full border border-line bg-surface-2 p-1"
    >
      <span
        ref={pillRef}
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 invisible rounded-full bg-navy"
      />
      {BRANCH_ORDER.map((k) => {
        const active = activeKey === k;
        return (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            ref={(el) => {
              itemRefs.current[k] = el;
            }}
            onClick={() => onSelect(k)}
            className={cn(
              "relative z-10 inline-flex min-h-10 items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
              active ? "text-white" : "text-muted hover:text-ink",
            )}
          >
            <TokenIcon symbol={BRANCHES[k].collateralSymbol} size={20} alt="" />
            {BRANCHES[k].collateralSymbol}
          </button>
        );
      })}
      {SOON.map((s) => (
        <span
          key={s.symbol}
          aria-disabled
          title={s.title}
          className="relative z-10 inline-flex min-h-10 cursor-not-allowed items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium text-muted/60"
        >
          <TokenIcon symbol={s.symbol} size={20} alt="" className="opacity-50" />
          {s.symbol}
          <span className="text-[10px] font-semibold uppercase tracking-wide">soon</span>
        </span>
      ))}
    </div>
  );
}

/**
 * @param branch The collateral branch to compose against — fully controlled by
 * the borrow page, which owns it as local state.
 * @param onSelectBranch Called when the user picks a different asset in the
 * selector. The page swaps state; nothing navigates.
 */
export function BorrowComposer({
  branch,
  onSelectBranch,
}: {
  branch: CollateralBranch;
  onSelectBranch: (key: BranchKey) => void;
}) {
  const { address: owner } = useAccount();
  const { open } = useAppKit();
  const vaultManager = branch.vaultManager || undefined;
  const collDec = branch.collateralDecimals;

  const { price18, isStale } = useFtsoPrice(branch.feedId);
  const { params } = useVaultParams(vaultManager);
  const { config: interest } = useInterestConfig(vaultManager, branch.interest);
  const { address: collateralToken } = useCollateralToken(branch);

  const action = useVaultAction(vaultManager);
  const approval = useTokenApproval(collateralToken, vaultManager, owner);
  const wrap = useWrapNative(branch.wrapNative ? collateralToken : undefined);
  // Live wallet balance of the chosen collateral, to cap the deposit input.
  const balances = useWalletBalances(owner);
  const collBalance = balances.tokens.find((t) => t.symbol === branch.collateralSymbol)?.value;

  const [collateral, setCollateral] = useState("");
  const [mint, setMint] = useState("");
  const [rateBps, setRateBps] = useState(interest.defaultBps);
  // Text mirror so the % field is freely editable while the slider stays synced.
  const [rateText, setRateText] = useState((interest.defaultBps / 100).toString());
  const clampedRate = Math.min(Math.max(rateBps, interest.minBps), interest.maxBps);

  const [wrapAmount, setWrapAmount] = useState("");

  // Switching collateral resets ONLY the transient inputs — amounts and the
  // rate, which are denominated in the old asset and would be nonsense on the
  // new one. Done as a render-phase adjustment rather than a `key` remount or a
  // setState-in-effect: the DOM survives, so focus/scroll are kept, the framer
  // `Reveal` wrapper around this composer never re-animates, and there is no
  // extra render pass. (React's documented "adjusting state when props change".)
  const [lastBranchKey, setLastBranchKey] = useState(branch.key);
  if (lastBranchKey !== branch.key) {
    setLastBranchKey(branch.key);
    setCollateral("");
    setMint("");
    setWrapAmount("");
    setRateBps(interest.defaultBps);
    setRateText((interest.defaultBps / 100).toString());
  }

  useEffect(() => {
    if (approval.approved) approval.refetchAllowance();
  }, [approval.approved]); // eslint-disable-line react-hooks/exhaustive-deps

  const collateralAmt = parseAmount(collateral, collDec);
  const mint18 = parseAmount(mint, 18);

  const derived = useMemo(() => {
    const fee = mint18 !== null ? (mint18 * params.mintFeeBps) / 10_000n : 0n;
    const debt = mint18 !== null ? mint18 + fee : 0n;
    const collateralUsd =
      collateralAmt !== null && price18
        ? collateralValueUsd18(collateralAmt, collDec, price18)
        : undefined;
    const maxMint =
      collateralAmt !== null && price18
        ? maxMintableVusd18(collateralAmt, collDec, price18, params.mcrBps, params.mintFeeBps)
        : undefined;
    const crBps =
      collateralAmt !== null && mint18 !== null && mint18 > 0n && price18
        ? computeCrBps(collateralAmt, collDec, debt, price18)
        : null;
    const liqPrice =
      collateralAmt !== null && mint18 !== null && mint18 > 0n
        ? liquidationPrice18(collateralAmt, collDec, debt, params.mcrBps)
        : null;
    const annualCost = mint18 !== null ? annualInterest18(debt, clampedRate) : 0n;
    return {
      debt,
      collateralUsd,
      maxMint,
      crBps,
      liqPrice,
      annualCost,
      band: healthBand(crBps, params.mcrBps),
    };
  }, [collateralAmt, mint18, price18, collDec, params.mcrBps, params.mintFeeBps, clampedRate]);

  let mintError: string | undefined;
  // Only enforce the on-chain minimum once the real params() has loaded — the
  // fallback default (100 vUSD) would otherwise block every small loan for a
  // second on first paint and read as "min 100" when the true floor is 0.05.
  if (!params.isDefault && mint18 !== null && mint18 > 0n && mint18 < params.minDebt18)
    mintError = `Minimum debt is ${formatToken(params.minDebt18, 18, 2)} vUSD.`;
  else if (derived.maxMint !== undefined && mint18 !== null && mint18 > derived.maxMint)
    mintError = `Exceeds the max mint at MCR (${formatToken(derived.maxMint, 18, 2)} vUSD).`;

  const insufficientCollateral =
    collateralAmt !== null && collBalance !== undefined && collateralAmt > collBalance;

  const valid =
    Boolean(owner) &&
    collateralAmt !== null &&
    collateralAmt > 0n &&
    mint18 !== null &&
    mint18 > 0n &&
    !mintError &&
    !insufficientCollateral;

  const needsApproval =
    collateralAmt !== null &&
    collateralAmt > 0n &&
    !insufficientCollateral &&
    (approval.allowance === undefined || approval.allowance < collateralAmt);

  // Redemption-risk read from where the chosen rate sits in [min, max].
  const rateSpan = Math.max(1, interest.maxBps - interest.minBps);
  const ratePos = (clampedRate - interest.minBps) / rateSpan; // 0 lowest .. 1 highest
  const redemptionRisk = ratePos < 0.15 ? "danger" : ratePos < 0.4 ? "warning" : "green";

  const setRateFromBps = (bps: number) => {
    const next = Math.min(Math.max(bps, interest.minBps), interest.maxBps);
    setRateBps(next);
    setRateText((next / 100).toString());
  };
  const onRateTyped = (text: string) => {
    setRateText(text);
    const pct = Number.parseFloat(text);
    if (Number.isFinite(pct)) setRateBps(Math.round(pct * 100));
  };

  const wrapWei = parseAmount(wrapAmount, 18);

  return (
    <div className="flex w-full flex-col gap-4">
      {/* Card 1 — Collateral */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-medium text-muted">Collateral</span>
          <CollateralSelector activeKey={branch.key} onSelect={onSelectBranch} />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <input
            inputMode="decimal"
            placeholder="0.0"
            value={collateral}
            onChange={(e) => setCollateral(e.target.value)}
            aria-label={`${branch.collateralSymbol} to deposit`}
            className="w-full min-w-0 bg-transparent text-4xl font-semibold tabular-nums text-ink outline-none placeholder:text-muted/50"
          />
          <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-line bg-surface-2 py-1.5 pl-1.5 pr-3.5 text-base font-semibold text-ink">
            <TokenIcon symbol={branch.collateralSymbol} size={26} alt="" />
            {branch.collateralSymbol}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <span className="text-sm tabular-nums text-muted/70">
            {derived.collateralUsd !== undefined ? formatUsd(derived.collateralUsd) : "$0.00"}
          </span>
          {collBalance !== undefined && (
            <button
              type="button"
              onClick={() =>
                setCollateral(formatToken(collBalance, collDec, 6).replace(/,/g, ""))
              }
              className="min-h-10 rounded-full px-2 text-xs font-medium text-brand hover:underline"
            >
              Balance {formatToken(collBalance, collDec, 4)} {branch.collateralSymbol}
            </button>
          )}
        </div>
        {insufficientCollateral && (
          <p className="mt-2 text-xs text-danger">
            Insufficient {branch.collateralSymbol} balance — you have{" "}
            {formatToken(collBalance!, collDec, 4)}.
            {branch.wrapNative ? " Wrap more C2FLR first." : ""}
          </p>
        )}

        <div className="mt-4 space-y-1.5 border-t border-line pt-3">
          <InfoRow
            left={
              <span className="inline-flex items-center gap-1.5">
                {branch.feedLabel} price {isStale && <Badge tone="warning">stale</Badge>}
              </span>
            }
            right={formatPrice(price18)}
          />
          <InfoRow left="Min collateral ratio" right={formatBps(params.mcrBps)} />
        </div>

        {branch.wrapNative && (
          <div className="mt-4 rounded-xl border border-line bg-surface-2/70 p-3">
            <div className="text-xs text-muted">
              {branch.collateralSymbol} is wrapped C2FLR — wrap first, then deposit.
            </div>
            <form
              className="mt-2 flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (wrapWei && wrapWei > 0n) wrap.wrap(wrapWei);
              }}
            >
              <input
                inputMode="decimal"
                placeholder="C2FLR amount"
                value={wrapAmount}
                onChange={(e) => setWrapAmount(e.target.value)}
                aria-label="C2FLR to wrap"
                className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm tabular-nums text-ink outline-none placeholder:text-muted/60 focus:border-brand"
              />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={!wrapWei || wrapWei <= 0n || wrap.isBusy}
              >
                {wrap.isBusy ? "Wrapping…" : "Wrap"}
              </Button>
            </form>
            <TxStatus phase={wrap.phase} hash={wrap.hash} error={wrap.error} />
          </div>
        )}
      </Card>

      <div className="-my-1 flex justify-center text-muted/60" aria-hidden>
        <ArrowDown className="h-5 w-5" />
      </div>

      {/* Card 2 — Loan (borrow vUSD) */}
      <Card>
        <span className="text-sm font-medium text-muted">Loan</span>
        <div className="mt-3 flex items-center gap-3">
          <input
            inputMode="decimal"
            placeholder="0.0"
            value={mint}
            onChange={(e) => setMint(e.target.value)}
            aria-label="vUSD to borrow"
            className="w-full min-w-0 bg-transparent text-4xl font-semibold tabular-nums text-ink outline-none placeholder:text-muted/50"
          />
          <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-line bg-surface-2 py-1.5 pl-1.5 pr-3.5 text-base font-semibold text-ink">
            <TokenIcon symbol="vUSD" size={26} alt="" />
            vUSD
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <span className="text-sm tabular-nums text-muted/70">
            {mint18 !== null ? formatUsd(mint18) : "$0.00"}
          </span>
          {derived.maxMint !== undefined && (
            <button
              type="button"
              onClick={() => setMint(formatToken(derived.maxMint, 18, 2).replace(/,/g, ""))}
              className="min-h-10 rounded-full px-2 text-xs font-medium text-brand hover:underline"
            >
              Max {formatToken(derived.maxMint, 18, 2)}
            </button>
          )}
        </div>
        {mintError && <p className="mt-2 text-xs text-danger">{mintError}</p>}

        <div className="mt-4 space-y-1.5 border-t border-line pt-3">
          <InfoRow
            left={
              <span className="inline-flex items-center gap-1.5">
                <Gauge className="h-3.5 w-3.5" aria-hidden /> Liquidation risk
              </span>
            }
            right={
              <Badge tone={derived.band === "danger" ? "danger" : derived.band === "warning" ? "warning" : "green"}>
                {derived.crBps === null ? "—" : RISK_LABEL[derived.band]}
              </Badge>
            }
          />
          <InfoRow left="Liquidation price" right={formatPrice(derived.liqPrice ?? undefined)} />
          <InfoRow
            left="Collateral ratio"
            right={derived.crBps === null ? "—" : formatBps(derived.crBps)}
          />
        </div>
      </Card>

      {/* Card 3 — Interest rate */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-muted">Interest rate</span>
          <Badge tone="neutral">You can change this anytime</Badge>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <input
            id="borrow-interest-rate"
            type="number"
            inputMode="decimal"
            min={interest.minBps / 100}
            max={interest.maxBps / 100}
            step={0.1}
            value={rateText}
            onChange={(e) => onRateTyped(e.target.value)}
            onBlur={() => setRateFromBps(rateBps)}
            aria-label="Annual interest rate in percent"
            className="w-32 bg-transparent text-4xl font-semibold tabular-nums text-ink outline-none [appearance:textfield] placeholder:text-muted/50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="text-base text-muted">% per year</span>
        </div>
        <input
          type="range"
          min={interest.minBps}
          max={interest.maxBps}
          step={10}
          value={clampedRate}
          onChange={(e) => setRateFromBps(Number(e.target.value))}
          aria-label="Annual interest rate"
          aria-valuetext={`${formatBps(clampedRate)} per year`}
          className="mt-4 w-full accent-[var(--color-brand)]"
        />
        <div className="mt-1 flex justify-between text-xs text-muted/70">
          <span>{formatBps(interest.minBps)}</span>
          <span>{formatBps(interest.maxBps)}</span>
        </div>

        <div className="mt-4 space-y-1.5 border-t border-line pt-3">
          <InfoRow
            left="Interest cost"
            right={`≈ ${formatToken(derived.annualCost, 18, 2)} vUSD / year`}
          />
          <InfoRow
            left="Redemption risk"
            right={
              <Badge tone={redemptionRisk}>
                {redemptionRisk === "danger" ? "High" : redemptionRisk === "warning" ? "Medium" : "Low"}
              </Badge>
            }
          />
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted/80">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Redemptions hit the lowest-rate vaults first. A higher rate costs more but is
          redeemed later.
        </p>
      </Card>

      {/* CTA */}
      <div className="mt-1 flex flex-col gap-2">
        {!owner ? (
          <PillButton size="lg" onClick={() => open()}>
            Connect wallet to borrow
          </PillButton>
        ) : needsApproval && collateralToken ? (
          <PillButton
            size="lg"
            variant="dark"
            disabled={!collateralAmt || approval.isApproving}
            onClick={() => collateralAmt && approval.approve(collateralAmt)}
          >
            {approval.isApproving ? "Approving…" : `Approve ${branch.collateralSymbol}`}
          </PillButton>
        ) : (
          <PillButton
            size="lg"
            disabled={!valid || action.isBusy}
            onClick={() =>
              collateralAmt !== null &&
              mint18 !== null &&
              action.execute("openVault", [collateralAmt, mint18, BigInt(clampedRate), ...HINTS])
            }
          >
            {action.isBusy
              ? "Opening vault…"
              : collateralAmt === null || collateralAmt === 0n
                ? "Enter a collateral amount"
                : insufficientCollateral
                  ? `Not enough ${branch.collateralSymbol}`
                  : mint18 === null || mint18 === 0n
                    ? "Enter a loan amount"
                    : mintError
                      ? "Adjust the loan amount"
                      : "Open vault"}
          </PillButton>
        )}
        {/* Why a loan is required: a vault is a debt position, so opening one
            always borrows some vUSD. Collateral itself earns nothing — yield
            lives in Earn. After opening, borrow more / add / repay run anytime. */}
        {owner && !needsApproval && !action.isBusy && (
          <p className="flex items-start gap-1.5 text-xs text-muted/80">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              A vault borrows vUSD against your collateral
              {!params.isDefault && ` (min ${formatToken(params.minDebt18, 18, 2)} vUSD)`}.
              You can borrow more, add collateral, or repay anytime after opening.
              Want yield instead?{" "}
              <Link href="/earn" className="font-medium text-brand hover:underline">
                Earn with vUSD
              </Link>
              .
            </span>
          </p>
        )}
        {approval.error && !action.error && (
          <p className="text-sm text-danger">{approval.error.message.split("\n")[0]}</p>
        )}
        <TxStatus phase={action.phase} hash={action.hash} error={action.error} />
      </div>
    </div>
  );
}
