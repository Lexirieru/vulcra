// VulcraZap ABI (V2) — the single call target of the 0xFE atomic-mint userOp.
//
// Aligned to smartcontract/src/interfaces/IVulcraZap.sol:
//   openVaultAndForward(collateral6, mint18, annualInterestRateBps, vusdDestination, prevHint, nextHint)
// Designed as Call[1] of a 2-call userOp batch executed by the PersonalAccount,
// where Call[0] = FXRP.approve(zap, collateral6). For the smoothest XRPL
// 1-payment UX pass the VaultManager's defaultInterestRateBps().

export const vulcraZapAbi = [
  {
    type: "function",
    name: "openVaultAndForward",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collateral6", type: "uint256" },
      { name: "mint18", type: "uint256" },
      { name: "annualInterestRateBps", type: "uint256" },
      { name: "vusdDestination", type: "address" },
      { name: "prevHint", type: "address" },
      { name: "nextHint", type: "address" },
    ],
    outputs: [],
  },
  {
    // Reads the caller's live FXRP balance at execution instead of a baked-in
    // collateral amount, so fee/AMG-rounding can't strand the mint. Pair with
    // Call[0] = FXRP.approve(zap, MAX_UINT256). See IVulcraZap.openVaultAndForwardAll.
    type: "function",
    name: "openVaultAndForwardAll",
    stateMutability: "nonpayable",
    inputs: [
      { name: "mint18", type: "uint256" },
      { name: "annualInterestRateBps", type: "uint256" },
      { name: "vusdDestination", type: "address" },
      { name: "prevHint", type: "address" },
      { name: "nextHint", type: "address" },
    ],
    outputs: [],
  },
  {
    // Supply side of the balance-read pattern: sweep the caller's live FXRP into
    // their existing vault (via VaultManager.addCollateralFor). Same MAX-approve pairing.
    type: "function",
    name: "addCollateralAll",
    stateMutability: "nonpayable",
    inputs: [
      { name: "prevHint", type: "address" },
      { name: "nextHint", type: "address" },
    ],
    outputs: [],
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
] as const;
