import { Section } from "./ui/section";
import { SectionHeading } from "./ui/section-heading";
import { AnimatedSection } from "./ui/animated-section";
import { Badge } from "./ui/badge";
import { BOUNTY } from "@/lib/content";
import { staggerDelay } from "@/lib/motion";

export function BountyAngle() {
  return (
    <Section id="bounty" divider>
      <SectionHeading
        eyebrow={BOUNTY.eyebrow}
        title={BOUNTY.title}
        lede={BOUNTY.body}
      />

      <div className="mt-12 grid gap-6 md:grid-cols-2">
        {BOUNTY.bounties.map((b, i) => (
          <AnimatedSection
            key={b.tag}
            delay={staggerDelay(i)}
            className="flex flex-col gap-3 rounded-2xl border border-border bg-card/50 p-8"
          >
            <Badge variant="ember" mono>
              {b.tag}
            </Badge>
            <h3 className="text-xl font-semibold tracking-tight">{b.title}</h3>
            <p className="text-pretty leading-7 text-muted-foreground">{b.note}</p>
          </AnimatedSection>
        ))}
      </div>

      <AnimatedSection className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm text-muted-foreground">Judged on:</span>
        {BOUNTY.criteria.map((c) => (
          <Badge key={c} variant="muted">
            {c}
          </Badge>
        ))}
      </AnimatedSection>
    </Section>
  );
}
