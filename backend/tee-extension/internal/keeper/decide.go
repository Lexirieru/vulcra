// Package keeper holds the liquidation DECISION LOGIC for the Vulcra TEE
// extension (requirements U11/U12).
//
// This package is intentionally dependency-free (Go standard library only) so
// its unit tests run fully OFFLINE:
//
//	GOPROXY=off go test ./internal/keeper/...
//
// The extension framework wiring (fetching getVault state, reading the FTSO
// price, submitting the liquidate() transaction with the TEE keeper wallet)
// lives in internal/extension and is NOT part of this package. What lives here
// is the single, pure, well-tested question: given the AUTHORITATIVE on-chain
// collateral, debt and price, is a vault below MCR and therefore liquidatable?
//
// # Multi-collateral (branch-aware)
//
// The smart contract stays collateral-agnostic with the SAME external ABI;
// multi-collateral means there is one VaultManager instance PER BRANCH (FXRP,
// wFLR, ...). Each branch's getVault(owner) returns collateral in that branch's
// TOKEN decimals, which differ between branches:
//
//   - FXRP branch: collateral has 6 decimals (collateralScale = 1e6).
//   - wFLR branch: collateral has 18 decimals (collateralScale = 1e18).
//
// so the CR math must be told the collateral scale rather than hardcoding 1e6.
// vUSD debt is always 18 decimals; the branch's FTSO price (XRP/USD, FLR/USD,
// ...) is scaled to 18 decimals by the caller before it reaches this package.
// MCR is 13000 bps for both branches but is passed in (per-branch overridable).
//
// # Smart-contract interface authority (must match on-chain exactly)
//
//   - Vault identity = OWNER ADDRESS (one vault per address, per branch).
//     getVault(address owner) -> (uint256 collateralRaw, uint256 debt18, bool active)
//   - liquidate(address vaultOwner) is permissionless.
//   - Collateral decimals are branch-specific; vUSD debt has 18 decimals; the
//     branch FTSO price is scaled to 18 decimals here.
//   - MCR = 13000 bps (130%) by default, per-branch overridable.
//
// # CR definition (all math in big.Int to avoid overflow)
//
//	collateralValueUsd18 = collateralRaw * priceUsd18 / collateralScale
//	crBps                = collateralValueUsd18 * 10000 / debt18
//
// where collateralScale = 10^collateralDecimals (1e6 for FXRP, 1e18 for wFLR).
//
// # KTD5 (stale-vs-authoritative price)
//
// The keeper scans candidate vaults using a possibly-stale indexer snapshot,
// but the LIQUIDATION DECISION is made only from state re-read authoritatively
// inside the enclave. This package models that by taking the authoritative
// price as an input: a vault that merely looks at-risk from a stale price but
// is healthy on the authoritative price is NOT liquidated. See decide_test.go.
package keeper

import "math/big"

// Basis-point constant used by the CR formula (100% == 10000 bps).
var big10000 = big.NewInt(10_000)

// maxCollateralDecimals bounds CollateralScale. 36 comfortably covers every
// ERC-20 token in existence (18 is the common case; 6 for FXRP) while rejecting
// absurd inputs that would only ever be a bug.
const maxCollateralDecimals = 36

// CollateralScale returns 10^decimals as a *big.Int, for use as the collateral
// scale in ComputeCRBps / Liquidatable. It validates decimals in
// [0, maxCollateralDecimals] and returns nil for anything outside that range,
// which the decision functions treat as an invalid input (never liquidate).
//
//	CollateralScale(6)  -> 1e6  (FXRP branch)
//	CollateralScale(18) -> 1e18 (wFLR branch)
func CollateralScale(decimals int) *big.Int {
	if decimals < 0 || decimals > maxCollateralDecimals {
		return nil
	}
	return new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(decimals)), nil)
}

// ComputeCRBps returns the collateralization ratio in basis points for a vault,
// computed from the AUTHORITATIVE inputs, and ok=true when the ratio is defined.
//
// collateralScale is the branch's collateral scale (10^collateralDecimals);
// pass CollateralScale(6) for the FXRP branch and CollateralScale(18) for the
// wFLR branch. Using the WRONG scale silently misjudges the vault, so the caller
// MUST pass the scale for the branch the collateral was read from.
//
// It returns ok=false (and a nil ratio) when the ratio is undefined or the
// inputs are invalid, specifically when:
//   - any input is nil,
//   - collateralScale <= 0 (an invalid/unknown branch scale),
//   - debt18 <= 0 (no debt -> CR is effectively infinite, nothing to liquidate),
//   - priceUsd18 <= 0 (a stale/zero/negative price is not a basis for any
//     liquidation decision), or
//   - collateralRaw < 0.
//
// All arithmetic uses big.Int, so large 18-decimal values never overflow.
func ComputeCRBps(collateralRaw, debt18, priceUsd18, collateralScale *big.Int) (*big.Int, bool) {
	if collateralRaw == nil || debt18 == nil || priceUsd18 == nil || collateralScale == nil {
		return nil, false
	}
	if collateralScale.Sign() <= 0 {
		return nil, false // invalid/unknown branch collateral scale
	}
	if debt18.Sign() <= 0 {
		return nil, false // no debt: CR undefined / infinite -> not liquidatable
	}
	if priceUsd18.Sign() <= 0 {
		return nil, false // stale/zero/negative authoritative price -> no decision
	}
	if collateralRaw.Sign() < 0 {
		return nil, false
	}

	// collateralValueUsd18 = collateralRaw * priceUsd18 / collateralScale
	collateralValueUsd18 := new(big.Int).Mul(collateralRaw, priceUsd18)
	collateralValueUsd18.Quo(collateralValueUsd18, collateralScale)

	// crBps = collateralValueUsd18 * 10000 / debt18
	crBps := new(big.Int).Mul(collateralValueUsd18, big10000)
	crBps.Quo(crBps, debt18)

	return crBps, true
}

// Liquidatable reports whether a vault may be liquidated: true only when the
// vault's CR (from the authoritative inputs) is STRICTLY below mcrBps.
//
// collateralScale is the branch's collateral scale (see ComputeCRBps /
// CollateralScale). A vault exactly at MCR is healthy (not liquidatable). A
// vault with no debt is not liquidatable. A non-positive authoritative price
// (stale/zero) or an invalid collateral scale yields false — the enclave never
// liquidates on inputs it cannot trust. This is the only decision the keeper
// wallet acts on before calling liquidate(vaultOwner) on the branch's
// VaultManager.
func Liquidatable(collateralRaw, debt18, priceUsd18, mcrBps, collateralScale *big.Int) bool {
	if mcrBps == nil || mcrBps.Sign() <= 0 {
		return false
	}
	// Stale/zero price guard (KTD5): with no trustworthy price there is no
	// liquidation decision to make, regardless of what a stale scan suggested.
	if priceUsd18 == nil || priceUsd18.Sign() <= 0 {
		return false
	}
	crBps, ok := ComputeCRBps(collateralRaw, debt18, priceUsd18, collateralScale)
	if !ok {
		return false
	}
	// Strictly below MCR is liquidatable; exactly at MCR is safe.
	return crBps.Cmp(mcrBps) < 0
}
