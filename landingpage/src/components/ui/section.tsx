import type { ReactNode } from "react";

type SectionProps = {
  id?: string;
  children: ReactNode;
  className?: string;
  /** Draw a faint ember hairline divider along the top. */
  divider?: boolean;
};

export function Section({ id, children, className = "", divider = false }: SectionProps) {
  return (
    <section
      id={id}
      className={`${divider ? "border-ember-hairline" : ""} py-20 sm:py-28 ${className}`}
    >
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">{children}</div>
    </section>
  );
}
