import { AnimatedSection } from "./ui/animated-section";
import { Button } from "./ui/button";
import { CTA, SITE, isLive } from "@/lib/content";

export function CtaFooter() {
  return (
    <>
      <section className="px-4 pb-20 sm:px-6">
        <AnimatedSection className="relative mx-auto w-full max-w-6xl overflow-hidden rounded-3xl border border-primary/25 bg-card px-6 py-16 text-center sm:py-20">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-ambient"
          />
          <div className="relative flex flex-col items-center gap-5">
            <h2 className="max-w-2xl text-balance text-3xl font-bold tracking-tight sm:text-4xl">
              {CTA.headline}
            </h2>
            <p className="max-w-xl text-pretty leading-7 text-muted-foreground">
              {CTA.body}
            </p>
            <Button
              href={CTA.cta.href}
              external={CTA.cta.external}
              comingSoon={CTA.cta.isPlaceholder}
              variant="primary"
              size="lg"
            >
              {CTA.cta.label}
            </Button>
          </div>
        </AnimatedSection>
      </section>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">{SITE.name}</span>
            <span className="text-xs text-muted-foreground">{CTA.builtNote}</span>
          </div>

          <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Footer">
            {CTA.footerLinks.map((link) =>
              isLive(link) ? (
                <a
                  key={link.label}
                  href={link.href}
                  target={link.external ? "_blank" : undefined}
                  rel={link.external ? "noreferrer noopener" : undefined}
                  className="rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {link.label}
                </a>
              ) : (
                <span
                  key={link.label}
                  className="text-sm text-muted-foreground/50"
                  title="Coming soon"
                >
                  {link.label}
                </span>
              )
            )}
          </nav>
        </div>
        <div className="mx-auto w-full max-w-6xl px-4 pb-10 sm:px-6">
          <p className="text-xs text-muted-foreground/70">{CTA.disclaimer}</p>
        </div>
      </footer>
    </>
  );
}
