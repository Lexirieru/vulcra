import { Section } from "./ui/section";
import { SectionHeading } from "./ui/section-heading";
import { AnimatedSection } from "./ui/animated-section";
import { RESOURCES, isLive, type LinkItem } from "@/lib/content";
import { staggerDelay } from "@/lib/motion";

function Arrow() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
    >
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </svg>
  );
}

const cardBase =
  "flex items-center justify-between gap-3 rounded-xl border border-border bg-card/50 p-5 text-left";

function ResourceCard({ item }: { item: LinkItem }) {
  if (!isLive(item)) {
    return (
      <div
        className={`${cardBase} cursor-not-allowed text-muted-foreground`}
        aria-disabled="true"
        title="Coming soon"
      >
        <span className="font-medium">{item.label}</span>
        <span className="rounded-full bg-warn/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-warn">
          soon
        </span>
      </div>
    );
  }

  const externalProps = item.external
    ? { target: "_blank", rel: "noreferrer noopener" }
    : {};

  return (
    <a
      href={item.href}
      {...externalProps}
      className={`group ${cardBase} transition-colors hover:border-primary/40 hover:bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`}
    >
      <span className="font-medium">{item.label}</span>
      <span className="text-muted-foreground group-hover:text-primary">
        <Arrow />
      </span>
    </a>
  );
}

export function Resources() {
  return (
    <Section divider>
      <SectionHeading eyebrow={RESOURCES.eyebrow} title={RESOURCES.title} />
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {RESOURCES.items.map((item, i) => (
          <AnimatedSection key={item.label} delay={staggerDelay(i)}>
            <ResourceCard item={item} />
          </AnimatedSection>
        ))}
      </div>
    </Section>
  );
}
