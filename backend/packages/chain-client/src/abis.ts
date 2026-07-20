// Minimal Flare system-contract ABIs — hand-written for the exact reads we need.
// Real chain, real addresses (resolved via registry): NOT a mock. Contract WRITE
// calls that carry the complex IXRPPayment.Proof tuple (executeDirectMinting*)
// load the typed AssetManager ABI from @flarenetwork/flare-wagmi-periphery-package
// at runtime in the executor submit module (gated), to avoid a hand-written
// proof-tuple drift. See apps/executor/src/attestation.

export const flareContractRegistryAbi = [
  {
    type: "function",
    name: "getContractAddressByName",
    stateMutability: "view",
    inputs: [{ name: "_name", type: "string" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export const ftsoV2Abi = [
  {
    type: "function",
    name: "getFeedById",
    stateMutability: "payable",
    inputs: [{ name: "_feedId", type: "bytes21" }],
    outputs: [
      { name: "_value", type: "uint256" },
      { name: "_decimals", type: "int8" },
      { name: "_timestamp", type: "uint64" },
    ],
  },
] as const;

// AssetManager (FXRP) — read surface used by pre-flight + the mint pipeline.
export const assetManagerAbi = [
  {
    type: "function",
    name: "fAsset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "directMintingPaymentAddress",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "getDirectMintingMinimumFeeUBA",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getDirectMintingFeeBIPS",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getDirectMintingExecutorFeeUBA",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getDirectMintingHourlyLimitUBA",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getDirectMintingDailyLimitUBA",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getDirectMintingLargeMintingThresholdUBA",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getDirectMintingLargeMintingDelaySeconds",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getDirectMintingsUnblockUntilTimestamp",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "isTransactionIdUsed",
    stateMutability: "view",
    inputs: [{ name: "_transactionId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;
