// Package extension wires the Vulcra confidential logic into the Flare
// Confidential Compute framework (the fce-extension-scaffold pattern): it
// serves POST /action, parses instruction.DataFixed out of each action, routes
// on OPType then OPCommand, and calls into the dependency-free decision
// packages (internal/keeper, internal/guardian).
//
// Framework packages (the same ones the scaffold uses):
//
//   - github.com/flare-foundation/go-flare-common/pkg/tee/instruction — DataFixed
//   - github.com/flare-foundation/tee-node/pkg/types                  — Action, ActionResult
//   - github.com/flare-foundation/tee-node/pkg/utils                  — ToHash
//   - github.com/flare-foundation/tee-node/pkg/processorutils         — Parse
//
// Authoritative chain state (getVault + FTSO price) is re-read INSIDE the
// enclave via internal/chain on every decision; the FCC indexer DB is consumed
// by the ext-proxy for instruction transport only, never for decisions (KTD5).
package extension

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/vulcra/tee-extension/internal/chain"
	"github.com/vulcra/tee-extension/internal/config"
	"github.com/vulcra/tee-extension/internal/guardian"
	"github.com/vulcra/tee-extension/internal/keeper"
	"github.com/vulcra/tee-extension/pkg/types"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/flare-foundation/go-flare-common/pkg/logger"
	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	"github.com/flare-foundation/tee-node/pkg/processorutils"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"
)

// Extension is the stateful in-enclave server object. The guardian rule store
// lives ONLY here, in enclave memory.
type Extension struct {
	cfg   *config.Config
	rules *guardian.Store
	chain *chain.Client

	// Server is the extension HTTP server (POST /action, GET /state).
	Server *http.Server

	mu      sync.Mutex
	scanNum uint64
	evalNum uint64
}

// New constructs the extension with a loaded config, an empty rule store and a
// live chain reader, and wires the HTTP mux (scaffold layout: GET /state,
// POST /action).
func New(cfg *config.Config, extensionPort int) (*Extension, error) {
	cc, err := chain.Dial(cfg.RPCURL, cfg.FlareContractReg)
	if err != nil {
		return nil, fmt.Errorf("extension: %w", err)
	}
	e := &Extension{cfg: cfg, rules: guardian.NewStore(), chain: cc}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /state", e.stateHandler)
	mux.HandleFunc("POST /action", e.actionHandler)
	e.Server = &http.Server{Addr: fmt.Sprintf(":%d", extensionPort), Handler: mux}
	return e, nil
}

// stateHandler exposes only PUBLIC counters — never rule contents.
func (e *Extension) stateHandler(w http.ResponseWriter, r *http.Request) {
	e.mu.Lock()
	state := map[string]any{
		"version":      config.Version,
		"simulatedTee": e.cfg.SimulatedTEE,
		"branches":     len(e.cfg.Branches),
		"scans":        e.scanNum,
		"evaluations":  e.evalNum,
		"rulesStored":  e.rules.Len(),
	}
	e.mu.Unlock()
	if err := json.NewEncoder(w).Encode(state); err != nil {
		http.Error(w, fmt.Sprintf("sending response: %v", err), http.StatusInternalServerError)
	}
}

// actionHandler is the framework entry point (POST /action) — boilerplate
// mirroring the scaffold.
func (e *Extension) actionHandler(w http.ResponseWriter, r *http.Request) {
	var action teetypes.Action
	if err := json.NewDecoder(r.Body).Decode(&action); err != nil {
		http.Error(w, fmt.Sprintf("decoding action: %v", err), http.StatusBadRequest)
		return
	}

	logger.Infof("received action, ID: %s", action.Data.ID)
	status, body := e.ProcessAction(action)
	logger.Infof("sending action result, ID: %s, http status: %d", action.Data.ID, status)

	w.WriteHeader(status)
	_, _ = w.Write(body)
}

// ProcessAction parses the DataFixed instruction out of the action and routes
// on OPType then OPCommand. A mismatched OPType/OPCommand returns HTTP 501,
// matching the scaffold's fall-through behavior.
func (e *Extension) ProcessAction(action teetypes.Action) (int, []byte) {
	df, err := processorutils.Parse[instruction.DataFixed](action.Data.Message)
	if err != nil {
		return http.StatusBadRequest, []byte(fmt.Sprintf("decoding fixed data: %v", err))
	}

	switch {
	case df.OPType == teeutils.ToHash(config.OPTypeKeeper):
		switch {
		case df.OPCommand == teeutils.ToHash(config.OPCommandScan):
			return marshalResult(e.processKeeperScan(action, df))
		default:
			return http.StatusNotImplemented, []byte(fmt.Sprintf(
				"unsupported op command for KEEPER: %s", df.OPCommand.Hex()))
		}

	case df.OPType == teeutils.ToHash(config.OPTypeGuardian):
		switch {
		case df.OPCommand == teeutils.ToHash(config.OPCommandRegister):
			return marshalResult(e.processGuardianRegister(action, df))
		case df.OPCommand == teeutils.ToHash(config.OPCommandEvaluate):
			return marshalResult(e.processGuardianEvaluate(action, df))
		default:
			return http.StatusNotImplemented, []byte(fmt.Sprintf(
				"unsupported op command for GUARDIAN: %s", df.OPCommand.Hex()))
		}

	default:
		return http.StatusNotImplemented, []byte(fmt.Sprintf(
			"unsupported op type: %s", df.OPType.Hex()))
	}
}

// marshalResult serializes an ActionResult for the HTTP response.
func marshalResult(ar teetypes.ActionResult) (int, []byte) {
	b, _ := json.Marshal(ar)
	return http.StatusOK, b
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
		// 1e6 for FXRP, 1e18 for wFLR.
		collateralScale := keeper.CollateralScale(br.CollateralDecimals)

		mcrBps := br.MCRBps
		if reqMCR != nil {
			mcrBps = reqMCR
		}

		for _, owner := range req.CandidateOwners {
			vr := types.KeeperVaultResult{Owner: owner, Branch: br.Key}

			// 3a. AUTHORITATIVE re-read INSIDE the enclave (KTD5): this branch's
			// VaultManager.getVault(owner) + this branch's FTSO feed (scaled to
			// 18-dec).
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

	// 2. DECRYPT the ECIES ciphertext INSIDE the enclave (TEE node /decrypt on
	// the sign port), then ABI-decode (address owner, uint256 triggerCRBps,
	// uint256 maxRepay18). The plaintext NEVER leaves the enclave. req.Branch is
	// public ROUTING metadata (a vault's branch is on-chain anyway); the private
	// terms stay inside the ciphertext.
	rule, err := e.decryptRule(req.Ciphertext, req.Branch)
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
		// 6. EXECUTE (gated): br.VaultManager.delegatedRepay(owner, amount) —
		// gated to GUARDIAN_EXECUTOR_ROLE held by the TEE keeper wallet. No
		// separate guardian contract.
		if !req.DryRun {
			if err := e.cfg.CanExecuteOnChain(); err != nil {
				res.Error = "decision-only (execution gated): " + err.Error()
			} else {
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

// ok / fail build the framework ActionResult. Status 1 = success (data
// returned), status 0 = error (err logged). The TEE node signs the result hash;
// only status==1 results are accepted on-chain.
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

// buildResult mirrors the scaffold's helper of the same name.
func buildResult(a teetypes.Action, df *instruction.DataFixed, data []byte, status uint8, err error) teetypes.ActionResult {
	ar := teetypes.ActionResult{
		ID:            a.Data.ID,
		SubmissionTag: a.Data.SubmissionTag,
		Version:       config.Version,
		OPType:        df.OPType,
		OPCommand:     df.OPCommand,
		Data:          data,
		Status:        status,
	}
	switch status {
	case 0:
		ar.Log = fmt.Sprintf("error: %v", err)
	case 1:
		ar.Log = "ok"
	}
	return ar
}

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

// ---- chain reads (authoritative, in-enclave) -------------------------------

// readTimeout bounds each authoritative read round-trip.
const readTimeout = 20 * time.Second

// contextWithTimeout returns the bounded context every chain read uses.
func contextWithTimeout() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), readTimeout)
}

// readAuthoritativeVault re-reads br.VaultManager.getVault(owner) + br's FTSO
// price (scaled to 18-dec) inside the enclave. The returned collateralRaw is in
// br.CollateralDecimals; the caller scales it via keeper.CollateralScale.
func (e *Extension) readAuthoritativeVault(br *config.Branch, owner string) (collateralRaw, debt18, priceUsd18 *big.Int, active bool, err error) {
	if br == nil || br.VaultManager == "" {
		return nil, nil, nil, false, fmt.Errorf("readAuthoritativeVault[%s]: branch has no VaultManager", branchKeyOf(br))
	}
	ctx, cancel := contextWithTimeout()
	defer cancel()

	collateralRaw, debt18, active, err = e.chain.GetVault(ctx, br.VaultManager, owner)
	if err != nil {
		return nil, nil, nil, false, fmt.Errorf("readAuthoritativeVault[%s]: %w", branchKeyOf(br), err)
	}
	priceUsd18, _, err = e.chain.FeedPrice18(ctx, br.FeedID)
	if err != nil {
		return nil, nil, nil, false, fmt.Errorf("readAuthoritativeVault[%s]: %w", branchKeyOf(br), err)
	}
	return collateralRaw, debt18, priceUsd18, active, nil
}

// resolveEvalState returns the authoritative CR (bps) and debt (18-dec), from
// the request when provided (simulation), else read on-chain from the branch's
// VaultManager + feed.
func (e *Extension) resolveEvalState(req *types.GuardianEvaluateRequest, br *config.Branch, owner string) (currentCRBps, currentDebt18 *big.Int, err error) {
	if req.CurrentCRBps != "" && req.CurrentDebt18 != "" {
		cr, ok1 := new(big.Int).SetString(req.CurrentCRBps, 10)
		d, ok2 := new(big.Int).SetString(req.CurrentDebt18, 10)
		if ok1 && ok2 {
			return cr, d, nil
		}
	}
	if br == nil {
		return nil, nil, fmt.Errorf("resolveEvalState: unknown branch (configure VAULT_MANAGER_<KEY>_ADDRESS)")
	}
	collateralRaw, debt18, priceUsd18, active, err := e.readAuthoritativeVault(br, owner)
	if err != nil {
		return nil, nil, err
	}
	if !active {
		return nil, nil, fmt.Errorf("resolveEvalState[%s]: vault %s not active", br.Key, owner)
	}
	crBps, ok := keeper.ComputeCRBps(collateralRaw, debt18, priceUsd18, keeper.CollateralScale(br.CollateralDecimals))
	if !ok {
		return nil, nil, fmt.Errorf("resolveEvalState[%s]: CR undefined (zero debt)", br.Key)
	}
	return crBps, debt18, nil
}

// ---- rule decryption (TEE node /decrypt on the sign port) ------------------

// ruleABIArgs describes the ABI plaintext tuple:
// (address owner, uint256 triggerCRBps, uint256 maxRepay18).
var ruleABIArgs = mustRuleABIArgs()

func mustRuleABIArgs() abi.Arguments {
	addrT, err := abi.NewType("address", "", nil)
	if err != nil {
		panic(err)
	}
	uintT, err := abi.NewType("uint256", "", nil)
	if err != nil {
		panic(err)
	}
	return abi.Arguments{{Type: addrT}, {Type: uintT}, {Type: uintT}}
}

// decryptRule ECIES-decrypts the ciphertext via the TEE node's /decrypt
// endpoint (sign port) and ABI-decodes the (owner, triggerCRBps, maxRepay18)
// tuple. branch is public routing metadata set on the returned Rule.
func (e *Extension) decryptRule(ciphertextHex, branch string) (guardian.Rule, error) {
	if e.cfg.SignPort == "" {
		return guardian.Rule{}, fmt.Errorf("decryptRule: SIGN_PORT not configured (TEE node /decrypt unreachable)")
	}
	cipher := common.FromHex(strings.TrimSpace(ciphertextHex))
	if len(cipher) == 0 {
		return guardian.Rule{}, fmt.Errorf("decryptRule: empty/invalid ciphertext hex")
	}

	reqBody, err := json.Marshal(teetypes.DecryptRequest{EncryptedMessage: cipher})
	if err != nil {
		return guardian.Rule{}, fmt.Errorf("decryptRule: marshal: %w", err)
	}
	url := fmt.Sprintf("http://127.0.0.1:%s/decrypt", e.cfg.SignPort)
	httpClient := &http.Client{Timeout: 10 * time.Second}
	resp, err := httpClient.Post(url, "application/json", bytes.NewReader(reqBody))
	if err != nil {
		return guardian.Rule{}, fmt.Errorf("decryptRule: TEE node /decrypt: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return guardian.Rule{}, fmt.Errorf("decryptRule: TEE node /decrypt returned %d", resp.StatusCode)
	}
	var dr teetypes.DecryptResponse
	if err := json.NewDecoder(resp.Body).Decode(&dr); err != nil {
		return guardian.Rule{}, fmt.Errorf("decryptRule: decode response: %w", err)
	}

	vals, err := ruleABIArgs.Unpack(dr.DecryptedMessage)
	if err != nil {
		return guardian.Rule{}, fmt.Errorf("decryptRule: abi decode plaintext: %w", err)
	}
	owner, _ := vals[0].(common.Address)
	trigger, _ := vals[1].(*big.Int)
	maxRepay, _ := vals[2].(*big.Int)

	branchKey := strings.ToUpper(strings.TrimSpace(branch))
	if branchKey == "" {
		branchKey = config.BranchKeyFXRP
	}
	return guardian.Rule{
		Owner:        strings.ToLower(owner.Hex()),
		Branch:       branchKey,
		TriggerCRBps: trigger,
		MaxRepay18:   maxRepay,
	}, nil
}

// ---- transaction submission (gated) ----------------------------------------
// Live submission requires the TEE keeper wallet (GUARDIAN_EXECUTOR_ROLE,
// funded) signing through the TEE sign port. Until that wallet is provisioned,
// config.CanExecuteOnChain keeps both paths decision-only; these methods are
// only reachable once KEEPER_TEE_ADDRESS is set, and they fail loudly rather
// than pretend.

func (e *Extension) submitLiquidate(br *config.Branch, owner string) (txHash string, err error) {
	return "", fmt.Errorf("submitLiquidate[%s]: TEE keeper wallet signing not provisioned in this deployment (liquidate stays decision-only)", branchKeyOf(br))
}

func (e *Extension) submitDelegatedRepay(br *config.Branch, owner string, amount *big.Int) (txHash string, err error) {
	return "", fmt.Errorf("submitDelegatedRepay[%s]: TEE keeper wallet signing not provisioned in this deployment (delegatedRepay stays decision-only)", branchKeyOf(br))
}

// branchKeyOf is a nil-safe accessor for a branch's key, for log/error messages.
func branchKeyOf(br *config.Branch) string {
	if br == nil {
		return "?"
	}
	return br.Key
}
