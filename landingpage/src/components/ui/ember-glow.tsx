/**
 * Decorative forge glow. Purely visual — always aria-hidden and
 * pointer-events-none so it never interferes with layout or a11y.
 */
type EmberGlowProps = {
  className?: string;
};

export function EmberGlow({ className = "" }: EmberGlowProps) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 -z-10 bg-gradient-ambient ${className}`}
    />
  );
}
