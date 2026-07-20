import { Section } from "./ui/section";
import { SectionHeading } from "./ui/section-heading";
import { AnimatedSection } from "./ui/animated-section";
import { Badge } from "./ui/badge";
import { ARCHITECTURE } from "@/lib/content";

function Connector() {
  return (
    <div
      aria-hidden="true"
      className="flex items-center justify-center text-primary/60"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="rotate-90 md:rotate-0"
      >
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
      </svg>
    </div>
  );
}

export function Architecture() {
  return (
    <Section id="architecture" divider>
      <SectionHeading
        eyebrow={ARCHITECTURE.eyebrow}
        title={ARCHITECTURE.title}
        lede={ARCHITECTURE.caption}
      />

      <AnimatedSection className="mt-12">
        {/* Visual flow — decorative; the lede above carries the same flow as text. */}
        <div
          className="flex flex-col items-stretch gap-3 md:flex-row md:items-center"
          aria-hidden="true"
        >
          {ARCHITECTURE.flow.map((node, i) => (
            <div key={node.label} className="contents">
              <div className="flex-1 rounded-xl border border-border bg-card/60 p-4 text-center">
                <div className="text-sm font-semibold">{node.label}</div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">
                  {node.detail}
                </div>
              </div>
              {i < ARCHITECTURE.flow.length - 1 ? <Connector /> : null}
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap gap-2">
          {ARCHITECTURE.integrations.map((name) => (
            <Badge key={name} variant="ember" mono>
              {name}
            </Badge>
          ))}
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          All real on Coston2 — no mocks.
        </p>
      </AnimatedSection>
    </Section>
  );
}
