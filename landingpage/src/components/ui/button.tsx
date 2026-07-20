import type { ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "lg";

type ButtonProps = {
  children: ReactNode;
  href?: string;
  variant?: Variant;
  size?: Size;
  external?: boolean;
  /** Render a non-interactive "coming soon" state (centralized placeholders, KTD5). */
  comingSoon?: boolean;
  className?: string;
  "aria-label"?: string;
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius)] font-medium " +
  "min-h-11 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-ring select-none";

const sizes: Record<Size, string> = {
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-6 text-base",
};

const variants: Record<Variant, string> = {
  primary:
    "bg-gradient-forge text-primary-foreground font-semibold shadow-sm " +
    "hover:brightness-110 active:brightness-95",
  secondary:
    "border border-border bg-secondary/40 text-foreground hover:bg-secondary/70",
  ghost: "text-foreground/80 hover:text-foreground hover:bg-accent/60",
};

export function Button({
  children,
  href,
  variant = "primary",
  size = "md",
  external,
  comingSoon,
  className = "",
  ...rest
}: ButtonProps) {
  const classes = `${base} ${sizes[size]} ${variants[variant]} ${className}`;

  if (comingSoon) {
    return (
      <span
        className={`${base} ${sizes[size]} border border-border bg-muted/40 text-muted-foreground cursor-not-allowed`}
        aria-disabled="true"
        title="Coming soon"
        {...rest}
      >
        {children}
        <span className="rounded-full bg-warn/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-warn">
          soon
        </span>
      </span>
    );
  }

  if (href) {
    const externalProps = external
      ? { target: "_blank", rel: "noreferrer noopener" }
      : {};
    return (
      <a href={href} className={classes} {...externalProps} {...rest}>
        {children}
      </a>
    );
  }

  return (
    <button type="button" className={classes} {...rest}>
      {children}
    </button>
  );
}
