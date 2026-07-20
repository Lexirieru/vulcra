"use client";

/*
  Hero entrance choreography (stage-driven; plan HTD).
    t=0     stage→1   eyebrow badge            fade+rise
    t=120   stage→2   H1                        fade+rise
    t=240   stage→3   subhead                   fade+rise
    t=360   stage→4   CTA row                   fade+rise
    t=480   stage→5   ember glow                fade
    reduced-motion: everything visible at t=0, opacity only
*/

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { EmberGlow } from "./ui/ember-glow";
import { HERO } from "@/lib/content";
import { fadeRise, staticReveal, SPRING, TIMING } from "@/lib/motion";

const LAST_STAGE = 5;

export function Hero() {
  const reduce = useReducedMotion();
  const [stage, setStage] = useState(0);

  useEffect(() => {
    // Under reduced motion we don't schedule stages; `reduce` reveals
    // everything directly (see `reveal`), avoiding a setState in the effect.
    if (reduce) return;
    const timers = Array.from({ length: LAST_STAGE }, (_, i) => {
      const s = i + 1;
      return setTimeout(() => setStage(s), s * TIMING.heroStageStep * 1000);
    });
    return () => timers.forEach(clearTimeout);
  }, [reduce]);

  const variants = reduce ? staticReveal : fadeRise;
  const reveal = (n: number) => (reduce || stage >= n ? "visible" : "hidden");
  const glowVisible = reduce || stage >= 5;

  return (
    <section id="top" className="relative overflow-hidden">
      <motion.div
        aria-hidden="true"
        initial={false}
        animate={{ opacity: glowVisible ? 1 : 0 }}
        transition={{ duration: TIMING.duration.slow }}
      >
        <EmberGlow />
      </motion.div>

      <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 pb-20 pt-20 text-center sm:px-6 sm:pb-28 sm:pt-28">
        <motion.div variants={variants} initial="hidden" animate={reveal(1)}>
          <Badge variant="ember">{HERO.eyebrow}</Badge>
        </motion.div>

        <motion.h1
          variants={variants}
          initial="hidden"
          animate={reveal(2)}
          transition={SPRING.entrance}
          className="mt-6 max-w-4xl text-balance text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl"
        >
          {HERO.headlineLead}{" "}
          <span className="text-gradient-forge">{HERO.headlineAccent}</span>
        </motion.h1>

        <motion.p
          variants={variants}
          initial="hidden"
          animate={reveal(3)}
          className="mt-6 max-w-2xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg"
        >
          {HERO.subhead}
        </motion.p>

        <motion.div
          variants={variants}
          initial="hidden"
          animate={reveal(4)}
          className="mt-9 flex flex-col items-center gap-3 sm:flex-row"
        >
          <Button
            href={HERO.primaryCta.href}
            external={HERO.primaryCta.external}
            comingSoon={HERO.primaryCta.isPlaceholder}
            variant="primary"
            size="lg"
          >
            {HERO.primaryCta.label}
          </Button>
          <Button
            href={HERO.secondaryCta.href}
            external={HERO.secondaryCta.external}
            comingSoon={HERO.secondaryCta.isPlaceholder}
            variant="secondary"
            size="lg"
          >
            {HERO.secondaryCta.label}
          </Button>
        </motion.div>

        <motion.p
          variants={variants}
          initial="hidden"
          animate={reveal(4)}
          className="mt-6 font-mono text-xs uppercase tracking-widest text-muted-foreground"
        >
          Coston2 testnet · no EVM wallet · no FLR
        </motion.p>
      </div>
    </section>
  );
}
