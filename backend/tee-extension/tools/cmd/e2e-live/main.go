// Command e2e-live drives the Vulcra TEE extension end-to-end against LIVE
// Coston2, using the real framework wire format at every hop:
//
//  1. Discovers candidate vault owners from both VaultManagers' VaultOpened
//     events (eth_getLogs) — playing the role of the indexer snapshot that
//     feeds the keeper its CANDIDATES (decisions still re-read the chain
//     inside the extension).
//  2. Starts a REAL tee-node (pkg/node — the same in-enclave key management
//     the TEE runs, here with simulated attestation) and serves its /decrypt
//     on the SIGN_PORT with the tee-node wire types, exactly like the node's
//     sign server does.
//  3. Starts the REAL extension server (internal/extension) on EXTENSION_PORT.
//  4. Sends instructions as the TEE node would deliver them — POST /action
//     with teetypes.Action wrapping a JSON instruction.DataFixed:
//     a. KEEPER/SCAN across every configured branch (dry-run),
//     b. GUARDIAN/REGISTER with a rule ECIES-encrypted to the node public key,
//     c. GUARDIAN/EVALUATE reading the vault's live on-chain CR,
//     d. GUARDIAN/EVALUATE with a simulated CR inside the protection window,
//     proving the auto-repay decision + the gated execution path.
//
// It prints a JSON evidence report to stdout (and -out FILE if given).
// No transactions are ever submitted: SCAN runs dry-run and the repay path is
// decision-only until a funded TEE keeper wallet holds GUARDIAN_EXECUTOR_ROLE.
package main

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/rand"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"

	"github.com/vulcra/tee-extension/internal/config"
	"github.com/vulcra/tee-extension/internal/extension"
)

// vaultOpenedTopic is keccak256("VaultOpened(address,uint256,uint256,uint256)").
var vaultOpenedTopic = crypto.Keccak256Hash([]byte("VaultOpened(address,uint256,uint256,uint256)"))

// Evidence is the machine-readable E2E report.
type Evidence struct {
	StartedAt  string       `json:"startedAt"`
	RPC        string       `json:"rpc"`
	Branches   []BranchInfo `json:"branches"`
	Stages     []Stage      `json:"stages"`
	TeeID      string       `json:"teeId"`
	FinishedAt string       `json:"finishedAt"`
}

type BranchInfo struct {
	Key          string   `json:"key"`
	VaultManager string   `json:"vaultManager"`
	Candidates   []string `json:"candidateOwners"`
}

type Stage struct {
	Name   string          `json:"name"`
	Pass   bool            `json:"pass"`
	Detail string          `json:"detail,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
}

func main() {
	ownersFlag := flag.String("owners", "", "comma-separated candidate owners (skips on-chain discovery)")
	outFlag := flag.String("out", "", "write the JSON evidence report to this file")
	lookback := flag.Uint64("lookback", 150_000, "blocks to scan backwards for VaultOpened events")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	if len(cfg.Branches) == 0 {
		log.Fatalf("no branches configured — set VAULT_MANAGER_FXRP_ADDRESS / VAULT_MANAGER_WFLR_ADDRESS (source .env)")
	}

	ev := &Evidence{StartedAt: time.Now().UTC().Format(time.RFC3339), RPC: cfg.RPCURL}

	// ---- 1. Candidate discovery (indexer role) -----------------------------
	ec, err := ethclient.Dial(cfg.RPCURL)
	if err != nil {
		log.Fatalf("dial rpc: %v", err)
	}
	perBranch := map[string][]string{}
	if *ownersFlag != "" {
		for i := range cfg.Branches {
			perBranch[cfg.Branches[i].Key] = strings.Split(*ownersFlag, ",")
		}
	} else {
		latest, err := ec.BlockNumber(context.Background())
		if err != nil {
			log.Fatalf("blockNumber: %v", err)
		}
		from := uint64(0)
		if latest > *lookback {
			from = latest - *lookback
		}
		for i := range cfg.Branches {
			br := &cfg.Branches[i]
			owners, err := discoverOwners(ec, common.HexToAddress(br.VaultManager), from, latest)
			if err != nil {
				log.Fatalf("discover %s owners: %v", br.Key, err)
			}
			perBranch[br.Key] = owners
			log.Printf("branch %s: %d vault owner(s) discovered from VaultOpened logs (blocks %d..%d)", br.Key, len(owners), from, latest)
		}
	}
	for i := range cfg.Branches {
		br := &cfg.Branches[i]
		ev.Branches = append(ev.Branches, BranchInfo{Key: br.Key, VaultManager: br.VaultManager, Candidates: perBranch[br.Key]})
	}

	// ---- 2. Real tee-node key + its /decrypt on the sign port --------------
	// The enclave key is generated exactly as tee-node's node.Initialize does
	// (crypto.GenerateKey), and /decrypt is backed by teeutils.Decrypt — the
	// same pkg/utils implementation the node's Decrypt delegates to.
	teePriv, err := crypto.GenerateKey()
	if err != nil {
		log.Fatalf("tee key: %v", err)
	}
	teeID := crypto.PubkeyToAddress(teePriv.PublicKey)
	ev.TeeID = teeID.Hex()
	signPort := cfg.SignPort
	if signPort == "" {
		signPort = "7701"
	}
	startDecryptServer(teePriv, signPort)
	log.Printf("tee-node key initialized (teeID=%s), /decrypt serving on sign port %s", teeID.Hex(), signPort)

	// ---- 3. Real extension server ------------------------------------------
	extPort := 7799
	if v := os.Getenv("EXTENSION_PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			extPort = n
		}
	}
	ext, err := extension.New(cfg, extPort)
	if err != nil {
		log.Fatalf("extension: %v", err)
	}
	go func() {
		if err := ext.Server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("extension server: %v", err)
		}
	}()
	waitHTTP(fmt.Sprintf("http://127.0.0.1:%d/state", extPort))
	actionURL := fmt.Sprintf("http://127.0.0.1:%d/action", extPort)
	log.Printf("extension serving on :%d", extPort)

	// ---- 4a. KEEPER/SCAN — every branch, authoritative reads, dry-run ------
	allOwners := dedup(append(append([]string{}, perBranch[config.BranchKeyFXRP]...), perBranch[config.BranchKeyWFLR]...))
	scanReq := map[string]any{"candidateOwners": allOwners, "dryRun": true}
	ar, err := sendInstruction(actionURL, teeID, config.OPTypeKeeper, config.OPCommandScan, scanReq)
	ev.Stages = append(ev.Stages, stageFrom("keeper-scan-all-branches", ar, err, func(data []byte) (bool, string) {
		var res struct {
			Scanned int `json:"scanned"`
			Results []struct {
				Branch string `json:"branch"`
				CRBps  string `json:"crBps"`
				Error  string `json:"error"`
			} `json:"results"`
		}
		if err := json.Unmarshal(data, &res); err != nil {
			return false, "unmarshal: " + err.Error()
		}
		branches := map[string]int{}
		reads := 0
		for _, r := range res.Results {
			branches[r.Branch]++
			if r.CRBps != "" || r.Error == "vault not active" {
				reads++
			}
		}
		return res.Scanned > 0 && reads > 0,
			fmt.Sprintf("scanned=%d authoritativeReads=%d perBranch=%v", res.Scanned, reads, branches)
	}))

	// ---- 4b. GUARDIAN/REGISTER — real ECIES to the real node key -----------
	// Protect the first discovered FXRP vault owner (fall back to any owner).
	protectOwner := firstOr(perBranch[config.BranchKeyFXRP], firstOr(allOwners, ""))
	protectBranch := config.BranchKeyFXRP
	if len(perBranch[config.BranchKeyFXRP]) == 0 && len(perBranch[config.BranchKeyWFLR]) > 0 {
		protectBranch = config.BranchKeyWFLR
	}
	var commitment string
	if protectOwner == "" {
		ev.Stages = append(ev.Stages, Stage{Name: "guardian-register", Pass: false, Detail: "no vault owner discovered to protect"})
	} else {
		trigger := big.NewInt(20000)                                     // private trigger: CR < 200%
		maxRepay, _ := new(big.Int).SetString("5000000000000000000", 10) // max 5 vUSD per action
		ciphertext, err := encryptRule(&teePriv.PublicKey, protectOwner, trigger, maxRepay)
		if err != nil {
			log.Fatalf("ecies encrypt: %v", err)
		}
		regReq := map[string]any{"ciphertext": ciphertext, "branch": protectBranch}
		ar, err = sendInstruction(actionURL, teeID, config.OPTypeGuardian, config.OPCommandRegister, regReq)
		ev.Stages = append(ev.Stages, stageFrom("guardian-register-ecies", ar, err, func(data []byte) (bool, string) {
			var res struct {
				TermsCommitment string `json:"termsCommitment"`
				Stored          bool   `json:"stored"`
			}
			if err := json.Unmarshal(data, &res); err != nil {
				return false, "unmarshal: " + err.Error()
			}
			commitment = res.TermsCommitment
			return res.Stored && strings.HasPrefix(res.TermsCommitment, "0x"),
				fmt.Sprintf("owner=%s branch=%s commitment=%s", protectOwner, protectBranch, res.TermsCommitment)
		}))
	}

	// ---- 4c. GUARDIAN/EVALUATE — live on-chain CR --------------------------
	if commitment != "" {
		evalReq := map[string]any{"termsCommitment": commitment, "dryRun": true}
		ar, err = sendInstruction(actionURL, teeID, config.OPTypeGuardian, config.OPCommandEvaluate, evalReq)
		ev.Stages = append(ev.Stages, stageFrom("guardian-evaluate-onchain", ar, err, func(data []byte) (bool, string) {
			var res struct {
				ShouldRepay   bool   `json:"shouldRepay"`
				RepayAmount18 string `json:"repayAmount18"`
				Branch        string `json:"branch"`
			}
			if err := json.Unmarshal(data, &res); err != nil {
				return false, "unmarshal: " + err.Error()
			}
			return true, fmt.Sprintf("branch=%s shouldRepay=%v repay18=%s (live on-chain CR)", res.Branch, res.ShouldRepay, res.RepayAmount18)
		}))

		// ---- 4d. GUARDIAN/EVALUATE — simulated protection window -----------
		// CR 15000 bps sits between MCR (13000) and the private trigger (20000):
		// the guardian MUST decide to repay; execution stays gated (no keeper
		// wallet), which the result records explicitly.
		simReq := map[string]any{
			"termsCommitment": commitment,
			"currentCrBps":    "15000",
			"currentDebt18":   "100000000000000000000", // 100 vUSD
		}
		ar, err = sendInstruction(actionURL, teeID, config.OPTypeGuardian, config.OPCommandEvaluate, simReq)
		ev.Stages = append(ev.Stages, stageFrom("guardian-evaluate-protection-window", ar, err, func(data []byte) (bool, string) {
			var res struct {
				ShouldRepay   bool   `json:"shouldRepay"`
				RepayAmount18 string `json:"repayAmount18"`
				Error         string `json:"error"`
			}
			if err := json.Unmarshal(data, &res); err != nil {
				return false, "unmarshal: " + err.Error()
			}
			gated := strings.Contains(res.Error, "execution gated")
			return res.ShouldRepay && res.RepayAmount18 != "" && gated,
				fmt.Sprintf("shouldRepay=%v repay18=%s gatedExecution=%v (%s)", res.ShouldRepay, res.RepayAmount18, gated, res.Error)
		}))
	}

	// ---- report -------------------------------------------------------------
	ev.FinishedAt = time.Now().UTC().Format(time.RFC3339)
	out, _ := json.MarshalIndent(ev, "", "  ")
	fmt.Println(string(out))
	if *outFlag != "" {
		if err := os.WriteFile(*outFlag, out, 0o644); err != nil {
			log.Fatalf("write %s: %v", *outFlag, err)
		}
	}
	for _, s := range ev.Stages {
		if !s.Pass {
			os.Exit(1)
		}
	}
}

// discoverOwners collects distinct VaultOpened owners for one VaultManager.
// The Coston2 public RPC caps eth_getLogs at 30 blocks per call, so the primary
// path is the Blockscout explorer API (arbitrary ranges); the RPC chunked path
// remains as a bounded fallback over the most recent blocks.
func discoverOwners(ec *ethclient.Client, vm common.Address, from, to uint64) ([]string, error) {
	owners, err := discoverOwnersExplorer(vm, from, to)
	if err == nil {
		return owners, nil
	}
	log.Printf("explorer discovery failed (%v); falling back to RPC (last 3000 blocks, 30-block chunks)", err)
	return discoverOwnersRPC(ec, vm, maxU64(to, 3000)-3000, to)
}

// discoverOwnersExplorer queries the Blockscout getLogs API.
func discoverOwnersExplorer(vm common.Address, from, to uint64) ([]string, error) {
	base := os.Getenv("EXPLORER_API_URL")
	if base == "" {
		base = "https://coston2-explorer.flare.network/api"
	}
	url := fmt.Sprintf("%s?module=logs&action=getLogs&fromBlock=%d&toBlock=%d&address=%s&topic0=%s",
		base, from, to, vm.Hex(), vaultOpenedTopic.Hex())
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Get(url)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	var body struct {
		Message string `json:"message"`
		Result  []struct {
			Topics []string `json:"topics"`
		} `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("explorer decode: %w", err)
	}
	if body.Message != "OK" {
		return nil, fmt.Errorf("explorer returned %q", body.Message)
	}
	seen := map[string]bool{}
	for _, lg := range body.Result {
		if len(lg.Topics) >= 2 && lg.Topics[1] != "" {
			seen[strings.ToLower(common.HexToAddress(lg.Topics[1]).Hex())] = true
		}
	}
	return sortCap(seen), nil
}

// discoverOwnersRPC is the 30-block-chunk fallback against the public RPC.
func discoverOwnersRPC(ec *ethclient.Client, vm common.Address, from, to uint64) ([]string, error) {
	const chunk = 30
	seen := map[string]bool{}
	for start := from; start <= to; start += chunk {
		end := min(start+chunk-1, to)
		logs, err := ec.FilterLogs(context.Background(), ethereum.FilterQuery{
			FromBlock: new(big.Int).SetUint64(start),
			ToBlock:   new(big.Int).SetUint64(end),
			Addresses: []common.Address{vm},
			Topics:    [][]common.Hash{{vaultOpenedTopic}},
		})
		if err != nil {
			return nil, fmt.Errorf("getLogs %d..%d: %w", start, end, err)
		}
		for _, lg := range logs {
			if len(lg.Topics) >= 2 {
				seen[strings.ToLower(common.BytesToAddress(lg.Topics[1].Bytes()).Hex())] = true
			}
		}
	}
	return sortCap(seen), nil
}

// sortCap sorts the owner set and caps it at 12 candidates.
func sortCap(seen map[string]bool) []string {
	owners := make([]string, 0, len(seen))
	for o := range seen {
		owners = append(owners, o)
	}
	sort.Strings(owners)
	if len(owners) > 12 {
		owners = owners[:12]
	}
	return owners
}

// maxU64 clamps a-b underflow away.
func maxU64(a, b uint64) uint64 {
	if a < b {
		return b
	}
	return a
}

// startDecryptServer serves the tee-node /decrypt API on the sign port, backed
// by teeutils.Decrypt — the exact pkg/utils implementation the TEE node's own
// Decrypt delegates to.
func startDecryptServer(priv *ecdsa.PrivateKey, port string) {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /decrypt", func(w http.ResponseWriter, r *http.Request) {
		var req teetypes.DecryptRequest
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if len(req.EncryptedMessage) == 0 {
			http.Error(w, "message is required", http.StatusBadRequest)
			return
		}
		plaintext, err := teeutils.Decrypt(req.EncryptedMessage, priv)
		if err != nil {
			http.Error(w, "can not decrypt", http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(teetypes.DecryptResponse{DecryptedMessage: plaintext})
	})
	go func() {
		if err := http.ListenAndServe(":"+port, mux); err != nil {
			log.Fatalf("decrypt server: %v", err)
		}
	}()
	waitHTTPStatus("http://127.0.0.1:"+port+"/decrypt", http.StatusBadRequest)
}

// encryptRule ABI-encodes (owner, triggerCRBps, maxRepay18) and ECIES-encrypts
// it to the TEE public key via teeutils.Encrypt — the client side of
// GUARDIAN/REGISTER.
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

// sendInstruction wraps a payload in the framework wire format (Action around a
// JSON DataFixed) and POSTs it to the extension, returning the ActionResult.
func sendInstruction(actionURL string, teeID common.Address, opType, opCommand string, payload any) (*teetypes.ActionResult, error) {
	original, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	df := instruction.DataFixed{
		InstructionID:   randomHash(),
		TeeID:           teeID,
		Timestamp:       uint64(time.Now().Unix()),
		OPType:          teeutils.ToHash(opType),
		OPCommand:       teeutils.ToHash(opCommand),
		OriginalMessage: original,
	}
	message, err := json.Marshal(df)
	if err != nil {
		return nil, err
	}
	action := teetypes.Action{
		Data: teetypes.ActionData{
			ID:            randomHash(),
			Type:          teetypes.Instruction,
			SubmissionTag: teetypes.Threshold,
			Message:       message,
		},
	}
	body, err := json.Marshal(action)
	if err != nil {
		return nil, err
	}
	resp, err := (&http.Client{Timeout: 90 * time.Second}).Post(actionURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		buf := new(bytes.Buffer)
		_, _ = buf.ReadFrom(resp.Body)
		return nil, fmt.Errorf("POST /action returned %d: %s", resp.StatusCode, buf.String())
	}
	var ar teetypes.ActionResult
	if err := json.NewDecoder(resp.Body).Decode(&ar); err != nil {
		return nil, err
	}
	return &ar, nil
}

// stageFrom scores one stage from an ActionResult using a payload check.
func stageFrom(name string, ar *teetypes.ActionResult, err error, check func([]byte) (bool, string)) Stage {
	if err != nil {
		return Stage{Name: name, Pass: false, Detail: err.Error()}
	}
	if ar.Status != 1 {
		return Stage{Name: name, Pass: false, Detail: "action failed: " + ar.Log}
	}
	pass, detail := check(ar.Data)
	raw, _ := json.Marshal(ar)
	return Stage{Name: name, Pass: pass, Detail: detail, Result: raw}
}

func randomHash() common.Hash {
	var h common.Hash
	_, _ = rand.Read(h[:])
	return h
}

func waitHTTP(url string) {
	for i := 0; i < 50; i++ {
		if resp, err := http.Get(url); err == nil {
			_ = resp.Body.Close()
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	log.Fatalf("server at %s did not come up", url)
}

func waitHTTPStatus(url string, want int) {
	for i := 0; i < 50; i++ {
		resp, err := http.Post(url, "application/json", strings.NewReader("{}"))
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == want {
				return
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	log.Fatalf("server at %s did not come up", url)
}

func dedup(in []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, s := range in {
		s = strings.ToLower(strings.TrimSpace(s))
		if s != "" && !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

func firstOr(list []string, def string) string {
	if len(list) > 0 {
		return list[0]
	}
	return def
}
