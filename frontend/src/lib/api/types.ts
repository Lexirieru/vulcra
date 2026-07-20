// Backend API boundary types (KTD5 / A-2). The backend owns the 0xFE memo,
// pre-flight limits, mint tracking, and Guardian submission — the client never
// builds a memo. Endpoint names/shapes reconciled with the backend plan
// (smartcontract/backend are the authorities); assumed shapes are marked TODO
// so finalization is a local edit here.
import type { Address, Hex } from "viem";

// ── Account (GET /account/:xrplAddress) ──────────────────────────────────────
export interface AccountResponse {
  /** Derived Flare PersonalAccount (EVM address) for this r-address. */
  personalAccount: Address;
  nonce: string;
  /** FXRP balance already held by the personal account, 6-dec base units. */
  fxrpBalance: string;
}

// ── Pre-flight (POST /mint/preflight) — AE2 gate at the API layer ─────────────
export interface MintLimits {
  /** Remaining headroom (FXRP 6-dec base units) for each window. */
  hourlyRemaining: string;
  dailyRemaining: string;
  largeMintThreshold: string;
  /** Minimum fee / minimum mintable (FXRP 6-dec base units). */
  minFee: string;
}

export interface PreflightRequest {
  xrplAddress: string;
  /** Desired mint amount, FXRP 6-dec base units, as a decimal string. */
  amount: string;
}

export interface PreflightResponse {
  ok: boolean;
  /** Present when ok=false — a human-readable, user-actionable reason. */
  blockingReason?: string;
  limits: MintLimits;
}

// ── Build intent (POST /mint/build) — ASSUMPTION (A-4) ───────────────────────
// TODO(backend): confirm the endpoint that surfaces the backend-built userOp +
// 0xFE memo + Xaman payload. The backend plan builds these in its userop/memo
// unit; this is the shape the client renders (QR + deep link) and later submits.
export interface MintBuildRequest {
  xrplAddress: string;
  amount: string;
  /** Where the minted vUSD should be delivered (defaults to the personal account). */
  vusdRecipient?: Address;
}

export interface XrplPaymentIntent {
  /** XRPL destination (FAssets agent / core vault) — never carries a dest tag. */
  destination: string;
  /** Drops to send. */
  amountDrops: string;
  /** Hex memo carrying the 0xFE custom instruction, built by the backend. */
  memoHex: Hex;
}

export interface MintBuildResponse {
  /** ABI-encoded PackedUserOperation, echoed back on submit. */
  packedUserOpHex: Hex;
  payment: XrplPaymentIntent;
  /** Deep link that opens the signable request in Xaman. */
  xamanDeepLink: string;
  /** Payload to render as a QR (a URI or Xaman request string). */
  qrData: string;
}

// ── Submit + status (POST /mint/submit, GET /mint/status/:mintId) ────────────
export interface MintSubmitRequest {
  packedUserOpHex: Hex;
  xrplTxId: string;
}

export interface MintSubmitResponse {
  mintId: string;
}

// Backend state-machine states (see backend plan mint lifecycle).
export type MintState =
  | "INTAKE"
  | "ATTEST_PENDING"
  | "ATTEST_READY"
  | "EXECUTING"
  | "DELAYED"
  | "EXECUTED"
  | "REVERTED"
  | "REJECTED";

export interface MintStatusResponse {
  mintId: string;
  state: MintState;
  /** Human-readable stage label for the tracker UI. */
  stage: string;
  /** Set when DELAYED — unix seconds after which the same proof retries (AE1). */
  executionAllowedAt?: number;
  lastError?: string;
}

// ── Guardian (POST /guardian/rules, GET /guardian/rules) — ASSUMPTION (A-7) ──
// TODO(backend): confirm the confidential submission endpoint. Rule parameters
// are POSTed once over TLS to the TEE/backend and are never read back from a
// public on-chain source.
export interface GuardianRuleInput {
  owner: Address;
  /** Auto-repay trigger, collateral ratio in basis points (must exceed MCR). */
  triggerCrBps: number;
  /** Max vUSD to pull on execution, 18-dec base units as a string. */
  maxRepay18: string;
  funder?: Address;
}

export interface GuardianRule extends GuardianRuleInput {
  id: string;
  enabled: boolean;
  createdAt: number;
}
