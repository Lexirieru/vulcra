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

// Branch collateral scales under test.
var (
	scale6  = CollateralScale(6)  // FXRP branch collateral scale (1e6)
	scale18 = CollateralScale(18) // wFLR branch collateral scale (1e18)
)

// ---- FXRP branch (6-decimal collateral) ------------------------------------
//
// Reference vault used across the FXRP CR cases:
//
//	collateral = 100 FXRP   -> collateralRaw = 100_000000   (6 decimals)
//	debt       = 100 vUSD   -> debt18        = 100e18       (18 decimals)
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
			cr, ok := ComputeCRBps(refCollateral6, refDebt18, tc.price, scale6)
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
			got := Liquidatable(refCollateral6, refDebt18, tc.price, mcr, scale6)
			if got != tc.want {
				t.Fatalf("Liquidatable = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestLiquidatable_ZeroDebt(t *testing.T) {
	// debt == 0 -> CR undefined -> never liquidatable, even at any price.
	if Liquidatable(refCollateral6, big.NewInt(0), price129, mcr, scale6) {
		t.Fatalf("zero-debt vault must not be liquidatable")
	}
	if _, ok := ComputeCRBps(refCollateral6, big.NewInt(0), price129, scale6); ok {
		t.Fatalf("ComputeCRBps with zero debt must return ok=false")
	}
}

func TestLiquidatable_StaleZeroPriceGuard(t *testing.T) {
	// Zero/negative authoritative price must NEVER trigger a liquidation, even
	// though a naive CR of 0 would look far below MCR. This is the stale-price
	// safety guard.
	if Liquidatable(refCollateral6, refDebt18, big.NewInt(0), mcr, scale6) {
		t.Fatalf("zero price must be treated as stale -> not liquidatable")
	}
	if Liquidatable(refCollateral6, refDebt18, big.NewInt(-1), mcr, scale6) {
		t.Fatalf("negative price must be treated as invalid -> not liquidatable")
	}
	if _, ok := ComputeCRBps(refCollateral6, refDebt18, big.NewInt(0), scale6); ok {
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
	if !Liquidatable(refCollateral6, refDebt18, price129, mcr, scale6) {
		t.Fatalf("precondition: stale $1.29 snapshot should look liquidatable")
	}
	// Authoritative decision uses the real price: healthy, do not liquidate.
	if Liquidatable(refCollateral6, refDebt18, price131, mcr, scale6) {
		t.Fatalf("KTD5: authoritative $1.31 is healthy; must NOT liquidate")
	}
}

func TestLiquidatable_NilAndBadInputs(t *testing.T) {
	if Liquidatable(nil, refDebt18, price129, mcr, scale6) {
		t.Fatalf("nil collateral must not liquidate")
	}
	if Liquidatable(refCollateral6, nil, price129, mcr, scale6) {
		t.Fatalf("nil debt must not liquidate")
	}
	if Liquidatable(refCollateral6, refDebt18, price129, nil, scale6) {
		t.Fatalf("nil mcr must not liquidate")
	}
	if Liquidatable(refCollateral6, refDebt18, price129, mcr, nil) {
		t.Fatalf("nil collateral scale must not liquidate")
	}
	if Liquidatable(refCollateral6, refDebt18, price129, mcr, big.NewInt(0)) {
		t.Fatalf("zero collateral scale must not liquidate")
	}
	if Liquidatable(mustBig(t, "-1"), refDebt18, price129, mcr, scale6) {
		t.Fatalf("negative collateral must not liquidate")
	}
}

// ---- wFLR branch (18-decimal collateral) -----------------------------------
//
// Reference wFLR vault:
//
//	collateral = 1000 wFLR  -> collateralRaw = 1000e18   (18 decimals)
//	debt       = 15 vUSD    -> debt18        = 15e18     (18 decimals)
//
// FLR/USD price is scaled to 18 decimals ($0.02 -> 2e16). With this vault:
//
//	collateralValueUsd18 = 1000e18 * price18 / 1e18
//	crBps                = collateralValueUsd18 * 10000 / 15e18
//
//	price $0.0200 (2e16)  -> $20.00 -> CR 13333 bps (> MCR)
//	price $0.0195 (1.95e16)-> $19.50 -> CR 13000 bps (== MCR)
//	price $0.0190 (1.9e16) -> $19.00 -> CR 12666 bps (< MCR)
var (
	wflrCollateral18 = mustBigStr("1000000000000000000000") // 1000e18 = 1000 wFLR
	wflrDebt18       = mustBigStr("15000000000000000000")   // 15e18 = 15 vUSD
	flrPrice0200     = mustBigStr("20000000000000000")      // $0.0200 -> 2e16 (18-dec)
	flrPrice0195     = mustBigStr("19500000000000000")      // $0.0195 -> 1.95e16 (== MCR)
	flrPrice0190     = mustBigStr("19000000000000000")      // $0.0190 -> 1.9e16 (< MCR)
)

// mustBigStr is a package-scoped helper for the wFLR literals above (the
// existing mustBig needs a *testing.T which these package vars do not have).
func mustBigStr(s string) *big.Int {
	v, ok := new(big.Int).SetString(s, 10)
	if !ok {
		panic("bad big int literal: " + s)
	}
	return v
}

func TestComputeCRBps_WFLR(t *testing.T) {
	cases := []struct {
		name  string
		price *big.Int
		want  int64
	}{
		{"cr_13333_above_mcr", flrPrice0200, 13333},
		{"cr_13000_at_mcr", flrPrice0195, 13000},
		{"cr_12666_below_mcr", flrPrice0190, 12666},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cr, ok := ComputeCRBps(wflrCollateral18, wflrDebt18, tc.price, scale18)
			if !ok {
				t.Fatalf("ComputeCRBps ok=false, want true")
			}
			if cr.Cmp(big.NewInt(tc.want)) != 0 {
				t.Fatalf("CR = %s bps, want %d bps", cr, tc.want)
			}
		})
	}
}

func TestLiquidatable_WFLR(t *testing.T) {
	cases := []struct {
		name  string
		price *big.Int
		want  bool
	}{
		// 1000 wFLR at $0.02, debt 15 vUSD -> CR 13333 bps > MCR -> healthy.
		{"cr_13333_not_liquidatable", flrPrice0200, false},
		// Exactly at MCR (13000 bps) -> NOT liquidatable (boundary is safe).
		{"cr_exactly_mcr_not_liquidatable", flrPrice0195, false},
		// Price drops to $0.019 -> CR 12666 bps < MCR -> liquidatable.
		{"cr_12666_liquidatable", flrPrice0190, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Liquidatable(wflrCollateral18, wflrDebt18, tc.price, mcr, scale18)
			if got != tc.want {
				t.Fatalf("Liquidatable = %v, want %v", got, tc.want)
			}
		})
	}
}

// TestLiquidatable_WrongDecimalsMisjudge proves the collateral scale is
// load-bearing: the same 18-decimal wFLR vault that IS liquidatable when scored
// with the correct 18-dec scale is misjudged as healthy when scored with the
// FXRP 6-dec scale (the old hardcoded 1e6 bug). The 18-dec path must give the
// right answer.
func TestLiquidatable_WrongDecimalsMisjudge(t *testing.T) {
	// Correct 18-dec scale: below MCR -> liquidatable.
	if !Liquidatable(wflrCollateral18, wflrDebt18, flrPrice0190, mcr, scale18) {
		t.Fatalf("wFLR vault at $0.019 must be liquidatable on the 18-dec scale")
	}
	// Wrong 6-dec scale inflates collateral value by 1e12 -> CR astronomically
	// above MCR -> would (wrongly) decline to liquidate.
	if Liquidatable(wflrCollateral18, wflrDebt18, flrPrice0190, mcr, scale6) {
		t.Fatalf("wrong 6-dec scale must misjudge the 18-dec vault as healthy")
	}

	// And the reverse mismatch: an FXRP 6-dec vault scored with the wFLR 18-dec
	// scale is deflated by 1e12 -> CR ~0 -> would (wrongly) look liquidatable,
	// while the correct 6-dec scale (price $1.29) says liquidatable and $1.31
	// says healthy. Confirm the correct scale gives the healthy answer at $1.31.
	if Liquidatable(refCollateral6, refDebt18, price131, mcr, scale6) {
		t.Fatalf("FXRP vault at $1.31 must be healthy on the correct 6-dec scale")
	}
	if !Liquidatable(refCollateral6, refDebt18, price131, mcr, scale18) {
		t.Fatalf("wrong 18-dec scale must misjudge the healthy 6-dec vault as liquidatable")
	}
}

func TestCollateralScale(t *testing.T) {
	if got := CollateralScale(6); got.Cmp(mustBigStr("1000000")) != 0 {
		t.Fatalf("CollateralScale(6) = %s, want 1e6", got)
	}
	if got := CollateralScale(18); got.Cmp(mustBigStr("1000000000000000000")) != 0 {
		t.Fatalf("CollateralScale(18) = %s, want 1e18", got)
	}
	if got := CollateralScale(0); got.Cmp(big.NewInt(1)) != 0 {
		t.Fatalf("CollateralScale(0) = %s, want 1", got)
	}
	if CollateralScale(-1) != nil {
		t.Fatalf("CollateralScale(-1) must be nil (invalid)")
	}
	if CollateralScale(37) != nil {
		t.Fatalf("CollateralScale(37) must be nil (out of range)")
	}
}
