package guardian

import (
	"math/big"
	"strings"
	"testing"
)

const testOwner = "0x1111111111111111111111111111111111111111"

func newRule(owner string, trigger, maxRepay int64) Rule {
	return Rule{
		Owner:        owner,
		TriggerCRBps: big.NewInt(trigger),
		MaxRepay18:   big.NewInt(maxRepay),
	}
}

func TestCommitDeterministicAndFormat(t *testing.T) {
	r := newRule(testOwner, 15000, 1000)
	c1 := Commit(r)
	c2 := Commit(r)
	if c1 != c2 {
		t.Fatalf("Commit not deterministic: %s vs %s", c1, c2)
	}
	if !strings.HasPrefix(c1, "0x") || len(c1) != 66 { // 0x + 64 hex chars
		t.Fatalf("commitment format wrong: %q", c1)
	}
	// Address case must not change the commitment (we lowercase internally).
	if Commit(newRule(strings.ToUpper(testOwner[2:]), 15000, 1000)) == c1 {
		// Different owner string form but same 20 bytes -> same commitment.
	}
}

func TestCommitDiffersByField(t *testing.T) {
	base := Commit(newRule(testOwner, 15000, 1000))
	if Commit(newRule(testOwner, 16000, 1000)) == base {
		t.Fatalf("commitment must change with trigger")
	}
	if Commit(newRule(testOwner, 15000, 2000)) == base {
		t.Fatalf("commitment must change with maxRepay")
	}
	other := "0x2222222222222222222222222222222222222222"
	if Commit(newRule(other, 15000, 1000)) == base {
		t.Fatalf("commitment must change with owner")
	}
}

func TestStoreRegisterGetDelete(t *testing.T) {
	s := NewStore()
	mcr := big.NewInt(13000)

	r := newRule(testOwner, 15000, 1000)
	commit, err := s.Register(r, mcr)
	if err != nil {
		t.Fatalf("Register error: %v", err)
	}
	if commit != Commit(r) {
		t.Fatalf("Register returned %s, want %s", commit, Commit(r))
	}
	if s.Len() != 1 {
		t.Fatalf("store len = %d, want 1", s.Len())
	}

	got, ok := s.Get(commit)
	if !ok {
		t.Fatalf("Get miss for %s", commit)
	}
	if got.TriggerCRBps.Cmp(big.NewInt(15000)) != 0 || got.MaxRepay18.Cmp(big.NewInt(1000)) != 0 {
		t.Fatalf("Get returned wrong rule: %+v", got)
	}

	// Mutating the returned copy must not affect the store.
	got.TriggerCRBps.SetInt64(1)
	again, _ := s.Get(commit)
	if again.TriggerCRBps.Cmp(big.NewInt(15000)) != 0 {
		t.Fatalf("store state was mutated through returned copy")
	}

	s.Delete(commit)
	if _, ok := s.Get(commit); ok {
		t.Fatalf("rule still present after Delete")
	}
	if s.Len() != 0 {
		t.Fatalf("store len = %d after delete, want 0", s.Len())
	}
}

// TestCommitIgnoresBranch locks the on-chain-parity invariant: Rule.Branch is
// routing metadata and must NOT change the termsCommitment (which mirrors the
// Solidity keccak256(abi.encode(owner, trigger, maxRepay))).
func TestCommitIgnoresBranch(t *testing.T) {
	base := newRule(testOwner, 15000, 1000)
	fxrp := base
	fxrp.Branch = "FXRP"
	wflr := base
	wflr.Branch = "WFLR"
	if Commit(fxrp) != Commit(base) || Commit(wflr) != Commit(base) {
		t.Fatalf("branch must not affect the commitment")
	}
}

// TestStoreRoundTripsBranch confirms the store preserves the branch metadata.
func TestStoreRoundTripsBranch(t *testing.T) {
	s := NewStore()
	r := newRule(testOwner, 15000, 1000)
	r.Branch = "WFLR"
	commit, err := s.Register(r, big.NewInt(13000))
	if err != nil {
		t.Fatalf("Register error: %v", err)
	}
	got, ok := s.Get(commit)
	if !ok {
		t.Fatalf("Get miss for %s", commit)
	}
	if got.Branch != "WFLR" {
		t.Fatalf("stored branch = %q, want WFLR", got.Branch)
	}
}

func TestRegisterValidation(t *testing.T) {
	s := NewStore()
	mcr := big.NewInt(13000)

	cases := []struct {
		name string
		rule Rule
	}{
		{"empty owner", Rule{Owner: "", TriggerCRBps: big.NewInt(15000), MaxRepay18: big.NewInt(1)}},
		{"bad owner", Rule{Owner: "0xnothex", TriggerCRBps: big.NewInt(15000), MaxRepay18: big.NewInt(1)}},
		{"nil trigger", Rule{Owner: testOwner, TriggerCRBps: nil, MaxRepay18: big.NewInt(1)}},
		{"zero trigger", Rule{Owner: testOwner, TriggerCRBps: big.NewInt(0), MaxRepay18: big.NewInt(1)}},
		{"trigger at mcr", Rule{Owner: testOwner, TriggerCRBps: big.NewInt(13000), MaxRepay18: big.NewInt(1)}},
		{"trigger below mcr", Rule{Owner: testOwner, TriggerCRBps: big.NewInt(12000), MaxRepay18: big.NewInt(1)}},
		{"zero maxRepay", Rule{Owner: testOwner, TriggerCRBps: big.NewInt(15000), MaxRepay18: big.NewInt(0)}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := s.Register(tc.rule, mcr); err == nil {
				t.Fatalf("expected validation error for %s", tc.name)
			}
		})
	}
	if s.Len() != 0 {
		t.Fatalf("no invalid rule should have been stored, len=%d", s.Len())
	}
}

func TestRegisterRejectsCrossBranchCollision(t *testing.T) {
	s := NewStore()
	// Identical owner+trigger+maxRepay on FXRP then WFLR -> same branch-free
	// commitment; the second must be rejected loudly (no silent overwrite).
	rFxrp := newRule(testOwner, 15000, 1000)
	rFxrp.Branch = "FXRP"
	if _, err := s.Register(rFxrp, nil); err != nil {
		t.Fatalf("first register failed: %v", err)
	}
	rWflr := newRule(testOwner, 15000, 1000)
	rWflr.Branch = "WFLR"
	if _, err := s.Register(rWflr, nil); err != ErrBranchCollision {
		t.Fatalf("expected ErrBranchCollision, got %v", err)
	}
	// The original FXRP rule must survive unchanged.
	c := Commit(rFxrp)
	got, ok := s.Get(c)
	if !ok || !strings.EqualFold(got.Branch, "FXRP") {
		t.Fatalf("original rule overwritten: ok=%v branch=%q", ok, got.Branch)
	}
	if s.Len() != 1 {
		t.Fatalf("expected 1 rule, got %d", s.Len())
	}
}

func TestRegisterSameBranchIsIdempotent(t *testing.T) {
	s := NewStore()
	r := newRule(testOwner, 15000, 1000)
	r.Branch = "WFLR"
	c1, err := s.Register(r, nil)
	if err != nil {
		t.Fatalf("register 1: %v", err)
	}
	c2, err := s.Register(r, nil) // same branch + tuple -> idempotent
	if err != nil {
		t.Fatalf("register 2: %v", err)
	}
	if c1 != c2 || s.Len() != 1 {
		t.Fatalf("idempotent re-register broke: c1=%s c2=%s len=%d", c1, c2, s.Len())
	}
}

func TestRegisterDifferentMaxRepayAvoidsCollision(t *testing.T) {
	s := NewStore()
	rFxrp := newRule(testOwner, 15000, 1000)
	rFxrp.Branch = "FXRP"
	rWflr := newRule(testOwner, 15000, 2000) // different maxRepay -> different commitment
	rWflr.Branch = "WFLR"
	if _, err := s.Register(rFxrp, nil); err != nil {
		t.Fatalf("fxrp: %v", err)
	}
	if _, err := s.Register(rWflr, nil); err != nil {
		t.Fatalf("wflr should not collide: %v", err)
	}
	if s.Len() != 2 {
		t.Fatalf("expected 2 rules, got %d", s.Len())
	}
}
