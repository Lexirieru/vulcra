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

// ─────────────────────────────────────────────────────────────────────────────
// PLACEHOLDER — Vulcra core VaultManager (IVaultManager).
//
// TODO(smartcontract): replace with the deployed Coston2 ABI once the
// smartcontract plan ships. This fragment mirrors the plan's IVaultManager
// surface (owner-address model, 1 vault/address). Function names, hint
// parameters, and the Vault tuple shape are AUTHORITATIVE from
// smartcontract/docs/plans/2026-07-20-001-feat-vulcra-smartcontract-plan.md and
// MUST be reconciled against the real ABI before mainnet. Structured so that
// finalization is this single edit.
// ─────────────────────────────────────────────────────────────────────────────
export const vaultManagerAbi = [
  // reads
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
  { type: "function", name: "mcrBps", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "minDebt18", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "mintFeeBps", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "liqBonusBps", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  // writes (owner-address model)
  {
    type: "function",
    name: "openVault",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collateral", type: "uint256" },
      { name: "mint", type: "uint256" },
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
      { name: "collateralDelta", type: "int256" },
      { name: "debtDelta", type: "int256" },
      { name: "prevHint", type: "address" },
      { name: "nextHint", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
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
    inputs: [
      { name: "vusdAmount", type: "uint256" },
      { name: "startHint", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "delegatedRepay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "maxAmount", type: "uint256" },
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
