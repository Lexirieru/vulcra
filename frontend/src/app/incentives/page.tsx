// Incentives (Enosys-style, Vulcra light theme). Static server component: no
// incentive program is live yet, so every card is an honest "coming soon"
// placeholder (spec §4/§5) — no simulated APRs or fake numbers.
import type { Metadata } from "next";
import { Badge, Card, PillButton, Sticker, TokenIcon } from "@/components/ui";

export const metadata: Metadata = {
  title: "Incentives · Vulcra",
  description:
    "Planned incentive programs for vUSD depositors, borrowers, and the Flare ecosystem on Coston2.",
};

const PROGRAMS = [
  {
    title: "Stability Pool rewards",
    body: "Loan fees and interest from each collateral branch stream to vUSD depositors in its stability pool.",
    icon: <TokenIcon symbol="vUSD" size={36} alt="" />,
    badge: { tone: "brand", label: "Coming soon" },
    action: (
      <PillButton size="sm" variant="ghost" href="/earn">
        Go to Earn
      </PillButton>
    ),
  },
  {
    title: "Borrower incentives",
    body: "Rate rebates for vUSD borrowers who keep healthy positions on the FXRP and wFLR branches.",
    icon: <TokenIcon symbol="FXRP" size={36} alt="" />,
    badge: { tone: "brand", label: "Coming soon" },
    action: null,
  },
  {
    title: "Ecosystem campaigns",
    body: "Joint reward campaigns with the wider Flare ecosystem are being explored for later releases.",
    icon: <Sticker name="star-blob" size={36} rotate={8} />,
    badge: { tone: "neutral", label: "Planned" },
    action: null,
  },
] as const;

export default function IncentivesPage() {
  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-6">
        <div className="max-w-2xl space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-ink)] sm:text-4xl">
            Incentives
          </h1>
          <p className="text-[var(--color-muted)]">
            Extra rewards on top of the protocol&apos;s own yield — for vUSD
            depositors, borrowers, and the Flare ecosystem. No incentive program
            is live yet; here&apos;s what&apos;s planned.
          </p>
        </div>
        <Sticker
          name="footer-sticker-boom"
          size={76}
          rotate={6}
          className="hidden shrink-0 sm:block"
        />
      </header>

      <section aria-label="Planned incentive programs">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROGRAMS.map((program) => (
            <Card key={program.title} className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                {program.icon}
                <Badge tone={program.badge.tone}>{program.badge.label}</Badge>
              </div>
              <div className="space-y-1.5">
                <h2 className="text-base font-semibold text-[var(--color-ink)]">
                  {program.title}
                </h2>
                <p className="text-sm text-[var(--color-muted)]">{program.body}</p>
              </div>
              {program.action ? <div className="mt-auto">{program.action}</div> : null}
            </Card>
          ))}
        </div>
      </section>

      <p className="text-xs text-[var(--color-muted)]">
        Nothing on this page shows simulated numbers — real values appear only
        when a program is live on-chain.
      </p>
    </div>
  );
}
