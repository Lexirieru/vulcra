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
  /**
   * FXRP balance already held by the personal account, 6-dec base units.
   * OPTIONAL: the running executor omits it, so consumers must render "—"
   * rather than defaulting a missing field to 0.
   */
  fxrpBalance?: string;
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
  /** XRP collateral to supply, drops (6-dec base units), as a decimal string. */
  netMintDrops: string;
  /** vUSD debt to borrow, 18-dec base units, as a decimal string. */
  mint18: string;
}

export interface PreflightResponse {
  ok: boolean;
  /** Present when ok=false — a human-readable, user-actionable reason. */
  blockedReason?: string;
  requiredPaymentXrp?: string;
  willDelay?: boolean;
  warnings?: string[];
  limits?: MintLimits;
}

// ── Build intent (POST /mint/build) — ASSUMPTION (A-4) ───────────────────────
// TODO(backend): confirm the endpoint that surfaces the backend-built userOp +
// 0xFE memo + Xaman payload. The backend plan builds these in its userop/memo
// unit; this is the shape the client renders (QR + deep link) and later submits.
export interface MintBuildRequest {
  xrplAddress: string;
  /** XRP collateral to supply, drops (6-dec base units), as a decimal string. */
  collateral6: string;
  /** vUSD debt to borrow, 18-dec base units, as a decimal string. */
  mint18: string;
  annualInterestRateBps?: string;
  /** Where the borrowed vUSD is delivered (defaults to the personal account). */
  vusdDestination?: Address;
}

export interface XrplPaymentIntent {
  /** XRPL destination (FAssets agent / core vault) — never carries a dest tag. */
  destination: string;
  /** Drops to send. */
  amountDrops: string;
  /** Hex memo carrying the 0xFE custom instruction, built by the backend. */
  memoHex: Hex;
}

// The raw MintPlan the backend returns from /mint/build (flat). The client
// adapts it to `MintBuildResponse`; components never see this shape.
export interface MintPlanRaw {
  coreVaultXrplAddress: string;
  requiredPaymentDrops: string;
  requiredPaymentXrp: string;
  memo: Hex;
  xrplMemoData: string;
  userOpHash: Hex;
  userOpBytes: Hex;
}

// ── Manage an existing vault (POST /manage/build) ────────────────────────────
// repay / close / adjust-rate ride the SAME 0xFE path as the mint with net mint
// 0 (fees-only payment). The response is the SAME MintBuildResponse shape, so
// the sign → submit → track flow is identical.
export type ManageAction = "repay" | "close" | "adjustRate" | "mintMore" | "addCollateral";
export interface ManageBuildRequest {
  xrplAddress: string;
  action: ManageAction;
  /** vUSD (18-dec) to repay / borrow-more, decimal string — for `repay`/`mintMore`. */
  amount18?: string;
  /** XRP/FXRP (6-dec drops) to supply, decimal string — for `addCollateral`. */
  collateral6?: string;
  /** new annual interest rate (bps), decimal string — required for `adjustRate`. */
  newRateBps?: string;
}

export interface MintBuildResponse {
  /** ABI-encoded PackedUserOperation, echoed back on submit. */
  packedUserOpHex: Hex;
  /** keccak256(userOp) committed in the memo — required by /mint/submit. */
  memoUserOpHash: Hex;
  payment: XrplPaymentIntent;
  /** Total XRP to send (collateral + fees), human-readable. */
  requiredPaymentXrp: string;
  /** Deep link that opens the signable request in Xaman (when available). */
  xamanDeepLink?: string;
  /** Payload to render as a QR. */
  qrData: string;
}

// ── Submit + status (POST /mint/submit, GET /mint/status/:mintId) ────────────
export interface MintSubmitRequest {
  packedUserOpHex: Hex;
  xrplTxId: string;
  /** keccak256(userOp) the memo committed to — the backend requires it. */
  memoUserOpHash: Hex;
}

export interface MintSubmitResponse {
  mintId: string;
}

// Backend state-machine states — MUST match the executor store (state.ts):
// INTAKE → ATTEST_REQUESTED → PROOF_READY → EXECUTING → EXECUTED, with DELAYED
// (rate-limited retry) and REVERTED/REJECTED as off-ramps.
export type MintState =
  | "INTAKE"
  | "ATTEST_REQUESTED"
  | "PROOF_READY"
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
  /** Collateral branch this rule protects (cross-branch Guardian). */
  branch?: string;
  /** VaultManager instance for the branch. */
  vaultManager?: Address;
}

export interface GuardianRule extends GuardianRuleInput {
  id: string;
  enabled: boolean;
  createdAt: number;
}

// ── At-risk vaults (GET /vaults/at-risk) — from the backend indexer (R19) ─────
// Candidate discovery only; the liquidate call re-checks CR on-chain.
export interface AtRiskVault {
  owner: Address;
  /** Base units as decimal strings (FXRP 6-dec, vUSD 18-dec). */
  collateral6: string;
  debt18: string;
  /** Collateral ratio in basis points at the indexer's last read. */
  crBps: number;
}
