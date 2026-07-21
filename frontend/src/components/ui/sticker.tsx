/* eslint-disable @next/next/no-img-element -- static local SVGs gain nothing from next/image */
import * as React from "react";
import { cn } from "./cn";

export type StickerName =
  | "sticker-camera"
  | "sticker-hand"
  | "sticker-heart"
  | "sticker-phone"
  | "sticker-smiley"
  | "footer-sticker-100"
  | "footer-sticker-boom"
  | "footer-sticker-camera"
  | "footer-sticker-hands"
  | "footer-sticker-heart"
  | "footer-sticker-smiley"
  | "star-blob";

function stickerSrc(name: string): string {
  if (name === "star-blob") return "/brand/star-blob.svg";
  if (name.startsWith("footer-")) return `/brand/footer-stickers/${name}.svg`;
  return `/brand/stickers/${name}.svg`;
}

/**
 * Landing-page sticker, decorative by default (alt="" + aria-hidden).
 * Pass a non-empty `alt` only when the sticker carries meaning.
 */
export function Sticker({
  name,
  size = 64,
  rotate = 0,
  className,
  alt = "",
}: {
  name: StickerName | (string & {});
  size?: number;
  /** Degrees, e.g. -8 for the landing page's playful tilt. */
  rotate?: number;
  className?: string;
  alt?: string;
}) {
  return (
    <img
      src={stickerSrc(name)}
      alt={alt}
      aria-hidden={alt === "" || undefined}
      width={size}
      height={size}
      className={cn("inline-block object-contain select-none", className)}
      style={{
        width: size,
        height: size,
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
      }}
      draggable={false}
    />
  );
}
