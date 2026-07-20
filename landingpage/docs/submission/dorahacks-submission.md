# Vulcra — DoraHacks Submission (living checklist)

> Living content deliverable for master-plan **R22** (traction + DoraHacks submission covering both bounties with contract addresses, demo video, and a newly-built-during-program statement). This is the "§8 submission checklist." Keep placeholders explicit and update as artifacts land.
>
> Origin: `docs/plans/2026-07-20-001-feat-vulcra-cdp-flare-plan.md` (R22) · landing-page plan: `landingpage/docs/plans/2026-07-20-001-feat-vulcra-landingpage-plan.md` (U9 / LP7).

## Slots to fill (update as artifacts land)

| Slot | Value | Owner / source |
|---|---|---|
| Project name | Vulcra | fixed |
| One-liner | Forge dollars from your XRP — a CDP stablecoin on Flare. | fixed |
| App URL | _TODO — placeholder_ | frontend worker / deploy |
| Landing page URL | https://vulcra.xyz | landing page (deploy) |
| Repo URL | https://github.com/Lexirieru/vulcra | fixed |
| Demo video URL | _TODO — record near end of program_ | R22 |
| Deployed network | Coston2 (Flare testnet) | smartcontract worker |
| Contract — vUSD | _TODO — address + explorer link_ | smartcontract worker |
| Contract — VaultManager | _TODO — address + explorer link_ | smartcontract worker |
| Contract — Oracle (FTSOv2 reader) | _TODO — address + explorer link_ | smartcontract worker |
| Contract — Executor | _TODO — address + explorer link_ | backend worker |
| TEE keeper / Vault Guardian | _TODO — attestation + code-hash evidence_ | TEE worker |
| Bounty 1 submission | Interoperable Asset Products (primary) | this checklist |
| Bounty 2 submission | Confidential Compute (keeper + Vault Guardian) | this checklist |

## Submission narrative — draft copy

**What it is.** Vulcra is a CDP stablecoin protocol on Flare. XRP holders lock FXRP as collateral, mint vUSD, and repay to unlock — the first CDP system shipped on Flare, a vertical the FAssets Incentive Program explicitly funds.

**Bounty 1 — Interoperable Asset Products (primary).** Real FAssets/FXRP direct minting on Coston2, FTSOv2 live XRP/USD pricing, a complete peg (liquidation + redemption), and XRPL-native minting in one atomic Payment via Smart Accounts custom instruction 0xFE — an XRP holder mints vUSD without ever touching an EVM wallet or holding FLR.

**Bounty 2 — Confidential Compute.** A liquidation keeper and, critically, **Vault Guardian** — user-defined private protection rules that live and execute only inside a Flare Confidential Compute TEE, verifiable via reproducible build and code-hash attestation. Rules are unobservable and un-front-runnable before execution.

**Evidence of new work (newly-built-during-program statement).** All contracts, the executor/keeper/Guardian services, and both frontends were built during the Flare Summer Signal program. Repo and commit history: https://github.com/Lexirieru/vulcra . See also the progressive build-log posts in the hackathon Telegram.

**Integration depth callout.** FTSOv2, FAssets/FXRP, Smart Accounts (0xFE), FDC attestations, FCC/TEE, ContractRegistry, and the Flare wagmi periphery — all real on Coston2, no mocks.

## Checklist

- [ ] DoraHacks project created; title, one-liner, cover image (reuse the landing page OG image) set.
- [ ] Bounty 1 submission written; both-bounty linkage stated.
- [ ] Bounty 2 submission written with attestation / reproducible-build evidence linked.
- [ ] Contract addresses table filled (all Coston2 deploys, explorer-verified).
- [ ] Demo video recorded, uploaded, URL propagated to `src/lib/content.ts` (DEMO_URL) + this submission.
- [ ] App URL + landing page URL live and linked; `APP_URL` / `TELEGRAM_URL` placeholders in `content.ts` swapped.
- [ ] Newly-built-during-program statement included with repo + commit-history link.
- [ ] Progressive build-log posts made in the hackathon Telegram (R22 traction).
- [ ] Final proofread against the five judging criteria: usefulness, integration depth, technical execution, evidence of new work, clarity.

## Cross-reference: landing-page placeholders to swap

When the real URLs land, update the centralized placeholders in `landingpage/src/lib/content.ts`:

- `APP_URL` (`isPlaceholder: true`) → deployed dApp URL
- `DEMO_URL` (`isPlaceholder: true`) → demo video URL
- `TELEGRAM_URL` (`isPlaceholder: true`) → Flare Summer Signal hackathon Telegram invite

Removing `isPlaceholder` flips each CTA from a "coming soon" affordance to a live link automatically.
