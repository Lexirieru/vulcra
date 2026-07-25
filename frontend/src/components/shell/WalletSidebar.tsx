"use client";

// Right-side wallet drawer — the single place where BOTH of Vulcra's wallets
// live side by side:
//
//   • Flare (EVM · Coston2) — Reown AppKit / wagmi (Rabby, MetaMask,
//     WalletConnect). Native C2FLR + vUSD + FXRP + WC2FLR balances, all read
//     live from Coston2 (see useWalletBalances).
//   • XRP Ledger (testnet) — Crossmark / GemWallet through the app-wide
//     XrplWalletProvider. XRP balance straight from an XRPL testnet node, FXRP
//     from the derived PersonalAccount the backend resolves.
//
// The two connect INDEPENDENTLY and can be connected at the same time: one to
// borrow vUSD against collateral you already hold on Flare, the other to bring
// XRP over from the XRPL and mint against it. Every figure is a real read —
// anything that hasn't resolved renders a skeleton and then "—", never a 0.
//
// Dialog behaviour (APG dialog-modal): rendered through a portal on <body>
// because the sticky header's `backdrop-blur` would otherwise become the
// containing block for a `fixed` child; scrim click, Escape, and route change
// (owned by AppShell, which holds the open state) all close it; Tab is trapped
// inside the panel and focus is restored to the trigger on close. While
// AppKit's own modal is up it owns the keyboard, so the trap stands down.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  useAppKit,
  useAppKitState,
  useDisconnect,
  useWalletInfo,
} from "@reown/appkit/react";
import { useAccount, useSwitchChain } from "wagmi";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  LogOut,
  Settings2,
  Wallet,
  X,
} from "lucide-react";
import { Badge, Button, PillButton, Skeleton, TokenIcon, cn } from "@/components/ui";
import {
  DUR,
  EASE,
  gsap,
  prefersReducedMotion,
  useIsomorphicLayoutEffect,
} from "@/lib/gsap";
import { BRANCHES } from "@/config/branches";
import { COSTON2_CHAIN_ID } from "@/config/contracts";
import { useXrplWalletContext } from "@/context/xrpl";
import { usePersonalAccount } from "@/hooks/usePersonalAccount";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { useXrpBalance, XRP_DECIMALS } from "@/hooks/useXrpBalance";
import { XRPL_PROVIDER_ORDER, XRPL_PROVIDERS } from "@/lib/xrpl/wallets";
import { formatToken, shortenAddress } from "@/lib/format";

export const WALLET_SIDEBAR_ID = "wallet-sidebar";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// The portal target (`document.body`) doesn't exist while the shell renders on
// the server. useSyncExternalStore — the same trick BranchProvider uses — keeps
// the hydration render identical to the server's without a mount effect.
const subscribeNever = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

// ─────────────────────────────────────────────────────────────────────────────
// Trigger — lives in the app header, replaces the lone ConnectButton
// ─────────────────────────────────────────────────────────────────────────────

/**
 * "Wallets" header button. Summarises what is connected (green dot + a chain
 * chip per wallet + the address, or the count when both are connected) and
 * opens the drawer.
 */
export function WalletsButton({
  open,
  onOpen,
}: {
  open: boolean;
  onOpen: () => void;
}) {
  const { address, isConnected, status } = useAccount();
  const xrpl = useXrplWalletContext();

  const evmOn = isConnected && Boolean(address);
  const xrplOn = Boolean(xrpl.address);
  const count = (evmOn ? 1 : 0) + (xrplOn ? 1 : 0);
  const connecting = status === "connecting" || status === "reconnecting";

  const summary =
    count === 2
      ? "2 wallets"
      : shortenAddress(evmOn ? address : xrpl.address, 4);

  const label =
    count === 0
      ? "Connect a wallet"
      : `Wallets — ${[evmOn && "Flare", xrplOn && "XRP Ledger"]
          .filter(Boolean)
          .join(" and ")} connected`;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={WALLET_SIDEBAR_ID}
      aria-label={label}
      className={cn(
        "flex min-h-10 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-medium transition-colors",
        count > 0
          ? "border border-line bg-surface text-ink hover:bg-surface-2"
          : "bg-brand text-white hover:bg-[color-mix(in_srgb,var(--color-brand)_88%,black)]",
      )}
    >
      {count === 0 ? (
        <>
          <Wallet className="h-4 w-4" aria-hidden />
          <span>{connecting ? "Connecting…" : "Connect wallet"}</span>
        </>
      ) : (
        <>
          <span className="h-2 w-2 shrink-0 rounded-full bg-green" aria-hidden />
          <span className="flex -space-x-1.5" aria-hidden>
            {evmOn ? (
              <TokenIcon symbol="FLR" size={20} alt="" className="ring-2 ring-surface" />
            ) : null}
            {xrplOn ? (
              <TokenIcon symbol="XRP" size={20} alt="" className="ring-2 ring-surface" />
            ) : null}
          </span>
          <span className="hidden font-mono text-xs sm:inline" aria-hidden>
            {summary}
          </span>
        </>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Drawer
// ─────────────────────────────────────────────────────────────────────────────

export function WalletSidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const isClient = useSyncExternalStore(
    subscribeNever,
    clientSnapshot,
    serverSnapshot,
  );

  // The panel must outlive `open` long enough to play its exit tween. Deriving
  // `closing` from an open→closed transition during render (legal: this
  // component owns the state) avoids a setState-in-effect; the GSAP timeline's
  // onComplete then unmounts it.
  const [closing, setClosing] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) setClosing(true);
  }
  const rendered = open || closing;

  // AppKit's modal renders above this drawer and owns the keyboard while open,
  // so the trap below must stand down rather than yank focus back.
  const { open: appkitOpen } = useAppKitState();

  // Latest-ref so the keyboard effect never re-subscribes just because the
  // parent re-rendered a new onClose identity.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Scroll lock + initial focus + focus restore. On close, focus goes back to
  // whatever opened the drawer (APG); a pointer click doesn't focus the button
  // in every browser, so the trigger itself is the fallback rather than <body>.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const raf = requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = previousOverflow;
      const trigger = document.querySelector<HTMLElement>(
        `[aria-controls="${WALLET_SIDEBAR_ID}"]`,
      );
      const restore =
        previouslyFocused &&
        previouslyFocused !== document.body &&
        previouslyFocused.isConnected
          ? previouslyFocused
          : trigger;
      restore?.focus?.();
    };
  }, [open]);

  // Escape to close + Tab trapped inside the panel.
  useEffect(() => {
    if (!open || appkitOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const nodes = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.getClientRects().length > 0);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      const inside = panel.contains(active);
      if (e.shiftKey ? active === first || !inside : active === last || !inside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, appkitOpen]);

  // ── GSAP slide + scrim fade ────────────────────────────────────────────────
  // Layout effect so the panel is parked off-canvas before the browser paints —
  // otherwise it would flash at x=0 for one frame on open.
  useIsomorphicLayoutEffect(() => {
    const panel = panelRef.current;
    const scrim = scrimRef.current;
    if (!panel || !scrim) return;

    gsap.killTweensOf([panel, scrim]);
    const reduced = prefersReducedMotion();

    if (open) {
      if (reduced) {
        gsap.set(panel, { xPercent: 0 });
        gsap.set(scrim, { opacity: 1 });
        return;
      }
      gsap.set(panel, { xPercent: 100 });
      gsap.set(scrim, { opacity: 0 });
      const tl = gsap
        .timeline()
        .to(scrim, { opacity: 1, duration: DUR.fast, ease: EASE.out }, 0)
        .to(panel, { xPercent: 0, duration: DUR.panel, ease: EASE.out }, 0);
      return () => {
        tl.kill();
      };
    }

    // Closing: play out, then unmount from the tween's completion callback.
    const finish = () => setClosing(false);
    if (reduced) {
      finish();
      return;
    }
    const tl = gsap
      .timeline({ onComplete: finish })
      .to(panel, { xPercent: 100, duration: DUR.fast, ease: EASE.in }, 0)
      .to(scrim, { opacity: 0, duration: DUR.fast, ease: EASE.in }, 0);
    return () => {
      tl.kill();
    };
  }, [open]);

  if (!isClient) return null;

  return createPortal(
    rendered ? (
        <div className="fixed inset-0 z-50">
          <div
            ref={scrimRef}
            className="absolute inset-0 bg-navy/35 backdrop-blur-[2px]"
            onClick={onClose}
            aria-hidden
          />
          <div
            ref={panelRef}
            id={WALLET_SIDEBAR_ID}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${WALLET_SIDEBAR_ID}-title`}
            // While the exit tween plays the panel is still painted but no
            // longer interactive — `inert` keeps it out of the tab order.
            inert={!open || undefined}
            className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-line bg-bg shadow-[0_0_60px_-12px_rgb(16_20_43/0.35)] sm:w-96"
          >
            <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h2
                  id={`${WALLET_SIDEBAR_ID}-title`}
                  className="text-base font-semibold text-ink"
                >
                  Wallets
                </h2>
                <p className="mt-0.5 text-xs text-muted">
                  Connect Flare and the XRP Ledger — both at once.
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label="Close wallets"
                className="-mr-1 grid size-10 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
              <FlareWalletSection onNavigate={onClose} />
              <hr className="my-6 border-line" />
              <XrplWalletSection onNavigate={onClose} />
            </div>
          </div>
        </div>
    ) : null,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Flare (EVM · Coston2)
// ─────────────────────────────────────────────────────────────────────────────

function FlareWalletSection({ onNavigate }: { onNavigate: () => void }) {
  const { open } = useAppKit();
  const { disconnect } = useDisconnect();
  const { walletInfo } = useWalletInfo();
  const { address, isConnected, chainId, status } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();

  const connected = isConnected && Boolean(address);
  const connecting = status === "connecting" || status === "reconnecting";
  const wrongNetwork = connected && chainId !== COSTON2_CHAIN_ID;
  const balances = useWalletBalances(connected ? address : undefined);

  return (
    <section aria-labelledby="wallet-flare-heading">
      <SectionHeader
        id="wallet-flare-heading"
        icon={<TokenIcon symbol="FLR" size={28} alt="" />}
        title="Flare"
        subtitle="Coston2 · chain 114"
        connected={connected}
      />

      {connected && address ? (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            {walletInfo?.name ? (
              <span className="text-xs text-muted">{walletInfo.name}</span>
            ) : null}
            <AddressChip address={address} label="Flare address" />
          </div>

          {wrongNetwork ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3">
              <p className="flex items-center gap-2 text-xs text-warning">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                Balances read Coston2 — your wallet is elsewhere.
              </p>
              <Button
                variant="secondary"
                size="sm"
                disabled={switching}
                onClick={() => switchChain({ chainId: COSTON2_CHAIN_ID })}
              >
                {switching ? "Switching…" : "Switch"}
              </Button>
            </div>
          ) : null}

          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface px-4">
            <BalanceRow
              symbol={balances.native.symbol}
              decimals={balances.native.decimals}
              value={balances.native.value}
              isLoading={balances.native.isLoading}
              note="gas"
            />
            {balances.tokens.map((t) => (
              <BalanceRow
                key={t.symbol}
                symbol={t.symbol}
                decimals={t.decimals}
                value={t.value}
                isLoading={t.isLoading}
              />
            ))}
          </ul>

          <PillButton href="/borrow" size="md" onClick={onNavigate} className="w-full">
            Borrow vUSD
            <ArrowRight className="h-4 w-4" aria-hidden />
          </PillButton>

          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={() => open()}>
              <Settings2 className="h-4 w-4" aria-hidden />
              Manage
            </Button>
            <Button variant="ghost" size="sm" onClick={() => disconnect()}>
              <LogOut className="h-4 w-4" aria-hidden />
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {/* Button, not PillButton: PillButton's `domRest` strips `disabled`
              off the <button> form, so the connecting state wouldn't hold. */}
          <Button size="md" onClick={() => open()} disabled={connecting} className="w-full">
            <Wallet className="h-4 w-4" aria-hidden />
            {connecting ? "Connecting…" : "Connect Flare wallet"}
          </Button>
          <p className="text-xs text-muted/80">
            Rabby · MetaMask · WalletConnect. Needed to borrow vUSD against
            collateral you already hold on Flare.
          </p>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// XRP Ledger (testnet)
// ─────────────────────────────────────────────────────────────────────────────

function XrplWalletSection({ onNavigate }: { onNavigate: () => void }) {
  const wallet = useXrplWalletContext();
  const xrp = useXrpBalance(wallet.address);
  // The PersonalAccount (and the FXRP already sitting on it) is derived by the
  // backend from the r-address — same source the mint flow uses.
  const account = usePersonalAccount(wallet.address ?? "");

  const connected = Boolean(wallet.address);
  const providerName = wallet.providerId
    ? XRPL_PROVIDERS[wallet.providerId].name
    : undefined;

  return (
    <section aria-labelledby="wallet-xrpl-heading">
      <SectionHeader
        id="wallet-xrpl-heading"
        icon={<TokenIcon symbol="XRP" size={28} alt="" />}
        title="XRP Ledger"
        subtitle="testnet"
        connected={connected}
      />

      {connected && wallet.address ? (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            {providerName ? (
              <span className="text-xs text-muted">{providerName}</span>
            ) : null}
            <AddressChip address={wallet.address} label="XRPL r-address" />
          </div>

          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface px-4">
            {/* SPENDABLE, so this matches what Crossmark/GemWallet show —
                the account reserve is locked by the ledger, not by us. */}
            <BalanceRow
              symbol="XRP"
              decimals={XRP_DECIMALS}
              value={xrp.data?.spendableDrops}
              isLoading={xrp.isLoading}
              note={
                // The query keeps polling on its own interval, so a failed read
                // heals itself — no tiny inline "retry" target needed.
                xrp.isError ? (
                  "XRPL node unreachable — retrying"
                ) : xrp.data && !xrp.data.funded ? (
                  "not funded yet"
                ) : xrp.data ? (
                  <>
                    spendable · {formatToken(xrp.data.reserveDrops, XRP_DECIMALS, 2)}{" "}
                    reserved
                  </>
                ) : (
                  "on XRPL testnet"
                )
              }
            />
            <BalanceRow
              symbol={BRANCHES.fxrp.collateralSymbol}
              decimals={BRANCHES.fxrp.collateralDecimals}
              // The executor omits fxrpBalance on some builds — absent must read
              // "—", never a fabricated 0.
              value={
                account.data?.fxrpBalance !== undefined
                  ? BigInt(account.data.fxrpBalance)
                  : undefined
              }
              isLoading={account.isLoading}
              note={
                account.isError
                  ? "personal account unavailable"
                  : "on your Flare personal account"
              }
            />
          </ul>

          {account.data ? (
            <p className="text-xs text-muted/80">
              Personal account{" "}
              <span className="font-mono">
                {shortenAddress(account.data.personalAccount)}
              </span>{" "}
              — derived on Flare from your r-address.
            </p>
          ) : null}

          <PillButton
            href="/borrow/fxrp?mode=xrpl"
            size="md"
            onClick={onNavigate}
            className="w-full"
          >
            Bring XRP → mint vUSD
            <ArrowRight className="h-4 w-4" aria-hidden />
          </PillButton>

          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => wallet.disconnect()}>
              <LogOut className="h-4 w-4" aria-hidden />
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {XRPL_PROVIDER_ORDER.map((id) => {
            // Per-provider: only the wallet you actually clicked reports
            // progress. A shared flag made both buttons read "Connecting…",
            // which looked like Crossmark had hung.
            const busy = wallet.connectingId === id;
            return (
              <Button
                key={id}
                variant="secondary"
                size="md"
                className="w-full"
                disabled={wallet.connectingId !== undefined}
                onClick={() => wallet.connect(id)}
              >
                <Wallet className="h-4 w-4" aria-hidden />
                {busy ? "Confirm in wallet…" : `Connect ${XRPL_PROVIDERS[id].name}`}
              </Button>
            );
          })}
          <p className="text-xs text-muted/80">
            Browser extensions — no API key. Bring XRP straight from the XRPL and
            mint vUSD against it.
          </p>
          {wallet.error ? (
            <p className="text-xs text-danger" role="alert">
              {wallet.error}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared bits
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({
  id,
  icon,
  title,
  subtitle,
  connected,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  connected: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      {icon}
      <div className="min-w-0 flex-1">
        <h3 id={id} className="text-sm font-semibold text-ink">
          {title}
        </h3>
        <p className="text-xs text-muted">{subtitle}</p>
      </div>
      <Badge tone={connected ? "green" : "neutral"}>
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            connected ? "bg-green" : "bg-muted",
          )}
          aria-hidden
        />
        {connected ? "Connected" : "Not connected"}
      </Badge>
    </div>
  );
}

function BalanceRow({
  symbol,
  decimals,
  value,
  isLoading,
  note,
}: {
  symbol: string;
  decimals: number;
  value?: bigint;
  isLoading: boolean;
  note?: React.ReactNode;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <span className="flex min-w-0 items-center gap-2.5">
        <TokenIcon symbol={symbol} size={24} alt="" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-ink">
            {symbol}
          </span>
          {note ? (
            <span className="block truncate text-xs text-muted/80">{note}</span>
          ) : null}
        </span>
      </span>
      {value === undefined && isLoading ? (
        <Skeleton className="h-4 w-20" />
      ) : (
        <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
          {formatToken(value, decimals, 4)}
        </span>
      )}
    </li>
  );
}

function AddressChip({ address, label }: { address: string; label: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard?.writeText(address);
      setCopied(true);
    } catch {
      // Clipboard denied (insecure origin / permissions) — the full address is
      // still readable from the title attribute, so fail quietly.
    }
  }

  return (
    <div className="flex items-center gap-1 rounded-full border border-line bg-surface py-1 pr-1 pl-3.5">
      <span className="min-w-0 flex-1 truncate font-mono text-sm text-ink" title={address}>
        {shortenAddress(address, 6)}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className="grid size-10 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
      >
        {copied ? (
          <Check className="h-4 w-4 text-green" aria-hidden />
        ) : (
          <Copy className="h-4 w-4" aria-hidden />
        )}
      </button>
      <span role="status" className="sr-only">
        {copied ? `${label} copied` : ""}
      </span>
    </div>
  );
}
