// Command guardian-service is the long-running Guardian backend the Vulcra
// frontend talks to. It bundles, in one process:
//
//   1. A TEE node key (simulated attestation) serving /decrypt + /sign on the
//      sign port — the same in-enclave key management the real tee-node runs.
//   2. The real extension keeper (internal/extension), invoked IN-PROCESS via
//      ProcessAction (no localhost /action hop), which decrypts rules through
//      the sign port and re-reads authoritative on-chain vault state.
//   3. A public REST facade — GET/POST /guardian/rules, PATCH /guardian/rules/{id},
//      POST /guardian/rules/{id}/evaluate — matching the shapes the frontend's
//      api client already expects (GuardianRule / GuardianRuleInput).
//   4. A background watch loop that re-evaluates every enabled rule on an
//      interval and logs the auto-repay decision (dry-run unless a funded keeper
//      wallet holds GUARDIAN_EXECUTOR_ROLE — the same gate as the keeper).
//
// The private terms (trigger CR, max repay) are ECIES-encrypted to the TEE key
// before REGISTER, decrypted ONLY inside the keeper, and committed on-chain only
// as keccak256(owner, trigger, maxRepay) — never the plaintext trigger. The
// facade keeps owner-facing metadata (so the user sees their own rule) but the
// evaluation source of truth is the keeper's in-enclave store, keyed by the
// termsCommitment returned at registration.
package main

import (
	"crypto/ecdsa"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"

	"github.com/vulcra/tee-extension/internal/config"
	"github.com/vulcra/tee-extension/internal/extension"
	vtypes "github.com/vulcra/tee-extension/pkg/types"
)

// ---- rule metadata store (owner-facing; NOT the private evaluation source) ---

// ruleMeta is what the frontend sees: the public rule fields plus the
// termsCommitment that drives evaluation inside the keeper.
type ruleMeta struct {
	ID              string `json:"id"`
	Owner           string `json:"owner"`
	TriggerCRBps    int64  `json:"triggerCrBps"`
	MaxRepay18      string `json:"maxRepay18"`
	Funder          string `json:"funder,omitempty"`
	Branch          string `json:"branch,omitempty"`
	VaultManager    string `json:"vaultManager,omitempty"`
	Enabled         bool   `json:"enabled"`
	CreatedAt       int64  `json:"createdAt"`
	TermsCommitment string `json:"termsCommitment"`
}

type store struct {
	mu    sync.Mutex
	order []string
	byID  map[string]*ruleMeta
}

func newStore() *store { return &store{byID: map[string]*ruleMeta{}} }

func (s *store) add(r *ruleMeta) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.byID[r.ID] = r
	s.order = append(s.order, r.ID)
}

func (s *store) listByOwner(owner string) []*ruleMeta {
	s.mu.Lock()
	defer s.mu.Unlock()
	owner = strings.ToLower(owner)
	out := []*ruleMeta{}
	for _, id := range s.order {
		r := s.byID[id]
		if owner == "" || strings.ToLower(r.Owner) == owner {
			out = append(out, r)
		}
	}
	return out
}

func (s *store) get(id string) (*ruleMeta, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.byID[id]
	return r, ok
}

func (s *store) enabledRules() []*ruleMeta {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []*ruleMeta{}
	for _, id := range s.order {
		if r := s.byID[id]; r.Enabled {
			out = append(out, r)
		}
	}
	return out
}

// ---- server ----------------------------------------------------------------

type server struct {
	cfg     *config.Config
	ext     *extension.Extension
	teePriv *ecdsa.PrivateKey
	teeID   common.Address
	rules   *store
	origins map[string]bool
}

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	if len(cfg.Branches) == 0 {
		log.Fatalf("no branches configured — set VAULT_MANAGER_FXRP_ADDRESS (source .env)")
	}
	signPort := cfg.SignPort
	if signPort == "" {
		signPort = "7701"
	}

	// 1. TEE node key + /decrypt (+ /sign) on the sign port (simulated enclave).
	teePriv, err := crypto.GenerateKey()
	if err != nil {
		log.Fatalf("tee key: %v", err)
	}
	teeID := crypto.PubkeyToAddress(teePriv.PublicKey)
	startSignServer(teePriv, signPort)
	log.Printf("tee-node key initialized (teeID=%s), /decrypt on sign port %s", teeID.Hex(), signPort)

	// 2. Keeper extension, in-process (ProcessAction called directly).
	extPort := intEnv("EXTENSION_PORT", 7702)
	ext, err := extension.New(cfg, extPort)
	if err != nil {
		log.Fatalf("extension: %v", err)
	}

	srv := &server{
		cfg: cfg, ext: ext, teePriv: teePriv, teeID: teeID,
		rules: newStore(), origins: allowedOrigins(),
	}

	// 3. Background evaluate loop.
	interval := time.Duration(intEnv("GUARDIAN_EVAL_INTERVAL_SECONDS", 30)) * time.Second
	go srv.evalLoop(interval)

	// 4. Public REST facade. Railway/Render/Fly inject $PORT; fall back to
	// GUARDIAN_API_PORT (local) then 8790.
	apiPort := intEnv("PORT", intEnv("GUARDIAN_API_PORT", 8790))
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", srv.health)
	mux.HandleFunc("GET /guardian/rules", srv.listRules)
	mux.HandleFunc("POST /guardian/rules", srv.createRule)
	mux.HandleFunc("PATCH /guardian/rules/{id}", srv.patchRule)
	mux.HandleFunc("POST /guardian/rules/{id}/evaluate", srv.evaluateRule)
	mux.HandleFunc("OPTIONS /", srv.preflight)

	addr := fmt.Sprintf(":%d", apiPort)
	log.Printf("guardian-service REST facade on %s (simulatedTee=%v, branches=%d, evalInterval=%s)",
		addr, cfg.SimulatedTEE, len(cfg.Branches), interval)
	log.Fatal(http.ListenAndServe(addr, srv.cors(mux)))
}

// ---- REST handlers ---------------------------------------------------------

func (s *server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":           true,
		"simulatedTee": s.cfg.SimulatedTEE,
		"teeId":        s.teeID.Hex(),
		"branches":     len(s.cfg.Branches),
		"rulesStored":  len(s.rules.listByOwner("")),
	})
}

func (s *server) listRules(w http.ResponseWriter, r *http.Request) {
	owner := r.URL.Query().Get("owner")
	writeJSON(w, http.StatusOK, s.rules.listByOwner(owner))
}

// createRule = GuardianRuleInput -> ECIES encrypt -> GUARDIAN/REGISTER -> store.
func (s *server) createRule(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Owner        string `json:"owner"`
		TriggerCRBps int64  `json:"triggerCrBps"`
		MaxRepay18   string `json:"maxRepay18"`
		Funder       string `json:"funder"`
		Branch       string `json:"branch"`
		VaultManager string `json:"vaultManager"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body: "+err.Error())
		return
	}
	if !common.IsHexAddress(in.Owner) {
		writeErr(w, http.StatusBadRequest, "owner must be a 0x address")
		return
	}
	if in.TriggerCRBps <= 0 {
		writeErr(w, http.StatusBadRequest, "triggerCrBps must be > 0")
		return
	}
	maxRepay, ok := new(big.Int).SetString(strings.TrimSpace(in.MaxRepay18), 10)
	if !ok || maxRepay.Sign() <= 0 {
		writeErr(w, http.StatusBadRequest, "maxRepay18 must be a positive integer string (18-dec)")
		return
	}
	branch := strings.ToUpper(strings.TrimSpace(in.Branch))
	if branch == "" {
		branch = config.BranchKeyFXRP
	}

	// Encrypt the private terms to the TEE key, then REGISTER through the keeper.
	ciphertext, err := encryptRule(&s.teePriv.PublicKey, in.Owner, big.NewInt(in.TriggerCRBps), maxRepay)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ecies encrypt: "+err.Error())
		return
	}
	data, err := s.runInstruction(config.OPTypeGuardian, config.OPCommandRegister,
		map[string]any{"ciphertext": ciphertext, "branch": branch})
	if err != nil {
		writeErr(w, http.StatusBadGateway, "register: "+err.Error())
		return
	}
	var reg vtypes.GuardianRegisterResult
	if err := json.Unmarshal(data, &reg); err != nil || !reg.Stored {
		writeErr(w, http.StatusBadGateway, "register did not store the rule")
		return
	}

	meta := &ruleMeta{
		ID:              randomHex(16),
		Owner:           strings.ToLower(in.Owner),
		TriggerCRBps:    in.TriggerCRBps,
		MaxRepay18:      maxRepay.String(),
		Funder:          in.Funder,
		Branch:          branch,
		VaultManager:    in.VaultManager,
		Enabled:         true,
		CreatedAt:       time.Now().Unix(),
		TermsCommitment: reg.TermsCommitment,
	}
	s.rules.add(meta)
	log.Printf("registered rule id=%s owner=%s branch=%s trigger=%dbps commitment=%s",
		meta.ID, meta.Owner, meta.Branch, meta.TriggerCRBps, meta.TermsCommitment)
	writeJSON(w, http.StatusOK, meta)
}

func (s *server) patchRule(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	rule, ok := s.rules.get(id)
	if !ok {
		writeErr(w, http.StatusNotFound, "no rule with id "+id)
		return
	}
	var body struct {
		Enabled *bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body: "+err.Error())
		return
	}
	if body.Enabled != nil {
		s.rules.mu.Lock()
		rule.Enabled = *body.Enabled
		s.rules.mu.Unlock()
	}
	writeJSON(w, http.StatusOK, rule)
}

// evaluateRule runs a one-off (dry-run) evaluation and returns the decision.
func (s *server) evaluateRule(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	rule, ok := s.rules.get(id)
	if !ok {
		writeErr(w, http.StatusNotFound, "no rule with id "+id)
		return
	}
	res, err := s.evaluate(rule, true)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "evaluate: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// ---- evaluation ------------------------------------------------------------

func (s *server) evaluate(rule *ruleMeta, dryRun bool) (*vtypes.GuardianEvaluateResult, error) {
	data, err := s.runInstruction(config.OPTypeGuardian, config.OPCommandEvaluate,
		map[string]any{"termsCommitment": rule.TermsCommitment, "dryRun": dryRun})
	if err != nil {
		return nil, err
	}
	var res vtypes.GuardianEvaluateResult
	if err := json.Unmarshal(data, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

func (s *server) evalLoop(interval time.Duration) {
	tick := time.NewTicker(interval)
	defer tick.Stop()
	for range tick.C {
		for _, rule := range s.rules.enabledRules() {
			// dryRun unless a funded keeper wallet is configured (CanExecuteOnChain).
			dry := s.cfg.CanExecuteOnChain() != nil
			res, err := s.evaluate(rule, dry)
			if err != nil {
				log.Printf("eval rule=%s owner=%s: error: %v", rule.ID, rule.Owner, err)
				continue
			}
			if res.ShouldRepay {
				log.Printf("eval rule=%s owner=%s branch=%s -> SHOULD REPAY %s (repaid=%v tx=%s) %s",
					rule.ID, rule.Owner, res.Branch, res.RepayAmount18, res.Repaid, res.TxHash, res.Error)
			} else {
				log.Printf("eval rule=%s owner=%s branch=%s -> healthy (no repay)", rule.ID, rule.Owner, res.Branch)
			}
		}
	}
}

// ---- keeper wire helpers (mirror tools/cmd/e2e-live) -----------------------

// runInstruction wraps a payload in the framework wire format and invokes the
// keeper IN-PROCESS (ProcessAction), returning the ActionResult data or an error.
func (s *server) runInstruction(opType, opCommand string, payload any) (json.RawMessage, error) {
	original, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	df := instruction.DataFixed{
		InstructionID:   randomHash(),
		TeeID:           s.teeID,
		Timestamp:       uint64(time.Now().Unix()),
		OPType:          teeutils.ToHash(opType),
		OPCommand:       teeutils.ToHash(opCommand),
		OriginalMessage: original,
	}
	message, err := json.Marshal(df)
	if err != nil {
		return nil, err
	}
	action := teetypes.Action{Data: teetypes.ActionData{
		ID:            randomHash(),
		Type:          teetypes.Instruction,
		SubmissionTag: teetypes.Threshold,
		Message:       message,
	}}
	status, body := s.ext.ProcessAction(action)
	if status != http.StatusOK {
		return nil, fmt.Errorf("keeper returned %d: %s", status, string(body))
	}
	var ar teetypes.ActionResult
	if err := json.Unmarshal(body, &ar); err != nil {
		return nil, err
	}
	if ar.Status != 1 {
		return nil, fmt.Errorf("action failed: %s", ar.Log)
	}
	return json.RawMessage(ar.Data), nil
}

// encryptRule ABI-encodes (owner, triggerCRBps, maxRepay18) and ECIES-encrypts
// it to the TEE public key via teeutils.Encrypt — identical to e2e-live.
func encryptRule(pub *ecdsa.PublicKey, ownerHex string, trigger, maxRepay *big.Int) (string, error) {
	addrT, _ := abi.NewType("address", "", nil)
	uintT, _ := abi.NewType("uint256", "", nil)
	args := abi.Arguments{{Type: addrT}, {Type: uintT}, {Type: uintT}}
	plaintext, err := args.Pack(common.HexToAddress(ownerHex), trigger, maxRepay)
	if err != nil {
		return "", fmt.Errorf("abi pack: %w", err)
	}
	ct, err := teeutils.Encrypt(plaintext, pub)
	if err != nil {
		return "", fmt.Errorf("ecies encrypt: %w", err)
	}
	return "0x" + common.Bytes2Hex(ct), nil
}

// startSignServer serves the tee-node /decrypt (and /sign) API on the sign port,
// backed by the enclave key — the same endpoints the extension calls internally.
func startSignServer(priv *ecdsa.PrivateKey, port string) {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /decrypt", func(w http.ResponseWriter, r *http.Request) {
		var req teetypes.DecryptRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.EncryptedMessage) == 0 {
			http.Error(w, "message is required", http.StatusBadRequest)
			return
		}
		plaintext, err := teeutils.Decrypt(req.EncryptedMessage, priv)
		if err != nil {
			http.Error(w, "can not decrypt", http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(teetypes.DecryptResponse{DecryptedMessage: plaintext})
	})
	mux.HandleFunc("POST /sign", func(w http.ResponseWriter, r *http.Request) {
		var req teetypes.SignRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Message) == 0 {
			http.Error(w, "message is required", http.StatusBadRequest)
			return
		}
		sig, err := crypto.Sign(req.Message, priv)
		if err != nil {
			http.Error(w, "can not sign", http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(teetypes.SignResponse{Signature: sig})
	})
	// Bind loopback ONLY: the /decrypt + /sign endpoints wield the enclave key and
	// must never be reachable outside this process. The keeper calls them at
	// 127.0.0.1:SIGN_PORT, so loopback is sufficient and can't be exposed by a
	// stray public domain on this port.
	go func() {
		if err := http.ListenAndServe("127.0.0.1:"+port, mux); err != nil {
			log.Fatalf("sign server: %v", err)
		}
	}()
	// Wait for /decrypt to answer (expects 400 on empty body) before returning.
	for i := 0; i < 50; i++ {
		resp, err := http.Post("http://127.0.0.1:"+port+"/decrypt", "application/json", strings.NewReader("{}"))
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusBadRequest {
				return
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	log.Fatalf("sign server on :%s did not come up", port)
}

// ---- CORS + small utils ----------------------------------------------------

func allowedOrigins() map[string]bool {
	out := map[string]bool{}
	raw := os.Getenv("FRONTEND_ORIGIN")
	if raw == "" {
		raw = "http://localhost:3000"
	}
	for _, o := range strings.Split(raw, ",") {
		if o = strings.TrimSpace(o); o != "" {
			out[o] = true
		}
	}
	return out
}

func (s *server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && s.origins[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "content-type")
		}
		next.ServeHTTP(w, r)
	})
}

func (s *server) preflight(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) }

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func intEnv(key string, dflt int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return dflt
}

func randomHash() common.Hash {
	var h common.Hash
	_, _ = rand.Read(h[:])
	return h
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return "0x" + common.Bytes2Hex(b)
}
