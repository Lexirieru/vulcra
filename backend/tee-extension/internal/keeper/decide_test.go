package keeper

import (
	"math/big"
	"testing"
)

// mustBig parses a base-10 string into a *big.Int for readable test literals.
func mustBig(t *testing.T, s string) *big.Int {
	t.Helper()
	v, ok := new(big.Int).SetString(s, 10)
	if !ok {
		t.Fatalf("bad big int literal: %q", s)
	}
	return v
}

// Reference vault used across the CR cases:
//
//	collateral = 100 FXRP   -> collateral6 = 100_000000   (6 decimals)
//	debt       = 100 vUSD   -> debt18      = 100e18       (18 decimals)
//
// With this vault, collateralValueUsd18 == price18 * 100, so:
//
//	price 1.30 -> $130 -> CR 13000 bps (== MCR)
//	price 1.29 -> $129 -> CR 12900 bps (< MCR)
//	price 1.31 -> $131 -> CR 13100 bps (> MCR)
var (
	refCollateral6 = big.NewInt(100_000000)                              // 100 FXRP
	refDebt18, _   = new(big.Int).SetString("100000000000000000000", 10) // 100e18
	mcr            = big.NewInt(13000)                                   // 130% MCR in bps

	price129, _ = new(big.Int).SetString("1290000000000000000", 10) // $1.29 (18-dec)
	price130, _ = new(big.Int).SetString("1300000000000000000", 10) // $1.30
	price131, _ = new(big.Int).SetString("1310000000000000000", 10) // $1.31
)

func TestComputeCRBps(t *testing.T) {
	cases := []struct {
		name  string
		price *big.Int
		want  int64
	}{
		{"cr_129pct", price129, 12900},
		{"cr_130pct_at_mcr", price130, 13000},
		{"cr_131pct", price131, 13100},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cr, ok := ComputeCRBps(refCollateral6, refDebt18, tc.price)
			if !ok {
				t.Fatalf("ComputeCRBps ok=false, want true")
			}
			if cr.Cmp(big.NewInt(tc.want)) != 0 {
				t.Fatalf("CR = %s bps, want %d bps", cr, tc.want)
			}
		})
	}
}

func TestLiquidatable(t *testing.T) {
	cases := []struct {
		name  string
		price *big.Int
		want  bool
	}{
		// CR 129% < MCR 130% -> liquidatable.
		{"below_mcr_129_liquidatable", price129, true},
		// CR exactly at MCR (130%) -> NOT liquidatable.
		{"exactly_mcr_not_liquidatable", price130, false},
		// CR 131% > MCR -> NOT liquidatable.
		{"above_mcr_131_not_liquidatable", price131, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Liquidatable(refCollateral6, refDebt18, tc.price, mcr)
			if got != tc.want {
				t.Fatalf("Liquidatable = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestLiquidatable_ZeroDebt(t *testing.T) {
	// debt == 0 -> CR undefined -> never liquidatable, even at any price.
	if Liquidatable(refCollateral6, big.NewInt(0), price129, mcr) {
		t.Fatalf("zero-debt vault must not be liquidatable")
	}
	if _, ok := ComputeCRBps(refCollateral6, big.NewInt(0), price129); ok {
		t.Fatalf("ComputeCRBps with zero debt must return ok=false")
	}
}

func TestLiquidatable_StaleZeroPriceGuard(t *testing.T) {
	// Zero/negative authoritative price must NEVER trigger a liquidation, even
	// though a naive CR of 0 would look far below MCR. This is the stale-price
	// safety guard.
	if Liquidatable(refCollateral6, refDebt18, big.NewInt(0), mcr) {
		t.Fatalf("zero price must be treated as stale -> not liquidatable")
	}
	if Liquidatable(refCollateral6, refDebt18, big.NewInt(-1), mcr) {
		t.Fatalf("negative price must be treated as invalid -> not liquidatable")
	}
	if _, ok := ComputeCRBps(refCollateral6, refDebt18, big.NewInt(0)); ok {
		t.Fatalf("ComputeCRBps with zero price must return ok=false")
	}
}

// TestLiquidatable_KTD5_StaleLooksAtRiskButAuthoritativeHealthy models KTD5:
// the candidate looked under-collateralized in the (stale) scan snapshot at
// $1.29 (CR 129% < MCR), but the AUTHORITATIVE price re-read inside the enclave
// is $1.31 (CR 131% > MCR). Because the decision consumes the authoritative
// price, the vault is NOT liquidated.
func TestLiquidatable_KTD5_StaleLooksAtRiskButAuthoritativeHealthy(t *testing.T) {
	// Sanity: the stale price would have flagged it.
	if !Liquidatable(refCollateral6, refDebt18, price129, mcr) {
		t.Fatalf("precondition: stale $1.29 snapshot should look liquidatable")
	}
	// Authoritative decision uses the real price: healthy, do not liquidate.
	if Liquidatable(refCollateral6, refDebt18, price131, mcr) {
		t.Fatalf("KTD5: authoritative $1.31 is healthy; must NOT liquidate")
	}
}

func TestLiquidatable_NilAndBadInputs(t *testing.T) {
	if Liquidatable(nil, refDebt18, price129, mcr) {
		t.Fatalf("nil collateral must not liquidate")
	}
	if Liquidatable(refCollateral6, nil, price129, mcr) {
		t.Fatalf("nil debt must not liquidate")
	}
	if Liquidatable(refCollateral6, refDebt18, price129, nil) {
		t.Fatalf("nil mcr must not liquidate")
	}
	if Liquidatable(mustBig(t, "-1"), refDebt18, price129, mcr) {
		t.Fatalf("negative collateral must not liquidate")
	}
}
