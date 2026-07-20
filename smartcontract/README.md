# Vulcra Smart Contracts

CDP stablecoin protocol on Flare: lock **FXRP** collateral, mint **vUSD**, repay to unlock.
Target network: **Flare Coston2** (chain **114**). Plan:
[`docs/plans/2026-07-20-001-feat-vulcra-smartcontract-plan.md`](docs/plans/2026-07-20-001-feat-vulcra-smartcontract-plan.md).

## Contracts

| Contract | Role |
|----------|------|
| `PriceOracle` | FTSOv2 block-latency XRP/USD via `ContractRegistry` (no hardcoded addresses); staleness guard; centralized 18-dec normalization. |
| `VUSD` | ERC-20 (18-dec) + EIP-2612 permit + EIP-3009 `transferWithAuthorization`; mint/burn restricted to the VaultManager. |
| `VaultManager` | Core CDP: open/adjust/close, mint-fee-into-debt, liquidation, redemption, Guardian delegated repay; NICR-sorted vault list. |
| `VulcraZap` | Single-target helper for the XRPL-native atomic mint (Smart Accounts `0xFE` flow). |

All four are **UUPS-upgradeable** (OpenZeppelin upgradeable v5.6.1). FXRP and all Flare system
addresses are resolved at runtime via `FlareContractRegistry` — nothing is hardcoded.

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

Invariants covered: `vusd.totalSupply() == VaultManager.totalDebt()`, the vault list is always
NICR-ordered, and the protocol is overcollateralized whenever no vault carries bad debt.

Optional **live** oracle test against Coston2 (reads the real XRP/USD feed, no mocks):

```bash
COSTON2_RPC_URL=https://coston2-api.flare.network/ext/C/rpc \
  forge test --match-path "test/integration/PriceOracleFork.t.sol"
```

## Deploy to Coston2

Copy `.env.example` to `.env` and fill it in. **Never commit `.env` or any private key.**

### 1. Simulate (no key, no broadcast)

Resolves FXRP from the live registry and dry-runs the full wiring:

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

The script deploys the four proxies, grants `VUSD.MINTER_ROLE` to the VaultManager, sets the
parameters from `script/config/Coston2Config.sol` (MCR 130%, min debt 100 vUSD, mint fee 0.5%,
liquidation bonus 10%), and — if `GUARDIAN_EXECUTOR` is set — grants the TEE keeper the
`GUARDIAN_EXECUTOR_ROLE`. It logs every deployed address plus the resolved FXRP token.

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
