import type { ReactNode } from "react";
import { Badge } from "./badge";

type SectionHeadingProps = {
  eyebrow: string;
  title: ReactNode;
  lede?: string;
  align?: "left" | "center";
  className?: string;
};

export function SectionHeading({
  eyebrow,
  title,
  lede,
  align = "left",
  className = "",
}: SectionHeadingProps) {
  const alignment =
    align === "center" ? "items-center text-center" : "items-start text-left";
  return (
    <div className={`flex flex-col gap-4 ${alignment} ${className}`}>
      <Badge variant="ember">{eyebrow}</Badge>
      <h2 className="max-w-2xl text-balance text-3xl font-bold tracking-tight sm:text-4xl">
        {title}
      </h2>
      {lede ? (
        <p className="max-w-2xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
          {lede}
        </p>
      ) : null}
    </div>
  );
}
