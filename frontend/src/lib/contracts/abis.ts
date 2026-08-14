// ABI layer (U2 / KTD2 / KTD6).
//
// MANDATE: we consume `@flarenetwork/flare-wagmi-periphery-package` ONLY for its
// ABI/chain/feed-id CONSTANTS — never its generated wagmi hooks — and drive every
// read/write through wagmi's own useReadContract / useWriteContract.
//
// The periphery `coston2` namespace is the CANONICAL source for the Flare system
// ABIs (`coston2.contractRegistryAbi`, `coston2.ftsoV2InterfaceAbi`, …). We mirror
// the exact fragments we call as local `view`-typed `as const` arrays for two
// reasons: (1) the production FtsoV2Interface marks its getters `payable`, which
// wagmi's `useReadContract` typing rejects even though they eth_call fine, so we
// read them through a `view` fragment (or `simulateContract` value:0n); (2) local
// fragments keep the hot read paths free of the package's generated-hook surface.
// Swapping any fragment for the canonical periphery ABI is a one-line change.
import { erc20Abi } from "viem";

export { erc20Abi };

// FlareContractRegistry.getContractAddressByName — view. Canonical:
// `coston2.contractRegistryAbi`.
export const contractRegistryAbi = [
  {
    type: "function",
    name: "getContractAddressByName",
    stateMutability: "view",
    inputs: [{ name: "_name", type: "string" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

// FtsoV2Interface reads. Production interface marks these `payable`; we type them
// `view` for wallet-free eth_call reads. Canonical: `coston2.ftsoV2InterfaceAbi`.
// For a state-context read prefer `simulateContract({ ..., value: 0n })`.
export const ftsoV2ReadAbi = [
  {
    type: "function",
    name: "getFeedById",
    stateMutability: "view",
    inputs: [{ name: "_feedId", type: "bytes21" }],
    outputs: [
      { name: "value", type: "uint256" },
      { name: "decimals", type: "int8" },
      { name: "timestamp", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "getFeedByIdInWei",
    stateMutability: "view",
    inputs: [{ name: "_feedId", type: "bytes21" }],
    outputs: [
      { name: "value", type: "uint256" },
      { name: "timestamp", type: "uint64" },
    ],
  },
] as const;

// WNat (wrapped native). wFLR is obtained by wrapping C2FLR: WNat.deposit() is
// payable, withdraw(uint256) unwraps. Balance/decimals come from erc20Abi.
// Resolved at runtime via ContractRegistry ("WNat").
export const wnatAbi = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Vulcra core VaultManager — REAL Coston2 ABI, reconciled against the deployed
// contract (smartcontract/src/VaultManager.sol; deployments/coston2.json). The
// SAME ABI is used for every collateral branch (FXRP, wFLR) — only the instance
// address differs. Field names say `*6`/`fxrp` for historical reasons but hold
// the branch's collateral in ITS decimals (FXRP 6, wFLR 18); the frontend
// interprets decimals per branch. `params` is a public struct getter; collateral
// operations are split (addCollateral / withdrawCollateral / mintMore / repay).
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Vulcra Earn StabilityPool — REAL Coston2 ABI, reconciled against the deployed
// contract (smartcontract/src/StabilityPool.sol; deployments/coston2.json →
// stabilityPools). One UUPS proxy per collateral branch, same ABI; only the
// instance address differs (branches.ts `stabilityPool`). All amounts are
// 18-dec vUSD; APRs are basis points derived on-chain from the live reward
// rate (currentAprBps) and the accumulator history (trailingAprBps).
// ─────────────────────────────────────────────────────────────────────────────
export const stabilityPoolAbi = [
  // --- reads ---
  { type: "function", name: "totalDeposits", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "depositOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "earned", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "currentAprBps", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "trailingAprBps", stateMutability: "view", inputs: [{ name: "windowSeconds", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "rewardRate", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "periodFinish", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint64" }] },
  { type: "function", name: "vusd", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "vaultManager", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  // --- writes ---
  { type: "function", name: "provideToSP", stateMutability: "nonpayable", inputs: [{ name: "amount18", type: "uint256" }], outputs: [] },
  { type: "function", name: "withdrawFromSP", stateMutability: "nonpayable", inputs: [{ name: "amount18", type: "uint256" }], outputs: [] },
  { type: "function", name: "claimReward", stateMutability: "nonpayable", inputs: [], outputs: [] },
] as const;

// FlareTeeManager (FCC diamond) — read-only fragments to surface a Compute
// Extension's on-chain registration (the Guardian's TEE machine). `getTeeMachine`
// returns the (teeId, teeProxyId, url) tuple; `getTeeMachineStatus` returns 2 for
// PRODUCTION. Reads hit the manager directly, so they hold even when the enclave
// endpoint is unreachable.
export const flareTeeManagerAbi = [
  { type: "function", name: "getTeeMachineStatus", stateMutability: "view", inputs: [{ name: "tee", type: "address" }], outputs: [{ name: "", type: "uint8" }] },
  {
    type: "function",
    name: "getTeeMachine",
    stateMutability: "view",
    inputs: [{ name: "tee", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "teeId", type: "address" },
          { name: "teeProxyId", type: "address" },
          { name: "url", type: "string" },
        ],
      },
    ],
  },
  { type: "function", name: "getExtensionId", stateMutability: "view", inputs: [{ name: "tee", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "getTeeMachineOwner", stateMutability: "view", inputs: [{ name: "tee", type: "address" }], outputs: [{ name: "", type: "address" }] },
] as const;

export const vaultManagerAbi = [
  // --- reads ---
  {
    type: "function",
    name: "params",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "mcrBps", type: "uint256" },
      { name: "minDebt18", type: "uint256" },
      { name: "mintFeeBps", type: "uint256" },
      { name: "liqBonusBps", type: "uint256" },
      { name: "redemptionFeeBps", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getVault",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [
      { name: "collateral6", type: "uint256" },
      { name: "debt18", type: "uint256" },
      { name: "active", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "previewOpen",
    stateMutability: "view",
    inputs: [
      { name: "collateral6", type: "uint256" },
      { name: "mint18", type: "uint256" },
    ],
    outputs: [
      { name: "debt18", type: "uint256" },
      { name: "crBps", type: "uint256" },
      { name: "meetsMcr", type: "bool" },
      { name: "meetsMinDebt", type: "bool" },
    ],
  },
  { type: "function", name: "collateralRatioBps", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "isLiquidatable", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "riskiestVault", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "vaultCount", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "fxrp", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "vusd", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  // --- V2 interest-rate reads (Liquity-V2 user-set rates) ---
  { type: "function", name: "minInterestRateBps", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "maxInterestRateBps", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "defaultInterestRateBps", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "annualInterestRateBpsOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "getEntireSystemDebt", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "pendingAggInterest", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  // Redemption queue is ordered by interest rate (lowest redeemed first).
  { type: "function", name: "redemptionQueueHead", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "lowestRateVault", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "highestRateVault", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "nextVault", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "address" }] },
  // --- writes (owner-address model, 1 vault/address) ---
  {
    type: "function",
    name: "openVault",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collateral6", type: "uint256" },
      { name: "mint18", type: "uint256" },
      { name: "annualInterestRateBps", type: "uint256" },
      { name: "prevHint", type: "address" },
      { name: "nextHint", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "adjustInterestRate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "newAnnualInterestRateBps", type: "uint256" },
      { name: "prevHint", type: "address" },
      { name: "nextHint", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "addCollateral",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount6", type: "uint256" },
      { name: "prevHint", type: "address" },
      { name: "nextHint", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdrawCollateral",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount6", type: "uint256" },
      { name: "prevHint", type: "address" },
      { name: "nextHint", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "mintMore",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount18", type: "uint256" },
      { name: "prevHint", type: "address" },
      { name: "nextHint", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount18", type: "uint256" },
      { name: "prevHint", type: "address" },
      { name: "nextHint", type: "address" },
    ],
    outputs: [],
  },
  { type: "function", name: "closeVault", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "liquidate", stateMutability: "nonpayable", inputs: [{ name: "owner", type: "address" }], outputs: [] },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vusdAmount18", type: "uint256" },
      { name: "maxIterations", type: "uint256" },
    ],
    outputs: [{ name: "fxrpPaid6", type: "uint256" }],
  },
  {
    type: "function",
    name: "delegatedRepay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "maxAmount18", type: "uint256" },
      { name: "prevHint", type: "address" },
      { name: "nextHint", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setGuardianFunder",
    stateMutability: "nonpayable",
    inputs: [{ name: "funder", type: "address" }],
    outputs: [],
  },
] as const;
