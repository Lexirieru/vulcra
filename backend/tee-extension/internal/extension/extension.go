// Package extension wires the Vulcra confidential logic into the
// fce-extension-scaffold framework: it implements processAction, routes on
// OPType then OPCommand, and calls into the dependency-free decision packages
// (internal/keeper, internal/guardian).
//
// ============================ OFFLINE-BUILD NOTE ============================
// This file imports the fce-extension-scaffold framework packages (teetypes,
// instruction, teeutils). Those modules are NOT vendored in this repo, so THIS
// PACKAGE DOES NOT COMPILE OFFLINE. That is expected and acceptable per the
// task: all pure decision logic lives in internal/keeper and internal/guardian
// (which DO build and test offline) and is merely CALLED from here.
//
// To make this package build, the orchestrator must vendor the scaffold and add
// the require line to go.mod. Every scaffold touch-point is marked `// SCAFFOLD:`
// with the exact fce-extension-scaffold file/symbol to copy or confirm.
// ===========================================================================
package extension

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math/big"
	"strings"
	"sync"

	"github.com/vulcra/tee-extension/internal/config"
	"github.com/vulcra/tee-extension/internal/guardian"
	"github.com/vulcra/tee-extension/internal/keeper"
	"github.com/vulcra/tee-extension/pkg/types"

	// SCAFFOLD: confirm these import paths against fce-extension-scaffold.
	// In the scaffold they are the framework packages used by
	// internal/extension/extension.go. Replace the module path once vendored.
	"github.com/flare-foundation/fce-extension-scaffold/pkg/instruction" // SCAFFOLD: DataFixed{OPType, OPCommand, OriginalMessage}
	"github.com/flare-foundation/fce-extension-scaffold/pkg/teetypes"    // SCAFFOLD: Action, ActionResult
	"github.com/flare-foundation/fce-extension-scaffold/pkg/teeutils"    // SCAFFOLD: ToHash(string) [32]byte
)

// Extension is the stateful in-enclave server object. The guardian rule store
// lives ONLY here, in enclave memory.
type Extension struct {
	cfg   *config.Config
	rules *guardian.Store

	mu      sync.Mutex
	scanNum uint64
	evalNum uint64
}

// New constructs the extension with a loaded config and an empty rule store.
func New(cfg *config.Config) *Extension {
	return &Extension{cfg: cfg, rules: guardian.NewStore()}
}

// processAction is the scaffold entry point (POST /action). It routes on OPType
// then OPCommand. A mismatched OPType/OPCommand returns an "unsupported"
// error result, matching the scaffold's fall-through behavior.
//
// SCAFFOLD: signature/return type mirror the scaffold's processAction. Confirm
// exact types (teetypes.Action, *instruction.DataFixed, teetypes.ActionResult).
func (e *Extension) processAction(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	switch {
	case df.OPType == teeutils.ToHash(config.OPTypeKeeper):
		switch {
		case df.OPCommand == teeutils.ToHash(config.OPCommandScan):
			return e.processKeeperScan(action, df)
		default:
			return e.fail(action, df, fmt.Errorf("unsupported op command for KEEPER"))
		}

	case df.OPType == teeutils.ToHash(config.OPTypeGuardian):
		switch {
		case df.OPCommand == teeutils.ToHash(config.OPCommandRegister):
			return e.processGuardianRegister(action, df)
		case df.OPCommand == teeutils.ToHash(config.OPCommandEvaluate):
			return e.processGuardianEvaluate(action, df)
		default:
			return e.fail(action, df, fmt.Errorf("unsupported op command for GUARDIAN"))
		}

	default:
		return e.fail(action, df, fmt.Errorf("unsupported op type"))
	}
}

// ---- KEEPER / SCAN ---------------------------------------------------------

func (e *Extension) processKeeperScan(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	// 1. DECODE untrusted request.
	var req types.KeeperScanRequest
	if err := decodeStrict(df.OriginalMessage, &req); err != nil {
		return e.fail(action, df, fmt.Errorf("decoding KeeperScanRequest: %w", err))
	}

	// 2. Optional per-request MCR override (else each branch's configured MCR).
	var reqMCR *big.Int
	if req.MCRBps != "" {
		if v, ok := new(big.Int).SetString(req.MCRBps, 10); ok {
			reqMCR = v
		}
	}

	out := types.KeeperScanResult{}

	// 3. BRANCH LOOP. Multi-collateral => one VaultManager per branch, each with
	// its own collateral decimals, FTSO feed and MCR. A request may scope the
	// scan to a single branch via req.Branch; empty scans every configured branch.
	for bi := range e.cfg.Branches {
		br := &e.cfg.Branches[bi]
		if req.Branch != "" && !strings.EqualFold(req.Branch, br.Key) {
			continue
		}

		// Branch collateral scale (10^decimals) drives the keeper CR math:
		// 1e6 for FXRP, 1e18 for wFLR. This is the fix for the old hardcoded 1e6.
		collateralScale := keeper.CollateralScale(br.CollateralDecimals)

		mcrBps := br.MCRBps
		if reqMCR != nil {
			mcrBps = reqMCR
		}

		for _, owner := range req.CandidateOwners {
			vr := types.KeeperVaultResult{Owner: owner, Branch: br.Key}

			// 3a. AUTHORITATIVE re-read INSIDE the enclave (KTD5): this branch's
			// VaultManager.getVault(owner) + this branch's FTSO feed (scaled to
			// 18-dec). SCAFFOLD/CHAIN: resolve the eth client from config.RPCURL /
			// FlareContractRegistry; read br.VaultManager and br.FeedID.
			collateralRaw, debt18, priceUsd18, active, err := e.readAuthoritativeVault(br, owner)
			if err != nil {
				vr.Error = err.Error()
				out.Results = append(out.Results, vr)
				continue
			}
			if !active {
				vr.Error = "vault not active"
				out.Results = append(out.Results, vr)
				continue
			}

			// 3b. PURE DECISION (offline-tested logic), branch-scaled.
			crBps, ok := keeper.ComputeCRBps(collateralRaw, debt18, priceUsd18, collateralScale)
			vr.Collateral6 = bigStr(collateralRaw)
			vr.Debt18 = bigStr(debt18)
			vr.XRPUsdPrice18 = bigStr(priceUsd18)
			if ok {
				vr.CRBps = crBps.String()
			}
			vr.Liquidatable = keeper.Liquidatable(collateralRaw, debt18, priceUsd18, mcrBps, collateralScale)

			// 3c. EXECUTE (gated). Only submit liquidate() when configured and not
			// dry-run. Runs for wFLR too — the branch has no XRPL mint path, but
			// its EVM vaults are liquidated exactly like FXRP's.
			if vr.Liquidatable && !req.DryRun {
				if err := e.cfg.CanExecuteOnChain(); err != nil {
					vr.Error = "decision-only (execution gated): " + err.Error()
				} else {
					// SCAFFOLD/CHAIN: e.chain.Liquidate(owner) on br.VaultManager via
					// the TEE keeper wallet (permissionless liquidate(address owner)).
					txHash, err := e.submitLiquidate(br, owner)
					if err != nil {
						vr.Error = err.Error()
					} else {
						vr.Liquidated = true
						vr.TxHash = txHash
					}
				}
			}
			out.Results = append(out.Results, vr)
		}
	}
	out.Scanned = len(out.Results)

	e.mu.Lock()
	e.scanNum++
	e.mu.Unlock()

	return e.ok(action, df, out)
}

// ---- GUARDIAN / REGISTER ---------------------------------------------------

func (e *Extension) processGuardianRegister(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	// 1. DECODE.
	var req types.GuardianRegisterRequest
	if err := decodeStrict(df.OriginalMessage, &req); err != nil {
		return e.fail(action, df, fmt.Errorf("decoding GuardianRegisterRequest: %w", err))
	}
	if req.Ciphertext == "" {
		return e.fail(action, df, fmt.Errorf("empty ciphertext"))
	}

	// 2. DECRYPT the ECIES ciphertext INSIDE the enclave, then decode the
	// ABI-encoded (address owner, uint256 triggerCRBps, uint256 maxRepay18).
	// SCAFFOLD: call the TEE node /decrypt endpoint (see fce-weather-insurance
	// buyPolicyPrivate). The plaintext NEVER leaves the enclave.
	rule, err := e.decryptRule(req.Ciphertext)
	if err != nil {
		return e.fail(action, df, fmt.Errorf("decrypting rule: %w", err))
	}

	// 3. VALIDATE + STORE keyed by termsCommitment (pure, offline-tested).
	// Validate the trigger against the rule's OWN branch MCR (per-branch MCR).
	commitment, err := e.rules.Register(rule, e.branchMCR(rule.Branch))
	if err != nil {
		return e.fail(action, df, fmt.Errorf("registering rule: %w", err))
	}

	// 4. RESULT: only the public commitment is returned.
	return e.ok(action, df, types.GuardianRegisterResult{
		TermsCommitment: commitment,
		Stored:          true,
	})
}

// ---- GUARDIAN / EVALUATE ---------------------------------------------------

func (e *Extension) processGuardianEvaluate(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	// 1. DECODE.
	var req types.GuardianEvaluateRequest
	if err := decodeStrict(df.OriginalMessage, &req); err != nil {
		return e.fail(action, df, fmt.Errorf("decoding GuardianEvaluateRequest: %w", err))
	}

	// 2. Look up the PRIVATE rule (held only in enclave memory).
	rule, ok := e.rules.Get(req.TermsCommitment)
	if !ok {
		return e.fail(action, df, fmt.Errorf("no rule for termsCommitment %s", req.TermsCommitment))
	}

	// 3. Resolve the branch this evaluation routes to: the request may override
	// (simulation), else the rule's own branch. This selects the VaultManager +
	// FTSO feed to read and the delegatedRepay target, plus the MCR to score.
	branchKey := rule.Branch
	if req.Branch != "" {
		branchKey = req.Branch
	}
	branch, _ := e.cfg.BranchByKey(branchKey)
	mcrBps := e.branchMCR(branchKey)

	// 4. AUTHORITATIVE CR + debt: from request (simulation) or on-chain read on
	// this branch's VaultManager + feed.
	currentCRBps, currentDebt18, err := e.resolveEvalState(&req, branch, rule.Owner)
	if err != nil {
		return e.fail(action, df, fmt.Errorf("resolving vault state: %w", err))
	}

	// 5. PURE DECISION (offline-tested), scored against the branch's MCR.
	should, amount := guardian.ShouldRepay(&rule, currentCRBps, mcrBps, currentDebt18)

	res := types.GuardianEvaluateResult{
		TermsCommitment: req.TermsCommitment,
		Branch:          branchKey,
		ShouldRepay:     should,
	}
	if should {
		res.RepayAmount18 = amount.String()
		// 6. EXECUTE (gated): br.VaultManager.delegatedRepay(owner, amount).
		if !req.DryRun {
			if err := e.cfg.CanExecuteOnChain(); err != nil {
				res.Error = "decision-only (execution gated): " + err.Error()
			} else {
				// SCAFFOLD/CHAIN: delegatedRepay is on this branch's VaultManager,
				// gated to GUARDIAN_EXECUTOR_ROLE held by the TEE keeper wallet. No
				// separate guardian contract.
				txHash, err := e.submitDelegatedRepay(branch, rule.Owner, amount)
				if err != nil {
					res.Error = err.Error()
				} else {
					res.Repaid = true
					res.TxHash = txHash
				}
			}
		}
	}

	e.mu.Lock()
	e.evalNum++
	e.mu.Unlock()

	return e.ok(action, df, res)
}

// ---- helpers ---------------------------------------------------------------

// decodeStrict JSON-decodes untrusted OriginalMessage, rejecting unknown fields.
func decodeStrict(raw []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

func bigStr(v *big.Int) string {
	if v == nil {
		return ""
	}
	return v.String()
}

// ok / fail build the scaffold ActionResult.
//
// SCAFFOLD: replace with the scaffold's buildResult(action, df, data, status, err)
// helper. status 1 = success (data), status 0 = error (err logged). The TEE node
// signs the result hash; only status==1 results are accepted on-chain.
func (e *Extension) ok(action teetypes.Action, df *instruction.DataFixed, payload any) teetypes.ActionResult {
	data, err := json.Marshal(payload)
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("marshaling result: %w", err))
	}
	return buildResult(action, df, data, 1, nil)
}

func (e *Extension) fail(action teetypes.Action, df *instruction.DataFixed, err error) teetypes.ActionResult {
	return buildResult(action, df, nil, 0, err)
}

// ---- SCAFFOLD/CHAIN stubs --------------------------------------------------
// The following are the ONLY parts that need chain access. They are declared
// here so the routing + decision flow above is complete and reviewable. The
// orchestrator implements them against an eth client (go-ethereum) resolving
// addresses via config.FlareContractReg / config env, and signing through the
// TEE SIGN_PORT. They are NOT mocked — with no funded keeper key, execution is
// gated off by config.CanExecuteOnChain and only decisions are produced.

// branchMCR returns the MCR (bps) for a branch key: the branch's configured MCR
// when the key resolves, else the global config MCR. Used both to validate a
// rule's trigger at registration and to score it at evaluation.
func (e *Extension) branchMCR(branchKey string) *big.Int {
	if branchKey != "" {
		if br, ok := e.cfg.BranchByKey(branchKey); ok && br.MCRBps != nil {
			return br.MCRBps
		}
	}
	return e.cfg.MCRBps
}

// readAuthoritativeVault re-reads br.VaultManager.getVault(owner) + br's FTSO
// price (scaled to 18-dec) inside the enclave. The returned collateralRaw is in
// br.CollateralDecimals; the caller scales it via keeper.CollateralScale.
// SCAFFOLD/CHAIN: implement with a real eth client against br.VaultManager /
// br.FeedID.
func (e *Extension) readAuthoritativeVault(br *config.Branch, owner string) (collateralRaw, debt18, priceUsd18 *big.Int, active bool, err error) {
	return nil, nil, nil, false, fmt.Errorf("readAuthoritativeVault[%s]: chain client not wired (SCAFFOLD)", branchKeyOf(br))
}

// decryptRule ECIES-decrypts the ciphertext via the TEE node and ABI-decodes
// the (owner, triggerCRBps, maxRepay18) tuple. The branch is carried alongside
// the ciphertext / plaintext and set on the returned Rule. SCAFFOLD/CHAIN.
func (e *Extension) decryptRule(ciphertextHex string) (guardian.Rule, error) {
	return guardian.Rule{}, fmt.Errorf("decryptRule: TEE /decrypt not wired (SCAFFOLD)")
}

// resolveEvalState returns the authoritative CR (bps) and debt (18-dec), from
// the request when provided (simulation), else read on-chain from the branch's
// VaultManager + feed. SCAFFOLD/CHAIN.
func (e *Extension) resolveEvalState(req *types.GuardianEvaluateRequest, br *config.Branch, owner string) (currentCRBps, currentDebt18 *big.Int, err error) {
	if req.CurrentCRBps != "" && req.CurrentDebt18 != "" {
		cr, ok1 := new(big.Int).SetString(req.CurrentCRBps, 10)
		d, ok2 := new(big.Int).SetString(req.CurrentDebt18, 10)
		if ok1 && ok2 {
			return cr, d, nil
		}
	}
	return nil, nil, fmt.Errorf("resolveEvalState[%s]: chain client not wired (SCAFFOLD)", branchKeyOf(br))
}

func (e *Extension) submitLiquidate(br *config.Branch, owner string) (txHash string, err error) {
	return "", fmt.Errorf("submitLiquidate[%s]: keeper wallet not wired (SCAFFOLD)", branchKeyOf(br))
}

func (e *Extension) submitDelegatedRepay(br *config.Branch, owner string, amount *big.Int) (txHash string, err error) {
	return "", fmt.Errorf("submitDelegatedRepay[%s]: keeper wallet not wired (SCAFFOLD)", branchKeyOf(br))
}

// branchKeyOf is a nil-safe accessor for a branch's key, for log/error messages.
func branchKeyOf(br *config.Branch) string {
	if br == nil {
		return "?"
	}
	return br.Key
}

// buildResult is a placeholder for the scaffold helper of the same role.
// SCAFFOLD: delete this and use the scaffold's buildResult once vendored.
func buildResult(action teetypes.Action, df *instruction.DataFixed, data []byte, status int, err error) teetypes.ActionResult {
	panic("SCAFFOLD: replace buildResult with fce-extension-scaffold's helper")
}
