# packages/chain-client — Flare contract resolution

Resolves Flare **system** contract addresses at runtime through the on-chain `FlareContractRegistry`
(the one stable, documented address on every Flare network) — no hardcoded system addresses. Wraps a
viem public client for Coston2.

## Provides

- `resolveAssetManagerFXRP(client)` — the FAssets AssetManager for FXRP (`executeDirectMintingWithData`,
  direct-minting payment address, fee getters).
- `resolveMasterAccountController(client)` — Smart-Accounts controller (PersonalAccount resolution,
  nonce, `isTransactionIdUsed`).
- `resolveFxrpToken(client)` — the FXRP ERC-20.
- The Coston2 RPC/client setup and the registry address.

Vulcra's own contracts (VaultManager, Zap, vUSD, StabilityPool, PriceOracle) come from env/config, not
the registry — see `smartcontract/deployments/coston2.json`.

## 🔒 Security
No secrets. Never commit `.env`, `references/`, or `VULCRA_PRD.md`.
