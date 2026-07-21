// "Redemptions in a nutshell" — the Enosys-style explainer that sits beside the
// borrow composer. Static education copy (no data), warmed with a landing sticker.
import { ArrowDownWideNarrow, ShieldCheck, TrendingUp } from "lucide-react";
import { Card, Sticker } from "@/components/ui";

const POINTS = [
  {
    icon: ArrowDownWideNarrow,
    title: "Lowest rate is redeemed first",
    body: "When someone redeems vUSD for collateral, vaults paying the lowest interest rate are hit first — redemption order is by rate, not by size.",
  },
  {
    icon: TrendingUp,
    title: "Raise your rate to reduce risk",
    body: "A higher interest rate costs more per year but pushes your vault further back in the redemption queue. You can adjust it anytime.",
  },
  {
    icon: ShieldCheck,
    title: "Redemptions keep vUSD at $1",
    body: "Anyone can always swap 1 vUSD for $1 of collateral. Being redeemed is not a liquidation — your debt shrinks and you keep the remaining collateral value.",
  },
] as const;

export function RedemptionsExplainer({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">Redemptions in a nutshell</h2>
        <Sticker name="sticker-heart" size={40} rotate={-8} className="shrink-0" />
      </div>
      <ul className="mt-4 space-y-4">
        {POINTS.map((p) => (
          <li key={p.title} className="flex items-start gap-3">
            <span
              className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-brand"
              aria-hidden
            >
              <p.icon className="size-4" />
            </span>
            <div>
              <div className="text-sm font-medium text-ink">{p.title}</div>
              <p className="mt-0.5 text-sm text-muted">{p.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
