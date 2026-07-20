// Package types holds the request/response DTOs exchanged with the Vulcra TEE
// extension. It is standard-library only (encoding/json) so it builds offline
// and can be imported by both the pure logic and the framework wiring.
//
// All amounts crossing the wire are decimal STRINGS (not JSON numbers) so that
// 18-decimal uint256 values survive JSON without float rounding. The handler
// parses them into math/big.Int before doing any arithmetic.
//
// Vault identity is the OWNER ADDRESS ("0x"-prefixed), matching the on-chain
// getVault(address owner) interface — there is no numeric vaultId.
package types

// ---- KEEPER / SCAN ---------------------------------------------------------

// KeeperScanRequest is the payload for a KEEPER/SCAN instruction. The candidate
// owner addresses typically come from the (possibly stale) indexer snapshot;
// the enclave re-reads each vault's AUTHORITATIVE state (getVault + FTSO price)
// before deciding. XRPUsdPrice18 / MCRBps may be supplied for simulation/tests;
// when empty the handler reads them on-chain.
type KeeperScanRequest struct {
	// CandidateOwners is the list of vault owner addresses to inspect.
	CandidateOwners []string `json:"candidateOwners"`
	// MCRBps overrides the on-chain MCR for the scan (optional, decimal string).
	MCRBps string `json:"mcrBps,omitempty"`
	// DryRun, when true, computes decisions but does not submit liquidate() txs.
	DryRun bool `json:"dryRun,omitempty"`
}

// KeeperVaultResult is the per-vault outcome of a scan.
type KeeperVaultResult struct {
	Owner         string `json:"owner"`
	Collateral6   string `json:"collateral6"`   // decimal string, 6 decimals
	Debt18        string `json:"debt18"`        // decimal string, 18 decimals
	XRPUsdPrice18 string `json:"xrpUsdPrice18"` // authoritative price used, 18 decimals
	CRBps         string `json:"crBps"`         // computed CR, basis points
	Liquidatable  bool   `json:"liquidatable"`
	// Liquidated is true only when a liquidate() tx was actually submitted.
	Liquidated bool   `json:"liquidated"`
	TxHash     string `json:"txHash,omitempty"`
	Error      string `json:"error,omitempty"`
}

// KeeperScanResult is the aggregate result of a KEEPER/SCAN.
type KeeperScanResult struct {
	Scanned int                 `json:"scanned"`
	Results []KeeperVaultResult `json:"results"`
}

// ---- GUARDIAN / REGISTER ---------------------------------------------------

// GuardianRegisterRequest carries the ECIES-encrypted protection rule. The
// ciphertext is hex ("0x"-prefixed) and is decrypted ONLY inside the enclave
// (via the TEE node /decrypt endpoint). The decrypted plaintext is the
// ABI-encoded (address owner, uint256 triggerCRBps, uint256 maxRepay18) tuple.
type GuardianRegisterRequest struct {
	Ciphertext string `json:"ciphertext"`
}

// GuardianRegisterResult returns ONLY the public termsCommitment. It reveals
// nothing about the private trigger or max-repay — those never leave the
// enclave.
type GuardianRegisterResult struct {
	TermsCommitment string `json:"termsCommitment"`
	Stored          bool   `json:"stored"`
}

// ---- GUARDIAN / EVALUATE ---------------------------------------------------

// GuardianEvaluateRequest asks the enclave to evaluate a vault against its
// stored private rule (looked up by termsCommitment) and, if inside the
// protection window, call VaultManager.delegatedRepay. CurrentCRBps /
// CurrentDebt18 may be provided for simulation; otherwise the enclave reads the
// authoritative on-chain state.
type GuardianEvaluateRequest struct {
	TermsCommitment string `json:"termsCommitment"`
	CurrentCRBps    string `json:"currentCrBps,omitempty"`  // decimal string, bps
	CurrentDebt18   string `json:"currentDebt18,omitempty"` // decimal string, 18 decimals
	DryRun          bool   `json:"dryRun,omitempty"`
}

// GuardianEvaluateResult reports the decision. It never echoes the private
// trigger; RepayAmount18 is disclosed only because it becomes an on-chain
// delegatedRepay call.
type GuardianEvaluateResult struct {
	TermsCommitment string `json:"termsCommitment"`
	ShouldRepay     bool   `json:"shouldRepay"`
	RepayAmount18   string `json:"repayAmount18,omitempty"` // decimal string, 18 decimals
	Repaid          bool   `json:"repaid"`
	TxHash          string `json:"txHash,omitempty"`
	Error           string `json:"error,omitempty"`
}
