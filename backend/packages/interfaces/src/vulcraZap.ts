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
