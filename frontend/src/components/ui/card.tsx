// Card surfaces (Enosys-style light theme). All colors come from the design
// tokens in globals.css (§2 of FE_ENOSYS_SPEC) via CSS variables, so these
// compile and render independently of theme load order.
import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "./cn";

export const CARD_SHADOW =
  "shadow-[0_1px_2px_rgb(26_26_26/0.04),0_10px_30px_-18px_rgb(26_26_26/0.18)]";

export function Card({
  padded = true,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { padded?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-[20px] border border-[var(--color-line)] bg-[var(--color-surface)]",
        CARD_SHADOW,
        padded && "p-5 sm:p-6",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn("text-base font-semibold text-[var(--color-ink)]", className)}
      {...props}
    />
  );
}

export function SectionCard({
  title,
  subtitle,
  icon,
  action,
  bleed = false,
  className,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  /** Remove content padding so tables can run edge-to-edge. */
  bleed?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card padded={false} className={className}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 sm:px-6 sm:pt-6">
        <div className="flex min-w-0 items-center gap-3">
          {icon}
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[var(--color-ink)]">{title}</h2>
            {subtitle ? (
              <p className="text-sm text-[var(--color-muted)]">{subtitle}</p>
            ) : null}
          </div>
        </div>
        {action}
      </div>
      <div className={cn(bleed ? "px-0 pb-2 pt-4" : "px-5 pb-5 pt-4 sm:px-6 sm:pb-6")}>
        {children}
      </div>
    </Card>
  );
}

const HERO_TONE: Record<"navy" | "blue", string> = {
  navy: "bg-[var(--color-navy)]",
  blue: "bg-[var(--color-blue)]",
};

export function HeroCard({
  tone,
  title,
  desc,
  icon,
  href,
  className,
}: {
  tone: "navy" | "blue";
  title: React.ReactNode;
  desc: React.ReactNode;
  icon?: React.ReactNode;
  href: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex min-h-52 flex-col justify-between gap-8 rounded-[24px] p-6 text-white sm:min-h-56 sm:p-8",
        "transition-[transform,box-shadow] hover:-translate-y-0.5",
        CARD_SHADOW,
        HERO_TONE[tone],
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        {icon ?? <span aria-hidden />}
        <span
          aria-hidden
          className="grid size-11 shrink-0 place-items-center rounded-full bg-white/15 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
        >
          <ArrowUpRight className="size-5" />
        </span>
      </div>
      <div className="space-y-2">
        <span className="block text-2xl font-semibold sm:text-3xl">{title}</span>
        <p className="max-w-sm text-sm text-white/75">{desc}</p>
      </div>
    </Link>
  );
}
