"use client";

// Semicircular collateral-ratio gauge. Maps CR to a needle angle over a clamped
// range and colors by health band relative to MCR (U5).
import { formatCr } from "@/lib/format";
import { healthBand, type HealthBand } from "@/lib/vault-math";

const BAND_COLOR: Record<HealthBand, string> = {
  healthy: "var(--color-healthy)",
  warning: "var(--color-warning)",
  danger: "var(--color-danger)",
};

// Gauge sweeps CR from GAUGE_MIN% to GAUGE_MAX% across 180°.
const GAUGE_MIN = 100;
const GAUGE_MAX = 300;

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

export function CrGauge({
  crBps,
  mcrBps,
}: {
  crBps: bigint | null;
  mcrBps: bigint;
}) {
  const band = healthBand(crBps, mcrBps);
  const color = BAND_COLOR[band];

  const crPct = crBps === null ? GAUGE_MAX : Number(crBps) / 100;
  const clamped = Math.min(Math.max(crPct, GAUGE_MIN), GAUGE_MAX);
  const t = (clamped - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN); // 0..1
  const angle = 180 + t * 180; // 180° (left) → 360° (right)

  const cx = 100;
  const cy = 100;
  const r = 80;
  const needle = polar(cx, cy, r - 6, angle);
  const mcrT = (Math.min(Math.max(Number(mcrBps) / 100, GAUGE_MIN), GAUGE_MAX) - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN);
  const mcrAngle = 180 + mcrT * 180;
  const mcrOuter = polar(cx, cy, r + 4, mcrAngle);
  const mcrInner = polar(cx, cy, r - 14, mcrAngle);

  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox="0 0 200 116"
        className="w-full max-w-[280px]"
        role="img"
        aria-label={`Collateral ratio ${formatCr(crBps)}, health ${band}`}
      >
        {/* track */}
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="var(--color-surface-2)"
          strokeWidth="12"
          strokeLinecap="round"
        />
        {/* value arc */}
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${needle.x} ${needle.y}`}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
        />
        {/* MCR marker */}
        <line
          x1={mcrInner.x}
          y1={mcrInner.y}
          x2={mcrOuter.x}
          y2={mcrOuter.y}
          stroke="var(--color-text)"
          strokeWidth="2"
        />
      </svg>
      <div className="-mt-6 text-center">
        <div className="font-mono text-3xl tabular-nums" style={{ color }}>
          {formatCr(crBps)}
        </div>
        <div className="text-xs text-faint">
          MCR {formatCr(mcrBps)} · {band}
        </div>
      </div>
    </div>
  );
}
