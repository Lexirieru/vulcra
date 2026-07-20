# Vulcra Smart Contracts

Multi-collateral CDP stablecoin protocol on Flare: lock collateral (**FXRP**, **wFLR**), mint
**vUSD**, repay to unlock. Target network: **Flare Coston2** (chain **114**). Plan:
[`docs/plans/2026-07-20-001-feat-vulcra-smartcontract-plan.md`](docs/plans/2026-07-20-001-feat-vulcra-smartcontract-plan.md).

## Multi-collateral model ("branch per collateral")

Liquity-V2 / Enosys style: **one shared `VUSD`**, and **one branch per collateral**. A branch is a
`PriceOracle` (configured with the collateral's FTSO feed) + a `VaultManager` (configured with the
collateral token/decimals/params), each granted `VUSD.MINTER_ROLE`. The FXRP branch also gets a
`VulcraZap` for XRPL-native minting; other branches are EVM-mode only.

The **`VaultManager` external runtime ABI is identical across branches** — supporting a new
collateral means deploying another instance, never changing a function signature. Backend/frontend
integrate one ABI and point it at each branch's address.

## Contracts

| Contract | Role |
|----------|------|
| `VUSD` | Shared ERC-20 (18-dec) + EIP-2612 permit + EIP-3009; mint/burn restricted to branch VaultManagers. |
| `PriceOracle` | Per-branch, feed-agnostic FTSOv2 price via `ContractRegistry` (no hardcoded addresses); staleness guard; generic `price18()`. |
| `VaultManager` | Per-branch CDP core, collateral-agnostic: open/adjust/close, mint-fee-into-debt, liquidation, redemption, Guardian delegated repay, per-branch debt ceiling; NICR-sorted vault list. |
| `VulcraZap` | FXRP-branch-only helper for the XRPL-native atomic mint (Smart Accounts `0xFE` flow). |

Decimal normalization is centralized in `VulcraMath` and applied per branch with the branch's
collateral decimals (FXRP 6, wFLR 18) and the feed's dynamic decimals (XRP/USD 6-dec, FLR/USD 8-dec).

All contracts are **UUPS-upgradeable** (OpenZeppelin upgradeable v5.6.1). Collateral tokens and all
Flare system addresses are resolved at runtime via `FlareContractRegistry` — nothing is hardcoded
(FXRP via `AssetManagerFXRP.fAsset()`, wFLR via `WNat`).

### `VaultManager.initialize` (branch config)

```
initialize(
  address admin,
  address collateralToken,     // resolved via registry by the deploy script
  uint8   collateralDecimals,  // FXRP 6, wFLR 18
  address oracle,              // per-branch PriceOracle (holds the feed id)
  address vusd,                // shared vUSD
  address feeReceiver,
  Params  params,             // {mcrBps, minDebt18, mintFeeBps, liqBonusBps, redemptionFeeBps}
  uint256 debtCeiling          // per-branch vUSD mint cap; 0 = unlimited
)
```

`initialize` is the only signature that changed; every runtime function (`openVault`,
`addCollateral`/`withdrawCollateral`/`mintMore`, `repay`, `closeVault`, `liquidate`, `redeem`,
`delegatedRepay`, `getVault`, `params`, `previewOpen`, `collateralRatioBps`, `fxrp`/`vusd`, …) is
unchanged. `fxrp()` remains as a backward-compatible alias returning the branch collateral.

## Prerequisites

```bash
git submodule update --init --recursive   # OpenZeppelin + forge-std (pinned in foundry.lock)
npm install                                # @flarenetwork/flare-periphery-contracts (Solidity interfaces)
```

## Build & Test

```bash
forge build
forge test            # unit + fuzz + invariant (offline; the live fork test self-skips)
```

Invariants covered: **`VUSD.totalSupply() == sum of every branch's `totalDebt`** (multi-branch,
across price moves + liquidation + redemption on both branches), each branch's vault list is always
NICR-ordered, and each branch is overcollateralized whenever no vault carries bad debt. Fuzz coverage
includes wFLR normalization (18-dec collateral + 8-dec FLR/USD feed).

Optional **live** oracle test against Coston2 (reads the real XRP/USD feed, no mocks):

```bash
COSTON2_RPC_URL=https://coston2-api.flare.network/ext/C/rpc \
  forge test --match-path "test/integration/PriceOracleFork.t.sol"
```

## Deploy to Coston2

Copy `.env.example` to `.env` and fill it in. **Never commit `.env` or any private key.**

### 1. Simulate (no key, no broadcast)

Resolves FXRP and wFLR from the live registry and dry-runs the full multi-branch wiring:

```bash
forge script script/DeployVulcra.s.sol --rpc-url "$COSTON2_RPC_URL"
```

### 2. Broadcast + verify (requires a funded deployer key)

```bash
PRIVATE_KEY=0x... \
forge script script/DeployVulcra.s.sol \
  --rpc-url "$COSTON2_RPC_URL" \
  --broadcast \
  --verify \
  --verifier blockscout \
  --verifier-url https://coston2-explorer.flare.network/api
```

**Deploy order** (from `script/DeployVulcra.s.sol`, config in `script/config/Coston2Config.sol`):

1. Shared `VUSD` (once).
2. **FXRP branch** — `PriceOracle`(XRP/USD) → `VaultManager`(FXRP, 6-dec, MCR 130%, min debt 100,
   ceiling ∞) → grant `VUSD.MINTER_ROLE` → `VulcraZap` → grant `ZAP_ROLE`.
3. **wFLR branch** — `PriceOracle`(FLR/USD) → `VaultManager`(wFLR, 18-dec, MCR 150%, min debt 200,
   ceiling 500k) → grant `VUSD.MINTER_ROLE` (no Zap).
4. If `GUARDIAN_EXECUTOR` is set, grant the TEE keeper `GUARDIAN_EXECUTOR_ROLE` on both branches.

Params differ per branch and are configurable in `Coston2Config`. The script logs the shared VUSD
plus every branch's oracle/manager/zap and the registry-resolved collateral tokens. After a real
broadcast, populate `deployments/coston2.json` (`shared.VUSD` + per-branch addresses).

Verification uses the Coston2 Blockscout explorer. If `--verify` is skipped at broadcast time,
verify each contract afterward with `forge verify-contract <addr> <Contract> --verifier blockscout
--verifier-url https://coston2-explorer.flare.network/api`.

## Environment variables

| Var | Required for | Meaning |
|-----|--------------|---------|
| `COSTON2_RPC_URL` | simulate, broadcast, fork test | `https://coston2-api.flare.network/ext/C/rpc` |
| `PRIVATE_KEY` | **real broadcast only** | Funded deployer key (~24 C2FLR estimated gas). Becomes admin. **Never commit.** |
| `FEE_RECEIVER` | optional | Mint/redemption fee recipient (defaults to the deployer). |
| `GUARDIAN_EXECUTOR` | optional | TEE keeper address granted `GUARDIAN_EXECUTOR_ROLE` for delegated repay. |

The FCC indexer DB credentials used by the off-chain TEE keeper are **not** consumed by these
contracts and must never appear in this repo.
