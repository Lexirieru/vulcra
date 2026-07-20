package guardian

import (
	"math/big"
	"testing"
)

func bigStr(t *testing.T, s string) *big.Int {
	t.Helper()
	v, ok := new(big.Int).SetString(s, 10)
	if !ok {
		t.Fatalf("bad big literal %q", s)
	}
	return v
}

// AE3: a private protection rule with trigger 150% (15000 bps), MCR 130%.
// The debt is 100 vUSD (100e18). These tests cover the four AE3 branches.
func TestShouldRepay_AE3(t *testing.T) {
	mcr := big.NewInt(13000)
	debt := bigStr(t, "100000000000000000000") // 100e18
	// MaxRepay effectively unbounded for the "amount = neededToRestore" cases.
	bigMax := bigStr(t, "1000000000000000000000000000000") // 1e30
	rule := &Rule{Owner: testOwner, TriggerCRBps: big.NewInt(15000), MaxRepay18: bigMax}

	t.Run("cr_145_in_window_repays", func(t *testing.T) {
		// CR 145% is below trigger 150% and above MCR 130% -> repay.
		ok, amt := ShouldRepay(rule, big.NewInt(14500), mcr, debt)
		if !ok {
			t.Fatalf("expected repay at CR 145%%")
		}
		// neededToRestore = 100e18 * (15000-14500)/15000 = 100e18/30
		want := bigStr(t, "3333333333333333333")
		if amt.Cmp(want) != 0 {
			t.Fatalf("amount = %s, want %s", amt, want)
		}
	})

	t.Run("cr_160_above_trigger_no_repay", func(t *testing.T) {
		ok, amt := ShouldRepay(rule, big.NewInt(16000), mcr, debt)
		if ok || amt.Sign() != 0 {
			t.Fatalf("healthy vault (CR 160%%) must NOT repay, got ok=%v amt=%s", ok, amt)
		}
	})

	t.Run("cr_128_below_mcr_keeper_owns_it", func(t *testing.T) {
		// CR 128% is below MCR -> liquidation keeper territory, Guardian steps aside.
		ok, amt := ShouldRepay(rule, big.NewInt(12800), mcr, debt)
		if ok || amt.Sign() != 0 {
			t.Fatalf("below-MCR vault must NOT be repaid by Guardian, got ok=%v amt=%s", ok, amt)
		}
	})

	t.Run("cr_exactly_mcr_no_repay", func(t *testing.T) {
		ok, _ := ShouldRepay(rule, big.NewInt(13000), mcr, debt)
		if ok {
			t.Fatalf("exactly at MCR must NOT repay (keeper boundary)")
		}
	})

	t.Run("cr_exactly_trigger_no_repay", func(t *testing.T) {
		ok, _ := ShouldRepay(rule, big.NewInt(15000), mcr, debt)
		if ok {
			t.Fatalf("exactly at trigger must NOT repay (healthy boundary)")
		}
	})
}

// AE3 (cap): the repay is capped at MaxRepay18 when neededToRestore exceeds it.
func TestShouldRepay_CappedAtMaxRepay(t *testing.T) {
	mcr := big.NewInt(13000)
	debt := bigStr(t, "100000000000000000000") // 100e18
	// neededToRestore at CR 145% is ~3.33e18; cap well below that at 1e18.
	cap1 := bigStr(t, "1000000000000000000") // 1e18
	rule := &Rule{Owner: testOwner, TriggerCRBps: big.NewInt(15000), MaxRepay18: cap1}

	ok, amt := ShouldRepay(rule, big.NewInt(14500), mcr, debt)
	if !ok {
		t.Fatalf("expected repay")
	}
	if amt.Cmp(cap1) != 0 {
		t.Fatalf("amount = %s, want capped %s", amt, cap1)
	}
}

func TestShouldRepay_NilAndZeroDebt(t *testing.T) {
	mcr := big.NewInt(13000)
	debt := bigStr(t, "100000000000000000000")
	rule := &Rule{Owner: testOwner, TriggerCRBps: big.NewInt(15000), MaxRepay18: big.NewInt(1)}

	if ok, _ := ShouldRepay(nil, big.NewInt(14500), mcr, debt); ok {
		t.Fatalf("nil rule must not repay")
	}
	if ok, _ := ShouldRepay(rule, nil, mcr, debt); ok {
		t.Fatalf("nil currentCR must not repay")
	}
	if ok, _ := ShouldRepay(rule, big.NewInt(14500), nil, debt); ok {
		t.Fatalf("nil mcr must not repay")
	}
	if ok, _ := ShouldRepay(rule, big.NewInt(14500), mcr, big.NewInt(0)); ok {
		t.Fatalf("zero debt must not repay")
	}
}
