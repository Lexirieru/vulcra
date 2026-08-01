# Vulcra Smart Contracts

Multi-collateral CDP stablecoin protocol on **Flare Coston2** (chain **114**), issuing the shared
**vUSD** stablecoin against XRPL-native and Flare collateral. Liquity-V2 model: lock collateral,
pick your own **annual interest rate**, mint vUSD, repay to unlock. Foundry project.

## CDP model in one paragraph

**One shared `VUSD` token, one isolated "branch" per collateral.** A branch = a `PriceOracle` (its
own FTSOv2 feed) + a `VaultManager` (its own collateral token, params, and debt) + a `StabilityPool`;
the FXRP branch also has a `VulcraZap`. Each `VaultManager` holds MINTER_ROLE on the single shared
vUSD, so `VUSD.totalSupply() == Σ_branches totalDebt` holds continuously. Borrowers set a per-vault
annual interest rate (bps) that accrues into debt via an O(1) aggregate model (no per-vault loop);
every op settles pending interest by minting it to the branch `interestReceiver` (routed to that
branch's StabilityPool). **Redemption is by interest rate — lowest-rate vaults first** — via a sorted
doubly-linked vault list; **liquidation is by CR** (any vault below MCR). MCR is per-branch (130% FXRP,
150% wFLR). The `VaultManager` runtime ABI is identical across branches — adding a collateral means
deploying another instance, never changing a signature.

## Layout

- `src/` — the contracts. See `src/CLAUDE.md` for the per-contract breakdown.
- `script/` — Foundry deploy/ops scripts (see below).
- `test/` — `unit/`, `fuzz/`, `invariant/`, `integration/` (live-fork oracle), `build/` gate, `helpers/`.
- `deployments/coston2.json` — **authoritative** live addresses + model notes. Update on redeploy.
- `foundry.toml` — solc 0.8.28, `via_ir=true`, optimizer 200, `evm_version=cancun`; remaps OZ,
  forge-std, and `@flarenetwork/flare-periphery-contracts` (npm, in `node_modules/`).
- `lib/` — Foundry dependencies (git submodule: forge-std, openzeppelin-contracts,
  openzeppelin-contracts-upgradeable). Clone the repo with `--recursive`. Do not edit; not documented here.
- `broadcast/` — forge broadcast logs (chain 31337 + dry-runs gitignored).

## Build / test

```bash
forge build
forge test                       # all suites (unit, fuzz, invariant, build gate)
forge test --match-contract Redemption -vvv
forge test --match-path test/integration/PriceOracleFork.t.sol   # needs COSTON2_RPC_URL
```

## Deploy / ops (Coston2)

Copy `.env.example` → `.env` and fill `COSTON2_RPC_URL` (+ `PRIVATE_KEY` for real broadcast). Simulate
by omitting `--broadcast`. Broadcaster becomes protocol admin.

```bash
# 1. Core protocol: shared VUSD + FXRP branch (+Zap) + wFLR branch. Collateral tokens resolved from
#    FlareContractRegistry at runtime (nothing hardcoded).
forge script script/DeployVulcra.s.sol --rpc-url $COSTON2_RPC_URL --broadcast --verify \
  --verifier blockscout --verifier-url https://coston2-explorer.flare.network/api

# 2. Earn: one shared StabilityPool impl + one UUPS proxy per branch (reads deployments/coston2.json).
forge script script/DeployStabilityPool.s.sol --rpc-url $COSTON2_RPC_URL --broadcast ...

# 3. Seed TVL/rewards and point each branch interestReceiver at its pool (testnet treasury mint path).
STABILITY_POOL_FXRP=0x... STABILITY_POOL_WFLR=0x... \
  forge script script/SeedStabilityPool.s.sol --rpc-url $COSTON2_RPC_URL --broadcast

# 4. UUPS upgrade of pools (also used as a live _authorizeUpgrade rehearsal at launch).
forge script script/UpgradeStabilityPool.s.sol --rpc-url $COSTON2_RPC_URL --broadcast ...
```

`script/config/Coston2Config.sol` holds feed ids, decimals, staleness, per-branch params/interest
config, and debt ceilings. `script/VulcraDeployerBase.sol` is the shared deploy-and-wire sequence
(reused by `test/unit/DeployWiring.t.sol` so script and test never drift).

## Live deployed addresses — Coston2 (chain 114)

Explorer: https://coston2-explorer.flare.network — Admin: `0x2917AcaAE420feEbc5eD76Efd3c37929A46eC81E`

| Component | Address |
|-----------|---------|
| VUSD (shared) | `0x333FDCf66792122e80654E197Eb6Fa3705f1B6D8` |
| StabilityPool implementation (shared) | `0xAfC0d66405CB687c9208534f2c086d402A0172f7` |
| **FXRP branch** — collateral (6-dec, XRP/USD) | `0x0b6A3645c240605887a5532109323A3E12273dc7` |
| FXRP PriceOracle | `0x63Bf4a9d716Ce16C0E091EF9C3281f44829f953B` |
| FXRP VaultManager | `0x93e572cDbfb62557E041B53490e5208C147b5388` |
| FXRP VulcraZap (0xFE XRPL-native mint) | `0xCe4f886e67dE51418751314eEb19aC2D75B59dfE` |
| FXRP StabilityPool (proxy) | `0xfA2dCc4B93909ACc1dd6b2e92178D04cD1D851E4` |
| **wFLR branch** — collateral (18-dec, FLR/USD) | `0xC67DCE33D7A8efA5FfEB961899C73fe01bCe9273` |
| wFLR PriceOracle | `0x914cd3509727afeED74267FDF5c9E7f1fB4453Df` |
| wFLR VaultManager | `0x1F079F205ca2857a3A199937Ace956ed51B0b3b8` |
| wFLR StabilityPool (proxy) | `0xB963D913CFb4688634184aB7b22e554B34557e07` |
| FlareContractRegistry (external) | `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` |
| WNat / wFLR (external) | `0xC67DCE33D7A8efA5FfEB961899C73fe01bCe9273` |
| AssetManagerFXRP (external) | `0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA` |

Per-branch params: FXRP MCR 130%, minDebt 100 vUSD, mint fee 0.5%, liq bonus 10%, no debt ceiling.
wFLR MCR 150%, minDebt 200 vUSD, mint fee 0.5%, liq bonus 12%, debt ceiling 500k vUSD. Both: interest
0.5%–250%/yr (default 5% FXRP / 8% wFLR), redemption fee 0.

## Security

- Deployer/admin **private keys live ONLY in gitignored `.env`** (`.env`, `.env.*` ignored;
  `.env.example` is the only committed template). **Never commit a real key or print secret values.**
- Never commit `references/` or `VULCRA_PRD.md` (internal planning docs).
- The Seed script's temporary self-granted `MINTER_ROLE` (testnet treasury path) is **revoked in the
  same broadcast** — afterwards only VaultManagers can mint vUSD.
- All upgradeable contracts are UUPS, gated by `UPGRADER_ROLE`. Fixes ship as upgrades, not redeploys.
