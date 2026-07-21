import type { Metadata } from "next";
import { EarnView } from "@/components/earn/EarnView";

export const metadata: Metadata = {
  title: "Earn — deposit vUSD · Vulcra",
  description:
    "Deposit vUSD into per-collateral stability pools to earn loan-fee rewards on Flare Coston2.",
};

export default function EarnPage() {
  return <EarnView />;
}
