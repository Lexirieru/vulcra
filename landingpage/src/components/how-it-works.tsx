import { Section } from "./ui/section";
import { SectionHeading } from "./ui/section-heading";
import { AnimatedSection } from "./ui/animated-section";
import { Badge } from "./ui/badge";
import { HOW_IT_WORKS } from "@/lib/content";
import { staggerDelay } from "@/lib/motion";

export function HowItWorks() {
  return (
    <Section id="how-it-works" divider>
      <SectionHeading eyebrow={HOW_IT_WORKS.eyebrow} title={HOW_IT_WORKS.title} />

      <ul className="mt-12 grid gap-6 md:grid-cols-3">
        {HOW_IT_WORKS.items.map((item, i) => (
          <AnimatedSection
            as="li"
            key={item.index}
            delay={staggerDelay(i)}
            className="flex flex-col gap-4 rounded-2xl border border-border bg-card/50 p-7 transition-colors hover:border-primary/30"
          >
            <span className="font-mono text-sm font-semibold text-primary">
              {item.index}
            </span>
            <h3 className="text-xl font-semibold tracking-tight text-balance">
              {item.title}
            </h3>
            <p className="flex-1 text-pretty leading-7 text-muted-foreground">
              {item.body}
            </p>
            <div>
              <Badge variant="muted" mono>
                {item.chip}
              </Badge>
            </div>
          </AnimatedSection>
        ))}
      </ul>
    </Section>
  );
}
