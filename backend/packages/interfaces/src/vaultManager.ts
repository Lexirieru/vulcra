// Vulcra VaultManager ABI — backend's view of the deployed V2 contract.
//
// V2 (Liquity-V2 user-set interest rates + by-rate redemption). Aligned to
// smartcontract/src/VaultManager.sol on Coston2:
//   - Vault identity = OWNER ADDRESS (one vault per address per branch).
//   - open/openFor/openVaultAndForward take an `annualInterestRateBps`.
//   - getVault(owner).debt18 is the ENTIRE current debt INCLUDING accrued interest.
//   - Redemption is BY INTEREST RATE (lowest rate first) via the sorted list;
//     the redemption-queue head is `redemptionQueueHead()` / `lowestRateVault()`.
//   - `params()` is a struct getter (mcrBps, minDebt18, mintFeeBps, liqBonusBps,
//     redemptionFeeBps); interest bounds are `minInterestRateBps()` /
//     `maxInterestRateBps()` / `defaultInterestRateBps()`.

export const vaultManagerAbi = [
  // ---- vault lifecycle (V2: rate param) ----
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
    name: "openVaultFor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "collateral6", type: "uint256" },
      { name: "mint18", type: "uint256" },
      { name: "annualInterestRateBps", type: "uint256" },
      { name: "debtRecipient", type: "address" },
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
  {
    type: "function",
    name: "closeVault",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  // ---- peg mechanisms ----
  {
    type: "function",
    name: "liquidate",
    stateMutability: "nonpayable",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [],
  },
  {
    // V2 by-rate redemption: draws from the lowest-rate vault first, bounded by maxIterations.
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vusdAmount18", type: "uint256" },
      { name: "maxIterations", type: "uint256" },
    ],
    outputs: [{ name: "collateralPaid6", type: "uint256" }],
  },
  // ---- Vault Guardian (TEE) ----
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
  // ---- interest settlement ----
  {
    type: "function",
    name: "mintInterest",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  // ---- views (pre-flight, indexer, keeper) ----
  {
    type: "function",
    name: "getVault",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [
      { name: "collateral6", type: "uint256" },
      { name: "debt18", type: "uint256" }, // ENTIRE current debt incl. accrued interest
      { name: "active", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "getTroveEntireDebt",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "annualInterestRateBpsOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getEntireSystemDebt",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "pendingAggInterest",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "collateralRatioBps",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "isLiquidatable",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "redemptionQueueHead",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "lowestRateVault",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "nextVault",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "riskiestVault",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "vaultCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
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
  {
    type: "function",
    name: "defaultInterestRateBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "minInterestRateBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "maxInterestRateBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "collateralDecimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
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
    name: "vusd",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  // ---- events (indexer + keeper consume these; V2 shapes) ----
  {
    type: "event",
    name: "VaultOpened",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "collateral6", type: "uint256", indexed: false },
      { name: "debt18", type: "uint256", indexed: false },
      { name: "annualInterestRateBps", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "CollateralAdded",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "amount6", type: "uint256", indexed: false },
      { name: "newCollateral6", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "CollateralWithdrawn",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "amount6", type: "uint256", indexed: false },
      { name: "newCollateral6", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DebtMinted",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "minted18", type: "uint256", indexed: false },
      { name: "fee18", type: "uint256", indexed: false },
      { name: "newDebt18", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DebtRepaid",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "amount18", type: "uint256", indexed: false },
      { name: "newDebt18", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "VaultClosed",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "collateralReturned6", type: "uint256", indexed: false },
      { name: "debtBurned18", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "InterestRateAdjusted",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "newAnnualInterestRateBps", type: "uint256", indexed: false },
      { name: "newDebt18", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "VaultLiquidated",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "liquidator", type: "address", indexed: true },
      { name: "debtCleared18", type: "uint256", indexed: false },
      { name: "collateralToLiquidator6", type: "uint256", indexed: false },
      { name: "collateralToOwner6", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Redemption",
    inputs: [
      { name: "redeemer", type: "address", indexed: true },
      { name: "vusdRedeemed18", type: "uint256", indexed: false },
      { name: "collateralPaid6", type: "uint256", indexed: false },
      { name: "fee6", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DelegatedRepay",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "funder", type: "address", indexed: true },
      { name: "amount18", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AggInterestMinted",
    inputs: [{ name: "amount18", type: "uint256", indexed: false }],
  },
] as const;

/** Seconds per year used by the V2 linear interest accrual (matches SECONDS_PER_YEAR = 365 days). */
export const SECONDS_PER_YEAR = 31_536_000n;
