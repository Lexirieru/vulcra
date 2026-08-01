# packages/interfaces — shared viem ABIs

The single source of truth for the ABIs the backend encodes/decodes against, so the executor and the
userOp builder agree on function signatures. Import these instead of re-declaring inline ABIs.

Includes (at least): `erc20Abi`, `vulcraZapAbi` (`openVaultAndForward`), the `PersonalAccount`
`executeUserOp(Call[])` entry point, and VaultManager write fragments used by the manage flow
(`addCollateral` / `withdrawCollateral` / `mintMore` / `repay` / `closeVault` / `adjustInterestRate`).

Keep these fragments in lock-step with `smartcontract/src` — the deployed contract is the authority on
the real signatures; a mismatch surfaces as an on-chain revert (`FunctionNotFound` / `CallFailed`).

## 🔒 Security
No secrets. Never commit `.env`, `references/`, or `VULCRA_PRD.md`.
