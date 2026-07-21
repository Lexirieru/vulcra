import * as React from "react";
import Link from "next/link";
import { cn } from "./cn";

// ── PillButton (Enosys-style rounded-full CTA) ───────────────────────────────
export type PillButtonVariant = "primary" | "ghost" | "dark";
export type PillButtonSize = "sm" | "md" | "lg";

const PILL_BASE =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap transition-colors " +
  "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:pointer-events-none";

const PILL_VARIANT: Record<PillButtonVariant, string> = {
  primary:
    "bg-[var(--color-brand)] text-[var(--color-brand-ink)] hover:bg-[color-mix(in_srgb,var(--color-brand)_88%,black)]",
  ghost:
    "border border-[var(--color-line)] bg-transparent text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]",
  dark: "bg-[var(--color-navy)] text-white hover:bg-[color-mix(in_srgb,var(--color-navy)_82%,white)]",
};

// Every size keeps a ≥40px hit target.
const PILL_SIZE: Record<PillButtonSize, string> = {
  sm: "h-10 px-4 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-6 text-base",
};

type PillCommon = {
  variant?: PillButtonVariant;
  size?: PillButtonSize;
  className?: string;
  children?: React.ReactNode;
};

export type PillButtonProps =
  | (PillCommon & { as?: "button"; href?: undefined } & Omit<
      React.ButtonHTMLAttributes<HTMLButtonElement>,
      "className" | "children"
    >)
  | (PillCommon & { as?: "a"; href: string; disabled?: boolean } & Omit<
      React.AnchorHTMLAttributes<HTMLAnchorElement>,
      "className" | "children" | "href"
    >);

type PillOwnKey = "variant" | "size" | "className" | "as" | "href" | "disabled" | "children";

// Strips PillButton's own props so only real DOM attributes get spread.
function domRest<T extends object>(props: T): Omit<T, PillOwnKey> {
  const rest = { ...props } as Record<string, unknown>;
  delete rest.variant;
  delete rest.size;
  delete rest.className;
  delete rest.as;
  delete rest.href;
  delete rest.disabled;
  delete rest.children;
  return rest as Omit<T, PillOwnKey>;
}

/**
 * Renders a real <button>, or — when `href` is set — a Next <Link> for
 * internal routes and a plain <a> for external URLs.
 */
export function PillButton(props: PillButtonProps) {
  const { variant = "primary", size = "md", className, children } = props;
  const classes = cn(PILL_BASE, PILL_VARIANT[variant], PILL_SIZE[size], className);

  if (props.href !== undefined) {
    const rest = domRest(props);
    if (props.disabled) {
      return (
        <a role="link" aria-disabled tabIndex={-1} className={classes} {...rest}>
          {children}
        </a>
      );
    }
    const internal = props.href.startsWith("/") || props.href.startsWith("#");
    if (internal) {
      return (
        <Link href={props.href} className={classes} {...rest}>
          {children}
        </Link>
      );
    }
    return (
      <a href={props.href} className={classes} {...rest}>
        {children}
      </a>
    );
  }

  const { type, ...rest } = domRest(props);
  return (
    <button type={type ?? "button"} className={classes} {...rest}>
      {children}
    </button>
  );
}

// ── Button (legacy API, restyled to the light theme) ─────────────────────────
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--color-brand)] text-[var(--color-brand-ink)] hover:bg-[color-mix(in_srgb,var(--color-brand)_88%,black)]",
  secondary:
    "border border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-ink)] hover:bg-[var(--color-line)]",
  ghost:
    "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]",
  danger:
    "bg-[var(--color-danger)] text-white hover:bg-[color-mix(in_srgb,var(--color-danger)_88%,black)]",
};
const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-10 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      className={cn(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className)}
      {...props}
    />
  );
}
