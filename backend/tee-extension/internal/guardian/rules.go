// Package guardian holds the Vault Guardian DECISION LOGIC and the in-enclave
// private-rule store for the Vulcra TEE extension (requirement U13).
//
// This package is dependency-free (Go standard library only, including a local
// Keccak-256 in keccak.go) so its unit tests run fully OFFLINE:
//
//	GOPROXY=off go test ./internal/guardian/...
//
// # What the Guardian does
//
// Users register PRIVATE protection rules. The plaintext rule (trigger CR, max
// repay) is ECIES-encrypted to the extension public key off-chain; the
// ciphertext is delivered as a GUARDIAN/REGISTER instruction and decrypted ONLY
// inside the enclave (that decryption happens in internal/extension via the TEE
// node's /decrypt endpoint — not here). The decrypted Rule is then kept ONLY in
// enclave memory, keyed by its termsCommitment (a keccak256 commitment).
// Nothing about the rule is on-chain except the commitment.
//
// On evaluation, if a vault's CR falls below its private trigger but is still
// above MCR, the extension calls VaultManager.delegatedRepay(vaultOwner,
// maxAmount) using the TEE keeper wallet (which holds GUARDIAN_EXECUTOR_ROLE).
// There is NO separate guardian contract — see contracts/VulcraInstructionSender.sol
// and the eval.go ShouldRepay logic.
package guardian

import (
	"encoding/hex"
	"errors"
	"math/big"
	"strings"
	"sync"
)

// Rule is a single user's private protection rule. It exists in plaintext ONLY
// inside the enclave.
//
//   - Owner        : the vault owner address ("0x"-prefixed, 20 bytes) — vault
//     identity is the owner address, matching getVault(address owner).
//   - Branch       : which collateral branch (e.g. "FXRP" / "WFLR") this rule
//     protects. It selects the VaultManager + FTSO feed the extension reads and
//     the delegatedRepay it calls. It is metadata for ROUTING only and is
//     deliberately NOT part of the termsCommitment (see Commit), so the on-chain
//     commitment scheme keccak256(abi.encode(owner, trigger, maxRepay)) is
//     unchanged. Empty means the caller applies its default branch (FXRP).
//   - TriggerCRBps : the private CR threshold (bps) at which protection fires;
//     must be strictly above MCR (below MCR the liquidation keeper owns it).
//   - MaxRepay18   : the maximum vUSD (18 decimals) the Guardian may repay on
//     the owner's behalf in one action, passed as the delegatedRepay maxAmount.
type Rule struct {
	Owner        string
	Branch       string
	TriggerCRBps *big.Int
	MaxRepay18   *big.Int
}

// Errors returned by rule validation / registration.
var (
	ErrEmptyOwner      = errors.New("guardian: rule owner address is empty")
	ErrBadOwner        = errors.New("guardian: rule owner is not a 20-byte 0x address")
	ErrNonPositiveTrig = errors.New("guardian: trigger CR (bps) must be > 0")
	ErrNonPositiveMax  = errors.New("guardian: max repay (18-dec) must be > 0")
	// ErrBranchCollision guards the multi-collateral edge where two rules share
	// the same branch-free termsCommitment (identical owner+trigger+maxRepay) but
	// target DIFFERENT branches. Because Commit is intentionally branch-free (to
	// keep on-chain parity), storing both would silently overwrite one. We reject
	// the second, loudly, rather than drop protection on a branch. The production
	// remedy is the per-registration salt noted on Commit.
	ErrBranchCollision = errors.New(
		"guardian: termsCommitment collides across branches (identical owner+trigger+maxRepay on a different branch) — vary maxRepay or add a salt")
)

// Commit returns the termsCommitment for a rule: a "0x"-prefixed hex Keccak-256
// commitment over the ABI-encoded (address owner, uint256 triggerCRBps,
// uint256 maxRepay18) tuple.
//
// This mirrors the on-chain commitment exactly:
//
//	termsCommitment = keccak256(abi.encode(owner, triggerCRBps, maxRepay18))
//
// so the value the enclave keys its rule by is the same value that appears
// on-chain. (abi.encode left-pads the address into a full 32-byte word.)
//
// NOTE: for production, add a per-registration salt/nonce to the tuple so two
// identical rules produce distinct commitments and the commitment is not
// guessable from public parameters. The Rule struct here follows the task's
// minimal shape and omits the salt; the Solidity side documents the same.
//
// Rule.Branch is intentionally NOT hashed here: the commitment must stay
// byte-for-byte identical to the on-chain keccak256(abi.encode(owner,
// triggerCRBps, maxRepay18)). Branch is routing metadata only. (Caveat: two
// rules that differ ONLY by branch collide on the same commitment key; that is
// acceptable for this minimal step and is subsumed by the salt note above.)
func Commit(r Rule) string {
	var buf [96]byte // 32 (address, left-padded) + 32 (trigger) + 32 (maxRepay)

	if addr, err := parseAddress(r.Owner); err == nil {
		// Right-align the 20 address bytes in the first 32-byte word.
		copy(buf[12:32], addr)
	}
	if r.TriggerCRBps != nil && r.TriggerCRBps.Sign() >= 0 {
		r.TriggerCRBps.FillBytes(buf[32:64])
	}
	if r.MaxRepay18 != nil && r.MaxRepay18.Sign() >= 0 {
		r.MaxRepay18.FillBytes(buf[64:96])
	}

	sum := keccak256(buf[:])
	return "0x" + hex.EncodeToString(sum[:])
}

// parseAddress parses a "0x"-prefixed 20-byte hex address (case-insensitive)
// into raw bytes.
func parseAddress(owner string) ([]byte, error) {
	s := strings.TrimSpace(owner)
	if s == "" {
		return nil, ErrEmptyOwner
	}
	s = strings.TrimPrefix(strings.ToLower(s), "0x")
	if len(s) != 40 {
		return nil, ErrBadOwner
	}
	b, err := hex.DecodeString(s)
	if err != nil {
		return nil, ErrBadOwner
	}
	return b, nil
}

// Store is the in-enclave rule store, keyed by termsCommitment (hex string).
// It is safe for concurrent use. The store holds plaintext rules and therefore
// only ever exists inside the TEE — it is never serialized to disk or chain.
type Store struct {
	mu    sync.RWMutex
	rules map[string]Rule
}

// NewStore returns an empty rule store.
func NewStore() *Store {
	return &Store{rules: make(map[string]Rule)}
}

// Validate checks a rule against the Guardian invariants (see field docs).
// mcrBps, when non-nil, additionally enforces that the trigger sits strictly
// above MCR — a trigger at/below MCR belongs to the liquidation keeper, not the
// Guardian.
func Validate(r Rule, mcrBps *big.Int) error {
	if _, err := parseAddress(r.Owner); err != nil {
		return err
	}
	if r.TriggerCRBps == nil || r.TriggerCRBps.Sign() <= 0 {
		return ErrNonPositiveTrig
	}
	if r.MaxRepay18 == nil || r.MaxRepay18.Sign() <= 0 {
		return ErrNonPositiveMax
	}
	if mcrBps != nil && r.TriggerCRBps.Cmp(mcrBps) <= 0 {
		return errors.New("guardian: trigger CR must be strictly above MCR")
	}
	return nil
}

// Register validates a rule, computes its termsCommitment, stores it keyed by
// that commitment, and returns the commitment. Registering the same tuple twice
// yields the same commitment and overwrites in place (idempotent).
//
// mcrBps may be nil to skip the above-MCR check (e.g. when MCR is applied later
// at evaluation time); pass it to reject bad rules at registration.
func (s *Store) Register(r Rule, mcrBps *big.Int) (string, error) {
	if err := Validate(r, mcrBps); err != nil {
		return "", err
	}
	commitment := Commit(r)
	newBranch := strings.TrimSpace(r.Branch)

	s.mu.Lock()
	defer s.mu.Unlock()
	// Reject a cross-branch collision: same commitment, different (non-empty)
	// branch. Same-branch re-registration (idempotent overwrite) is allowed, as is
	// filling in a previously-empty branch.
	if existing, ok := s.rules[commitment]; ok {
		if existing.Branch != "" && newBranch != "" && !strings.EqualFold(existing.Branch, newBranch) {
			return "", ErrBranchCollision
		}
	}
	// Store defensive copies of the big.Ints so callers can't mutate stored state.
	s.rules[commitment] = Rule{
		Owner:        strings.ToLower(strings.TrimSpace(r.Owner)),
		Branch:       newBranch,
		TriggerCRBps: new(big.Int).Set(r.TriggerCRBps),
		MaxRepay18:   new(big.Int).Set(r.MaxRepay18),
	}
	return commitment, nil
}

// Get returns the rule for a termsCommitment and whether it was found.
func (s *Store) Get(commitment string) (Rule, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	r, ok := s.rules[commitment]
	if !ok {
		return Rule{}, false
	}
	// Return a copy so callers cannot mutate stored state.
	return Rule{
		Owner:        r.Owner,
		Branch:       r.Branch,
		TriggerCRBps: new(big.Int).Set(r.TriggerCRBps),
		MaxRepay18:   new(big.Int).Set(r.MaxRepay18),
	}, true
}

// Delete removes a rule (e.g. after the user cancels protection).
func (s *Store) Delete(commitment string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.rules, commitment)
}

// Len reports how many rules are currently held in the enclave.
func (s *Store) Len() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.rules)
}
