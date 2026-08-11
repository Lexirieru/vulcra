import type { Address, Hex } from "viem";
import type { McpConfig } from "./config.js";

/**
 * Thin typed clients over the two backend HTTP services. The intent tools call the
 * executor's /mint/build & /manage/build (they already return the Core-Vault
 * destination, exact drops, 0xFE memo and packed user-op) so we never reimplement
 * the direct-minting encoding here. The indexer serves the at-risk view.
 *
 * Node 22 provides a global fetch; no HTTP dependency is added.
 */

async function postJson<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`Cannot reach executor at ${url} — is it running? (${(err as Error).message})`);
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      /* keep raw text */
    }
    throw new Error(`Executor ${url} returned ${res.status}: ${msg}`);
  }
  return JSON.parse(text) as T;
}

async function getJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Cannot reach service at ${url} — is it running? (${(err as Error).message})`);
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      /* keep raw text */
    }
    throw new Error(`Service ${url} returned ${res.status}: ${msg}`);
  }
  return JSON.parse(text) as T;
}

/** The shared build-plan shape returned by /mint/build and /manage/build. */
export interface BuildPlan {
  personalAccount: Address;
  nonce: string;
  coreVaultXrplAddress: string;
  requiredPaymentDrops: string;
  requiredPaymentXrp: string;
  executorFeeUBA: string;
  memo: Hex;
  xrplMemoData: string;
  userOpHash: Hex;
  userOpBytes: Hex;
  // mint-only extras (optional)
  annualInterestRateBps?: string;
  collateral6?: string;
  mint18?: string;
  vusdDestination?: Address;
}

export type ManageAction =
  | "repay"
  | "close"
  | "adjustRate"
  | "mintMore"
  | "addCollateral"
  | "withdrawCollateral"
  | "spDeposit";

export function makeServices(cfg: McpConfig) {
  return {
    /** POST /mint/build — open a new vault (0xFE atomic mint). */
    buildMint(input: {
      xrplAddress: string;
      collateral6: bigint;
      mint18: bigint;
      annualInterestRateBps?: bigint;
    }): Promise<BuildPlan> {
      return postJson<BuildPlan>(`${cfg.executorUrl}/mint/build`, {
        xrplAddress: input.xrplAddress,
        collateral6: input.collateral6.toString(),
        mint18: input.mint18.toString(),
        ...(input.annualInterestRateBps !== undefined
          ? { annualInterestRateBps: input.annualInterestRateBps.toString() }
          : {}),
      });
    },

    /** POST /manage/build — manage an existing vault or deposit to Earn (net-0 0xFE). */
    buildManage(input: {
      xrplAddress: string;
      action: ManageAction;
      amount18?: bigint;
      collateral6?: bigint;
      newRateBps?: bigint;
    }): Promise<BuildPlan> {
      return postJson<BuildPlan>(`${cfg.executorUrl}/manage/build`, {
        xrplAddress: input.xrplAddress,
        action: input.action,
        ...(input.amount18 !== undefined ? { amount18: input.amount18.toString() } : {}),
        ...(input.collateral6 !== undefined ? { collateral6: input.collateral6.toString() } : {}),
        ...(input.newRateBps !== undefined ? { newRateBps: input.newRateBps.toString() } : {}),
      });
    },

    /** GET /vaults/at-risk?branch=KEY — vaults below a CR threshold, riskiest first. */
    atRisk(branchKey: string, belowCrBps?: bigint): Promise<AtRiskResponse> {
      const q = new URLSearchParams({ branch: branchKey });
      if (belowCrBps !== undefined) q.set("belowCrBps", belowCrBps.toString());
      return getJson<AtRiskResponse>(`${cfg.indexerUrl}/vaults/at-risk?${q.toString()}`);
    },
  };
}

export interface AtRiskResponse {
  branch: string;
  belowCrBps: string;
  price: { value: string; decimals: number; price18: string; timestamp: string; stale: boolean };
  count: number;
  vaults: Array<{
    owner: Address;
    collateral: string;
    debt18: string;
    currentDebt18: string;
    rateBps: string;
    active: boolean;
    crBps: string;
  }>;
}

export type Services = ReturnType<typeof makeServices>;
