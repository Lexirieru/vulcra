import { SiteHeader } from "@/components/site-header";
import { Hero } from "@/components/hero";
import { ProblemSolution } from "@/components/problem-solution";
import { HowItWorks } from "@/components/how-it-works";
import { Architecture } from "@/components/architecture";
import { BountyAngle } from "@/components/bounty-angle";
import { Resources } from "@/components/resources";
import { CtaFooter } from "@/components/cta-footer";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <ProblemSolution />
        <HowItWorks />
        <Architecture />
        <BountyAngle />
        <Resources />
        <CtaFooter />
      </main>
    </>
  );
}
