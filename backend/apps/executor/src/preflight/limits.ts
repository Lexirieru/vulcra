/**
 * Off-chain replay of the direct-minting tumbling-window rate limits (R12).
 *
 * Windows are clock-aligned (hourly = 3600s aligned to UTC, daily = 86400s
 * aligned to 00:00 UTC). A mint over a cap is DELAYED, not rejected. The
 * large-mint threshold delay is independent of the hourly/daily windows and
 * applies even with full window headroom. When multiple rules bind, the
 * binding executionAllowedAt is whichever pushes furthest into the future.
 *
 * Pure integer math — unit-testable without a live chain.
 */

const HOUR = 3600n;
const DAY = 86400n;

export interface LimiterState {
  limit: bigint;
  consumed: bigint;
  /** UTC timestamp of the window the `consumed` figure belongs to. */
  windowStart: bigint;
}

export interface DelayInputs {
  amount: bigint; // proposed net mint (UBA)
  hourly: LimiterState;
  daily: LimiterState;
  largeThreshold: bigint;
  largeDelaySeconds: bigint;
  /** governance unblock timestamp for the hourly/daily limiter (0 = none). */
  unblockUntil: bigint;
  nowSeconds: bigint;
}

export interface DelayResult {
  willDelay: boolean;
  executionAllowedAt: bigint; // == nowSeconds when immediate
  reasons: string[];
}

function windowStartFor(now: bigint, size: bigint): bigint {
  return (now / size) * size;
}

/** Headroom left in the current window, replaying a stale on-chain window to 0. */
function headroom(state: LimiterState, now: bigint, size: bigint): bigint {
  const currentStart = windowStartFor(now, size);
  const consumed = state.windowStart < currentStart ? 0n : state.consumed;
  return state.limit > consumed ? state.limit - consumed : 0n;
}

export function evaluateMintDelay(input: DelayInputs): DelayResult {
  const now = input.nowSeconds;
  const reasons: string[] = [];
  let allowedAt = now;

  const unblocked = input.unblockUntil > now;

  if (!unblocked) {
    const hourlyHeadroom = headroom(input.hourly, now, HOUR);
    const dailyHeadroom = headroom(input.daily, now, DAY);
    if (input.amount > hourlyHeadroom) {
      const at = windowStartFor(now, HOUR) + HOUR; // next hourly window
      if (at > allowedAt) allowedAt = at;
      reasons.push("hourly-limit");
    }
    if (input.amount > dailyHeadroom) {
      const at = windowStartFor(now, DAY) + DAY; // next daily window
      if (at > allowedAt) allowedAt = at;
      reasons.push("daily-limit");
    }
  } else {
    reasons.push("hourly-daily-unblocked");
  }

  // Large-mint delay is independent and NOT bypassed by a governance unblock.
  if (input.amount > input.largeThreshold) {
    const at = now + input.largeDelaySeconds;
    if (at > allowedAt) allowedAt = at;
    reasons.push("large-mint");
  }

  return {
    willDelay: allowedAt > now,
    executionAllowedAt: allowedAt,
    reasons,
  };
}
