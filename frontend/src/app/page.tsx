// Enosys-style dashboard (FE_ENOSYS_SPEC §4 B2): hero cards into Borrow/Earn,
// then the live borrow-markets table and the earn-pools table. Live reads live
// in the client subcomponents under components/dashboard/.
import { HeroCard, TokenIcon, Sticker } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { BorrowMarketsCard } from "@/components/dashboard/BorrowMarketsCard";
import { EarnPoolsCard } from "@/components/dashboard/EarnPoolsCard";

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-8 sm:gap-10">
      <Reveal>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              Open your <em className="font-display italic">first position</em>
            </h1>
            <p className="mt-2 max-w-xl text-sm text-muted">
              Mint vUSD against FXRP or wFLR at a rate you choose, or put vUSD
              to work in the stability pools — live on Flare Coston2.
            </p>
          </div>
          <Sticker
            name="sticker-heart"
            size={52}
            rotate={-8}
            className="hidden shrink-0 sm:block"
          />
        </div>
      </Reveal>

      <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
        <Reveal delay={0.05}>
          <HeroCard
            tone="navy"
            title="Borrow"
            desc="Mint vUSD against your collateral at whatever interest rate you want"
            href="/borrow"
            icon={
              <span className="flex items-center">
                <TokenIcon symbol="FXRP" size={40} alt="" />
                <TokenIcon symbol="WFLR" size={40} alt="" className="-ml-2.5" />
              </span>
            }
          />
        </Reveal>
        <Reveal delay={0.1}>
          <HeroCard
            tone="blue"
            title="Earn"
            desc="Deposit vUSD to earn protocol revenues and liquidation proceeds"
            href="/earn"
            icon={<TokenIcon symbol="vUSD" size={40} alt="" />}
          />
        </Reveal>
      </div>

      <Reveal delay={0.15}>
        <BorrowMarketsCard />
      </Reveal>

      <Reveal delay={0.2}>
        <EarnPoolsCard />
      </Reveal>
    </div>
  );
}
