"use client";

// Earn page composition (Enosys "Earn" layout, Vulcra light theme): heading +
// explainer, pool selector, per-collateral Stability Pool cards, deposit panel,
// and a "How it works" card. Live: useStabilityPool reads TVL/APR/deposits from
// the per-branch StabilityPool contracts on Coston2 and writes deposit/withdraw.
import { useRef, useState } from "react";
import { SectionCard, Sticker, TokenIcon } from "@/components/ui";
import { BRANCHES, BRANCH_ORDER, type BranchKey } from "@/config/branches";
import { useBranch } from "@/context/branch";
import { useXrplWalletContext } from "@/context/xrpl";
import { DepositPanel } from "./DepositPanel";
import { StabilityPoolCard } from "./StabilityPoolCard";
import { XrplEarnDeposit } from "@/components/xrpl/XrplEarnDeposit";

const HOW_IT_WORKS = [
  {
    title: "Deposit vUSD",
    body: "Add vUSD to the stability pool of a collateral branch. Your deposit backs that branch's outstanding loans.",
  },
  {
    title: "Earn loan-fee rewards",
    body: "Borrowing fees and interest paid on the branch flow to pool depositors, pro-rata to their share.",
  },
  {
    title: "Liquidations convert to collateral",
    body: "When a vault is liquidated, pool vUSD covers its debt and depositors receive the seized collateral (FXRP or wFLR) at a bonus.",
  },
  {
    title: "Withdraw any time",
    body: "vUSD not consumed by liquidations, plus earned rewards, can be withdrawn whenever you like.",
  },
] as const;

export function EarnView() {
  const { branchKey } = useBranch();
  const xrplWallet = useXrplWalletContext();
  const xrpConnected = Boolean(xrplWallet.address);
  // Local pool selection; follows the app-wide branch until the user picks one.
  const [pickedKey, setPickedKey] = useState<BranchKey | null>(null);
  const activeKey = pickedKey ?? branchKey;
  const amountInputRef = useRef<HTMLInputElement>(null);
  const depositRef = useRef<HTMLDivElement>(null);

  // Selecting a pool = clicking its card. `goToDeposit` also brings the deposit
  // form into view and focuses it (used by the card's Deposit button) so the
  // whole select→deposit flow is one motion, not a separate top selector.
  function selectPool(key: BranchKey, goToDeposit = false) {
    setPickedKey(key);
    if (goToDeposit) {
      requestAnimationFrame(() => {
        depositRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        amountInputRef.current?.focus({ preventScroll: true });
      });
    }
  }

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-6">
        <div className="max-w-2xl space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-ink)] sm:text-4xl">
            Deposit vUSD to earn rewards
          </h1>
          <p className="text-[var(--color-muted)]">
            vUSD deposited into a stability pool earns rewards from loan fees paid
            on that collateral branch — and during liquidations it may be swapped
            into the branch&apos;s collateral at a discount.
          </p>
          <p className="text-sm text-[var(--color-muted)]">
            Pool TVL, APR and your deposit are read live from the Stability Pool
            contracts on Coston2 — alongside prices and branch debt. Rewards
            stream on-chain from real protocol interest.
          </p>
        </div>
        <Sticker
          name="sticker-heart"
          size={76}
          rotate={-8}
          className="hidden shrink-0 sm:block"
        />
      </header>

      <section aria-labelledby="earn-pools-heading" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2
            id="earn-pools-heading"
            className="text-lg font-semibold text-[var(--color-ink)]"
          >
            Stability pools
          </h2>
          <p className="text-sm text-[var(--color-muted)]">
            Select a pool to deposit into
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {BRANCH_ORDER.map((key) => (
            <StabilityPoolCard
              key={key}
              branch={BRANCHES[key]}
              selected={activeKey === key}
              onPick={() => selectPool(key)}
              onDeposit={() => selectPool(key, true)}
            />
          ))}
        </div>
      </section>

      <div ref={depositRef} className="grid gap-4 scroll-mt-24 lg:grid-cols-2">
        {/* One deposit panel, wallet-aware: an XRP wallet deposits its
            PersonalAccount vUSD via a single XRPL payment; otherwise the EVM panel. */}
        {xrpConnected ? (
          <XrplEarnDeposit />
        ) : (
          <DepositPanel branch={BRANCHES[activeKey]} inputRef={amountInputRef} />
        )}
        <SectionCard
          title="How it works"
          subtitle="Rewards come from real borrowing activity"
          icon={<TokenIcon symbol="vUSD" size={36} alt="" />}
        >
          <ol className="space-y-4">
            {HOW_IT_WORKS.map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span
                  aria-hidden
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--color-surface-2)] text-sm font-semibold text-[var(--color-ink)]"
                >
                  {i + 1}
                </span>
                <div>
                  <p className="font-medium text-[var(--color-ink)]">{step.title}</p>
                  <p className="text-sm text-[var(--color-muted)]">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </SectionCard>
      </div>
    </div>
  );
}
