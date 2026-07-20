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
// # Smart-contract interface authority (must match on-chain exactly)
//
//   - Vault identity = OWNER ADDRESS (one vault per address).
//     getVault(address owner) -> (uint256 collateral6, uint256 debt18, bool active)
//   - liquidate(address vaultOwner) is permissionless.
//   - FXRP collateral has 6 decimals; vUSD debt has 18 decimals; the FTSO
//     XRP/USD price is scaled to 18 decimals here.
//   - MCR = 13000 bps (130%).
//
// # CR definition (all math in big.Int to avoid overflow)
//
//	collateralValueUsd18 = collateral6 * xrpUsdPrice18 / 1e6
//	crBps                = collateralValueUsd18 * 10000 / debt18
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

// Scaling / basis-point constants used by the CR formula.
var (
	big1e6   = big.NewInt(1_000_000) // FXRP collateral scale (6 decimals)
	big10000 = big.NewInt(10_000)    // basis points (100% = 10000 bps)
)

// ComputeCRBps returns the collateralization ratio in basis points for a vault,
// computed from the AUTHORITATIVE inputs, and ok=true when the ratio is defined.
//
// It returns ok=false (and a nil ratio) when the ratio is undefined or the
// inputs are invalid, specifically when:
//   - any input is nil,
//   - debt18 <= 0 (no debt -> CR is effectively infinite, nothing to liquidate),
//   - xrpUsdPrice18 <= 0 (a stale/zero/negative price is not a basis for any
//     liquidation decision), or
//   - collateral6 < 0.
//
// All arithmetic uses big.Int, so large 18-decimal values never overflow.
func ComputeCRBps(collateral6, debt18, xrpUsdPrice18 *big.Int) (*big.Int, bool) {
	if collateral6 == nil || debt18 == nil || xrpUsdPrice18 == nil {
		return nil, false
	}
	if debt18.Sign() <= 0 {
		return nil, false // no debt: CR undefined / infinite -> not liquidatable
	}
	if xrpUsdPrice18.Sign() <= 0 {
		return nil, false // stale/zero/negative authoritative price -> no decision
	}
	if collateral6.Sign() < 0 {
		return nil, false
	}

	// collateralValueUsd18 = collateral6 * xrpUsdPrice18 / 1e6
	collateralValueUsd18 := new(big.Int).Mul(collateral6, xrpUsdPrice18)
	collateralValueUsd18.Quo(collateralValueUsd18, big1e6)

	// crBps = collateralValueUsd18 * 10000 / debt18
	crBps := new(big.Int).Mul(collateralValueUsd18, big10000)
	crBps.Quo(crBps, debt18)

	return crBps, true
}

// Liquidatable reports whether a vault may be liquidated: true only when the
// vault's CR (from the authoritative inputs) is STRICTLY below mcrBps.
//
// A vault exactly at MCR is healthy (not liquidatable). A vault with no debt is
// not liquidatable. A non-positive authoritative price (stale/zero) yields
// false — the enclave never liquidates on a price it cannot trust. This is the
// only decision the keeper wallet acts on before calling liquidate(vaultOwner).
func Liquidatable(collateral6, debt18, xrpUsdPrice18, mcrBps *big.Int) bool {
	if mcrBps == nil || mcrBps.Sign() <= 0 {
		return false
	}
	// Stale/zero price guard (KTD5): with no trustworthy price there is no
	// liquidation decision to make, regardless of what a stale scan suggested.
	if xrpUsdPrice18 == nil || xrpUsdPrice18.Sign() <= 0 {
		return false
	}
	crBps, ok := ComputeCRBps(collateral6, debt18, xrpUsdPrice18)
	if !ok {
		return false
	}
	// Strictly below MCR is liquidatable; exactly at MCR is safe.
	return crBps.Cmp(mcrBps) < 0
}
