import { Section } from "./ui/section";
import { AnimatedSection } from "./ui/animated-section";
import { Badge } from "./ui/badge";
import { PROBLEM_SOLUTION } from "@/lib/content";
import { staggerDelay } from "@/lib/motion";

const { problem, solution } = PROBLEM_SOLUTION;

export function ProblemSolution() {
  return (
    <Section divider>
      <div className="grid gap-6 md:grid-cols-2">
        <AnimatedSection
          delay={staggerDelay(0)}
          className="flex flex-col gap-4 rounded-2xl border border-border bg-card/50 p-8"
        >
          <Badge variant="muted">{problem.eyebrow}</Badge>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {problem.title}
          </h2>
          <p className="text-pretty leading-7 text-muted-foreground">{problem.body}</p>
        </AnimatedSection>

        <AnimatedSection
          delay={staggerDelay(1)}
          className="relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-primary/25 bg-card p-8"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/15 blur-3xl"
          />
          <Badge variant="ember">{solution.eyebrow}</Badge>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {solution.title}
          </h2>
          <p className="text-pretty leading-7 text-foreground/80">{solution.body}</p>
        </AnimatedSection>
      </div>
    </Section>
  );
}
