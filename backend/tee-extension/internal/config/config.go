// Package config holds the OPType/OPCommand identifiers and environment wiring
// for the Vulcra TEE extension.
//
// It is standard-library only so it builds and (optionally) tests offline. The
// OP identifiers here MUST match the Solidity bytes32 constants in
// contracts/VulcraInstructionSender.sol and the router in
// internal/extension/extension.go exactly (three-layer contract). bytes32 holds
// at most 31 bytes, so all identifiers are kept short.
package config

import (
	"errors"
	"math/big"
	"os"
	"strings"
)

// Version is embedded in results and attestation evidence. Bump on any change
// that alters extension behavior (it participates in the code-hash story).
const Version = "vulcra-tee-extension/0.1.0"

// OP identifiers — must match Solidity bytes32("...") and the Go router.
//
//	Layer          KEEPER/SCAN                 GUARDIAN/REGISTER, GUARDIAN/EVALUATE
//	Solidity       bytes32("KEEPER")/("SCAN")  bytes32("GUARDIAN")/("REGISTER"|"EVALUATE")
//	Go config      OPTypeKeeper/OPCommandScan  OPTypeGuardian/OPCommandRegister|OPCommandEvaluate
//	Go router      teeutils.ToHash(OPTypeKeeper) == df.OPType   (etc.)
const (
	OPTypeKeeper  = "KEEPER"
	OPCommandScan = "SCAN"

	OPTypeGuardian    = "GUARDIAN"
	OPCommandRegister = "REGISTER"
	OPCommandEvaluate = "EVALUATE"
)

// Environment variable names. NOTHING except the Flare Contract Registry address
// is hardcoded; every other Flare address is resolved at runtime from the
// registry or from these env vars after deploy.
const (
	// Core chain / contract wiring.
	EnvCoston2RPCURL         = "COSTON2_RPC_URL"
	EnvFlareContractRegistry = "FLARE_CONTRACT_REGISTRY" // optional override
	EnvVaultManagerAddress   = "VAULT_MANAGER_ADDRESS"   // LEGACY single-branch (FXRP)
	EnvPriceOracleAddress    = "PRICE_ORACLE_ADDRESS"    // resolved after deploy
	EnvFTSOFeedID            = "XRP_USD_FEED_ID"         // LEGACY single-branch feed id
	EnvMCRBps                = "MCR_BPS"                 // default 13000
	EnvChainID               = "CHAIN_ID"                // default 114 (Coston2)

	// Per-branch wiring templates. For each known branch KEY (FXRP, WFLR) the
	// concrete env var names are <prefix>KEY<suffix>, e.g. VAULT_MANAGER_FXRP_ADDRESS,
	// VAULT_MANAGER_WFLR_ADDRESS, FEED_ID_WFLR, MCR_BPS_WFLR. See branchVaultManagerEnv
	// and friends. A branch is only loaded when its VaultManager env is set.
	EnvBranchVaultManagerPrefix = "VAULT_MANAGER_"
	EnvBranchVaultManagerSuffix = "_ADDRESS"
	EnvBranchFeedIDPrefix       = "FEED_ID_"
	EnvBranchMCRBpsPrefix       = "MCR_BPS_"

	// TEE / attestation mode.
	EnvSimulatedTEE = "SIMULATED_TEE" // "true" in dev (simulated attestation)
	EnvMode         = "MODE"          // 0 = production attestation, 1 = simulated
	EnvLocalMode    = "LOCAL_MODE"    // "false" against real Coston2

	// Keeper wallet: the TEE-managed key that signs liquidate()/delegatedRepay().
	// It is NEVER a plaintext value in env — it lives inside the enclave and is
	// used via the TEE sign port. These env vars only carry the PORT / ADDRESS.
	EnvSignPort         = "SIGN_PORT"          // TEE sign port (e.g. 7701)
	EnvKeeperTEEAddress = "KEEPER_TEE_ADDRESS" // public address holding GUARDIAN_EXECUTOR_ROLE

	// FCC indexer DB — consumed by the ext-proxy, not by this Go process. Names
	// declared here so tooling can validate the environment. Real values come
	// from the out-of-repo vulcra-fcc.env (gitignored); see .env.example.
	EnvIndexerDBHost = "FCC_INDEXER_DB_HOST"
	EnvIndexerDBPort = "FCC_INDEXER_DB_PORT"
	EnvIndexerDBName = "FCC_INDEXER_DB_NAME"
	EnvIndexerDBUser = "FCC_INDEXER_DB_USER"
	EnvIndexerDBPass = "FCC_INDEXER_DB_PASSWORD"
	EnvTEEProxyURL   = "FCC_TEE_PROXY_URL"
)

// FlareContractRegistryCoston2 is the ONLY hardcoded Flare address. Every other
// system contract (VaultManager, PriceOracle, FTSO) is resolved via this
// registry or via the env vars above after deployment.
const FlareContractRegistryCoston2 = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019"

// DefaultMCRBps is the protocol Minimum Collateralization Ratio (130%).
const DefaultMCRBps int64 = 13000

// Branch keys — the collateral branches Vulcra supports. Each has its own
// VaultManager instance (same external ABI) and its own FTSO feed.
const (
	BranchKeyFXRP = "FXRP"
	BranchKeyWFLR = "WFLR"
)

// Protocol-constant FTSO feed ids (bytes21 hex) for each branch. These are
// fixed protocol constants; the live code still reads the feed's DECIMALS
// dynamically from the FTSO, but the feed id itself is well-known and may be
// overridden per branch via FEED_ID_<KEY>.
const (
	// XRPUSDFeedID is the XRP/USD FTSO feed used by the FXRP branch (feed 6-dec).
	XRPUSDFeedID = "0x015852502f55534400000000000000000000000000"
	// FLRUSDFeedID is the FLR/USD FTSO feed used by the wFLR branch (feed 8-dec).
	FLRUSDFeedID = "0x01464c522f55534400000000000000000000000000"
)

// Per-branch collateral / feed decimals. Collateral decimals feed the keeper CR
// math (keeper.CollateralScale); feed decimals are a HINT — the live code reads
// the FTSO feed decimals dynamically, but the expected value is stored so the
// wiring can sanity-check it.
const (
	FXRPCollateralDecimals = 6  // FXRP collateral token decimals
	WFLRCollateralDecimals = 18 // WNat / wFLR collateral token decimals
	XRPUSDFeedDecimals     = 6  // XRP/USD FTSO feed decimals (hint)
	FLRUSDFeedDecimals     = 8  // FLR/USD FTSO feed decimals (hint)
)

// Branch is one collateral branch of the multi-collateral protocol. The smart
// contract stays collateral-agnostic with the SAME external ABI; a "branch" is
// simply one VaultManager instance plus the protocol constants that describe
// its collateral token and price feed.
//
//   - Key                : "FXRP" / "WFLR".
//   - VaultManager       : this branch's VaultManager address (from env).
//   - CollateralDecimals : collateral token decimals (6 FXRP, 18 wFLR); drives
//     the keeper CR math via keeper.CollateralScale.
//   - FeedID             : FTSO feed id (bytes21 hex) for this branch's price.
//   - FeedDecimals       : expected feed decimals HINT (live code reads them
//     dynamically); 6 for XRP/USD, 8 for FLR/USD.
//   - HasXrplMint        : true for FXRP (has the XRPL mint / 0xFE path), false
//     for wFLR (EVM-only). The TEE keeper/guardian run for BOTH branches.
//   - MCRBps             : per-branch Minimum Collateralization Ratio (bps).
type Branch struct {
	Key                string
	VaultManager       string
	CollateralDecimals int
	FeedID             string
	FeedDecimals       int
	HasXrplMint        bool
	MCRBps             *big.Int
}

// knownBranches enumerates the supported branches with their PROTOCOL-CONSTANT
// defaults. VaultManager addresses and any per-branch overrides (feed id, MCR)
// come from the environment in Load(); a branch is only included when its
// VaultManager env var is set.
var knownBranches = []Branch{
	{
		Key:                BranchKeyFXRP,
		CollateralDecimals: FXRPCollateralDecimals,
		FeedID:             XRPUSDFeedID,
		FeedDecimals:       XRPUSDFeedDecimals,
		HasXrplMint:        true,
	},
	{
		Key:                BranchKeyWFLR,
		CollateralDecimals: WFLRCollateralDecimals,
		FeedID:             FLRUSDFeedID,
		FeedDecimals:       FLRUSDFeedDecimals,
		HasXrplMint:        false,
	},
}

// DefaultCoston2RPCURL is the public Coston2 C-chain RPC.
const DefaultCoston2RPCURL = "https://coston2-api.flare.network/ext/C/rpc"

// DefaultChainID is the Coston2 chain id.
const DefaultChainID int64 = 114

// Config is the resolved runtime configuration for the extension process.
//
// LIVE-EXECUTION GATE: SimulatedTEE and a funded keeper key gate whether the
// extension actually submits on-chain transactions. Live liquidation and
// delegatedRepay require a funded TEE keeper wallet that holds
// GUARDIAN_EXECUTOR_ROLE on VaultManager. This is deliberately GATED behind the
// environment and is NEVER mocked — with no funded key the extension computes
// decisions but cannot execute them.
type Config struct {
	RPCURL           string
	FlareContractReg string

	// Branches is the multi-collateral branch list (FXRP, wFLR, ...), preferred
	// over the legacy single-branch fields below. Each entry has its own
	// VaultManager, collateral decimals, feed id and MCR. Loaded from
	// VAULT_MANAGER_<KEY>_ADDRESS (+ optional FEED_ID_<KEY> / MCR_BPS_<KEY>).
	Branches []Branch

	// Legacy single-branch fields, kept for backward compat. When no per-branch
	// env is set but VAULT_MANAGER_ADDRESS is, Load synthesizes a single FXRP
	// branch from these so existing single-branch deploys keep working.
	VaultManagerAddress string
	PriceOracleAddress  string
	FTSOFeedID          string
	MCRBps              *big.Int

	ChainID          int64
	SimulatedTEE     bool
	SignPort         string
	KeeperTEEAddress string
	TEEProxyURL      string
}

// Load reads configuration from the environment, applying documented defaults.
// It does NOT read any secret value (no private keys, no DB password) — those
// belong to the ext-proxy / enclave, not this struct.
func Load() (*Config, error) {
	c := &Config{
		RPCURL:              getenvDefault(EnvCoston2RPCURL, DefaultCoston2RPCURL),
		FlareContractReg:    getenvDefault(EnvFlareContractRegistry, FlareContractRegistryCoston2),
		VaultManagerAddress: os.Getenv(EnvVaultManagerAddress),
		PriceOracleAddress:  os.Getenv(EnvPriceOracleAddress),
		FTSOFeedID:          os.Getenv(EnvFTSOFeedID),
		MCRBps:              MCRBps(),
		ChainID:             DefaultChainID,
		SimulatedTEE:        strings.EqualFold(os.Getenv(EnvSimulatedTEE), "true"),
		SignPort:            os.Getenv(EnvSignPort),
		KeeperTEEAddress:    os.Getenv(EnvKeeperTEEAddress),
		TEEProxyURL:         os.Getenv(EnvTEEProxyURL),
	}
	c.Branches = loadBranches(c.MCRBps)
	return c, nil
}

// loadBranches builds the branch list from the environment. For each known
// branch it reads VAULT_MANAGER_<KEY>_ADDRESS and includes the branch only when
// that address is set, applying FEED_ID_<KEY> / MCR_BPS_<KEY> overrides on top
// of the protocol defaults. defaultMCR is the global MCR used when a branch has
// no MCR_BPS_<KEY> override.
//
// Backward compat: if no per-branch VaultManager is set but the legacy
// VAULT_MANAGER_ADDRESS is, a single FXRP branch is synthesized from it (with
// the legacy XRP_USD_FEED_ID override honored) so existing deploys keep working.
func loadBranches(defaultMCR *big.Int) []Branch {
	var out []Branch
	for _, tmpl := range knownBranches {
		vm := os.Getenv(branchVaultManagerEnv(tmpl.Key))
		if vm == "" {
			continue
		}
		b := tmpl // copy the protocol-constant template
		b.VaultManager = vm
		b.FeedID = getenvDefault(branchFeedIDEnv(tmpl.Key), tmpl.FeedID)
		b.MCRBps = branchMCRBps(tmpl.Key, defaultMCR)
		out = append(out, b)
	}
	if len(out) == 0 {
		if legacy := os.Getenv(EnvVaultManagerAddress); legacy != "" {
			b := knownBranches[0] // FXRP template
			b.VaultManager = legacy
			b.FeedID = getenvDefault(EnvFTSOFeedID, b.FeedID)
			b.MCRBps = branchMCRBps(b.Key, defaultMCR)
			out = append(out, b)
		}
	}
	return out
}

// branchVaultManagerEnv / branchFeedIDEnv / branchMCRBpsEnv build the concrete
// per-branch env var names for a branch key (e.g. "VAULT_MANAGER_WFLR_ADDRESS").
func branchVaultManagerEnv(key string) string {
	return EnvBranchVaultManagerPrefix + key + EnvBranchVaultManagerSuffix
}
func branchFeedIDEnv(key string) string { return EnvBranchFeedIDPrefix + key }
func branchMCRBpsEnv(key string) string { return EnvBranchMCRBpsPrefix + key }

// branchMCRBps returns the per-branch MCR: MCR_BPS_<KEY> when set and valid,
// else a copy of the global default (so branches never share a *big.Int).
func branchMCRBps(key string, def *big.Int) *big.Int {
	if v := os.Getenv(branchMCRBpsEnv(key)); v != "" {
		if n, ok := new(big.Int).SetString(strings.TrimSpace(v), 10); ok && n.Sign() > 0 {
			return n
		}
	}
	if def != nil {
		return new(big.Int).Set(def)
	}
	return big.NewInt(DefaultMCRBps)
}

// BranchByKey returns the loaded branch for a key (case-insensitive) and whether
// it was found.
func (c *Config) BranchByKey(key string) (*Branch, bool) {
	for i := range c.Branches {
		if strings.EqualFold(c.Branches[i].Key, key) {
			return &c.Branches[i], true
		}
	}
	return nil, false
}

// CanExecuteOnChain reports whether the extension has enough configuration to
// submit real transactions: at least one branch with a VaultManager AND the
// keeper address present. Decision logic runs regardless; only submission is
// gated.
func (c *Config) CanExecuteOnChain() error {
	if !c.hasAnyVaultManager() {
		return errors.New("config: no VaultManager configured " +
			"(set VAULT_MANAGER_FXRP_ADDRESS / VAULT_MANAGER_WFLR_ADDRESS, or legacy VAULT_MANAGER_ADDRESS)")
	}
	if c.KeeperTEEAddress == "" {
		return errors.New("config: KEEPER_TEE_ADDRESS not set (needs GUARDIAN_EXECUTOR_ROLE)")
	}
	return nil
}

// hasAnyVaultManager reports whether any branch (or the legacy field) supplies a
// VaultManager address.
func (c *Config) hasAnyVaultManager() bool {
	for i := range c.Branches {
		if c.Branches[i].VaultManager != "" {
			return true
		}
	}
	return c.VaultManagerAddress != ""
}

// MCRBps returns the configured MCR in basis points, defaulting to 13000 (130%).
func MCRBps() *big.Int {
	if v := os.Getenv(EnvMCRBps); v != "" {
		if n, ok := new(big.Int).SetString(strings.TrimSpace(v), 10); ok && n.Sign() > 0 {
			return n
		}
	}
	return big.NewInt(DefaultMCRBps)
}

func getenvDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
