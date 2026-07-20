// Vulcra VaultManager ABI — backend's working view.
//
// DRAFT — the smartcontract plan is the interface AUTHORITY
// (smartcontract/docs/plans/2026-07-20-001-feat-vulcra-smartcontract-plan.md).
// Aligned to that plan's decisions:
//   - Vault identity is the OWNER ADDRESS (one vault per address), never a numeric vaultId.
//   - `delegatedRepay` and `setGuardianFunder` live on VaultManager (no separate Guardian contract).
//   - The sorted-vault list uses (prevHint, nextHint) owner-address hints (Liquity SortedTroves pattern).
// Re-pin the exact ABI once the smartcontract worker publishes the compiled artifact.

export const vaultManagerAbi = [
  // ---- vault lifecycle ----
  {
    type: "function",
    name: "openVault",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collateral6", type: "uint256" },
      { name: "mint18", type: "uint256" },
      { name: "prevHint", type: "address" },
      { name: "nextHint", type: "address" },
    ],
    outputs: [],
  },
  {
    // Called by VulcraZap during the 0xFE atomic mint: assigns the vault to `owner`
    // (the PersonalAccount) while pulling collateral from msg.sender (the Zap).
    type: "function",
    name: "openVaultFor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "collateral6", type: "uint256" },
      { name: "mint18", type: "uint256" },
      { name: "debtRecipient", type: "address" },
      { name: "prevHint", type: "address" },
      { name: "nextHint", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "adjustVault",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collateralDelta6", type: "int256" },
      { name: "debtDelta18", type: "int256" },
      { name: "prevHint", type: "address" },
      { name: "nextHint", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount18", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "closeVault",
    stateMutability: "nonpayable",
    inputs: [
      { name: "prevHint", type: "address" },
      { name: "nextHint", type: "address" },
    ],
    outputs: [],
  },
  // ---- peg mechanisms ----
  {
    type: "function",
    name: "liquidate",
    stateMutability: "nonpayable",
    inputs: [{ name: "vault", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [{ name: "vusdAmount18", type: "uint256" }],
    outputs: [],
  },
  // ---- Vault Guardian (TEE) delegated repay ----
  {
    type: "function",
    name: "delegatedRepay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "maxAmount18", type: "uint256" },
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
  // ---- views (used by pre-flight, indexer, keeper) ----
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
    name: "mcrBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "minDebt18",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "mintFeeBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "liqBonusBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  // ---- events (indexer + keeper consume these) ----
  {
    type: "event",
    name: "VaultOpened",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "collateral6", type: "uint256", indexed: false },
      { name: "debt18", type: "uint256", indexed: false },
      { name: "nicr", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "VaultAdjusted",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "collateral6", type: "uint256", indexed: false },
      { name: "debt18", type: "uint256", indexed: false },
      { name: "nicr", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "VaultClosed",
    inputs: [{ name: "owner", type: "address", indexed: true }],
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
    name: "DelegatedRepay",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "funder", type: "address", indexed: true },
      { name: "amount18", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Redeemed",
    inputs: [
      { name: "redeemer", type: "address", indexed: true },
      { name: "vusdAmount18", type: "uint256", indexed: false },
      { name: "fxrpPaid6", type: "uint256", indexed: false },
    ],
  },
] as const;
