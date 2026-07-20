// VulcraZap ABI — the single call target of the 0xFE atomic-mint userOp.
//
// DRAFT — smartcontract plan is authority. Per that plan the Zap function is
// `openVaultAndForward(...)` (NOT `zapMint`). It is designed as Call[1] of a
// 2-call userOp batch executed by the PersonalAccount, where
// Call[0] = FXRP.approve(zap, collateral6).

export const vulcraZapAbi = [
  {
    type: "function",
    name: "openVaultAndForward",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collateral6", type: "uint256" },
      { name: "mint18", type: "uint256" },
      { name: "vusdDestination", type: "address" },
      { name: "prevHint", type: "address" },
      { name: "nextHint", type: "address" },
    ],
    outputs: [],
  },
  {
    // Front-end / executor pre-flight helper: does the proposed mint satisfy MCR & minDebt?
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
      { name: "ok", type: "bool" },
    ],
  },
] as const;
