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

	// 2. Resolve MCR (request override or config default).
	mcrBps := e.cfg.MCRBps
	if req.MCRBps != "" {
		if v, ok := new(big.Int).SetString(req.MCRBps, 10); ok {
			mcrBps = v
		}
	}

	out := types.KeeperScanResult{}
	for _, owner := range req.CandidateOwners {
		vr := types.KeeperVaultResult{Owner: owner}

		// 3. AUTHORITATIVE re-read INSIDE the enclave (KTD5): getVault + FTSO.
		// SCAFFOLD/CHAIN: call VaultManager.getVault(owner) and the FTSO feed via
		// an eth client resolved from config.RPCURL / FlareContractRegistry.
		// collateral6, debt18, active := e.chain.GetVault(owner)
		// xrpUsdPrice18 := e.chain.XRPUsdPrice18()
		collateral6, debt18, xrpUsdPrice18, active, err := e.readAuthoritativeVault(owner)
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

		// 4. PURE DECISION (offline-tested logic).
		crBps, ok := keeper.ComputeCRBps(collateral6, debt18, xrpUsdPrice18)
		vr.Collateral6 = bigStr(collateral6)
		vr.Debt18 = bigStr(debt18)
		vr.XRPUsdPrice18 = bigStr(xrpUsdPrice18)
		if ok {
			vr.CRBps = crBps.String()
		}
		vr.Liquidatable = keeper.Liquidatable(collateral6, debt18, xrpUsdPrice18, mcrBps)

		// 5. EXECUTE (gated). Only submit liquidate() when configured and not dry-run.
		if vr.Liquidatable && !req.DryRun {
			if err := e.cfg.CanExecuteOnChain(); err != nil {
				vr.Error = "decision-only (execution gated): " + err.Error()
			} else {
				// SCAFFOLD/CHAIN: e.chain.Liquidate(owner) via the TEE keeper wallet
				// (permissionless liquidate(address vaultOwner)). Sign via SIGN_PORT.
				txHash, err := e.submitLiquidate(owner)
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
	commitment, err := e.rules.Register(rule, e.cfg.MCRBps)
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

	// 3. AUTHORITATIVE CR + debt: from request (simulation) or on-chain read.
	currentCRBps, currentDebt18, err := e.resolveEvalState(&req, rule.Owner)
	if err != nil {
		return e.fail(action, df, fmt.Errorf("resolving vault state: %w", err))
	}

	// 4. PURE DECISION (offline-tested).
	should, amount := guardian.ShouldRepay(&rule, currentCRBps, e.cfg.MCRBps, currentDebt18)

	res := types.GuardianEvaluateResult{
		TermsCommitment: req.TermsCommitment,
		ShouldRepay:     should,
	}
	if should {
		res.RepayAmount18 = amount.String()
		// 5. EXECUTE (gated): VaultManager.delegatedRepay(owner, amount).
		if !req.DryRun {
			if err := e.cfg.CanExecuteOnChain(); err != nil {
				res.Error = "decision-only (execution gated): " + err.Error()
			} else {
				// SCAFFOLD/CHAIN: delegatedRepay is on VaultManager, gated to
				// GUARDIAN_EXECUTOR_ROLE held by the TEE keeper wallet. No separate
				// guardian contract.
				txHash, err := e.submitDelegatedRepay(rule.Owner, amount)
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

// readAuthoritativeVault re-reads getVault(owner) + the FTSO XRP/USD price
// inside the enclave. SCAFFOLD/CHAIN: implement with a real eth client.
func (e *Extension) readAuthoritativeVault(owner string) (collateral6, debt18, xrpUsdPrice18 *big.Int, active bool, err error) {
	return nil, nil, nil, false, fmt.Errorf("readAuthoritativeVault: chain client not wired (SCAFFOLD)")
}

// decryptRule ECIES-decrypts the ciphertext via the TEE node and ABI-decodes
// the (owner, triggerCRBps, maxRepay18) tuple. SCAFFOLD/CHAIN.
func (e *Extension) decryptRule(ciphertextHex string) (guardian.Rule, error) {
	return guardian.Rule{}, fmt.Errorf("decryptRule: TEE /decrypt not wired (SCAFFOLD)")
}

// resolveEvalState returns the authoritative CR (bps) and debt (18-dec), from
// the request when provided (simulation), else read on-chain. SCAFFOLD/CHAIN.
func (e *Extension) resolveEvalState(req *types.GuardianEvaluateRequest, owner string) (currentCRBps, currentDebt18 *big.Int, err error) {
	if req.CurrentCRBps != "" && req.CurrentDebt18 != "" {
		cr, ok1 := new(big.Int).SetString(req.CurrentCRBps, 10)
		d, ok2 := new(big.Int).SetString(req.CurrentDebt18, 10)
		if ok1 && ok2 {
			return cr, d, nil
		}
	}
	return nil, nil, fmt.Errorf("resolveEvalState: chain client not wired (SCAFFOLD)")
}

func (e *Extension) submitLiquidate(owner string) (txHash string, err error) {
	return "", fmt.Errorf("submitLiquidate: keeper wallet not wired (SCAFFOLD)")
}

func (e *Extension) submitDelegatedRepay(owner string, amount *big.Int) (txHash string, err error) {
	return "", fmt.Errorf("submitDelegatedRepay: keeper wallet not wired (SCAFFOLD)")
}

// buildResult is a placeholder for the scaffold helper of the same role.
// SCAFFOLD: delete this and use the scaffold's buildResult once vendored.
func buildResult(action teetypes.Action, df *instruction.DataFixed, data []byte, status int, err error) teetypes.ActionResult {
	panic("SCAFFOLD: replace buildResult with fce-extension-scaffold's helper")
}
