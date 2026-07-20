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
	EnvVaultManagerAddress   = "VAULT_MANAGER_ADDRESS"   // resolved after deploy
	EnvPriceOracleAddress    = "PRICE_ORACLE_ADDRESS"    // resolved after deploy
	EnvFTSOFeedID            = "XRP_USD_FEED_ID"         // FTSO feed id (bytes21 hex)
	EnvMCRBps                = "MCR_BPS"                 // default 13000
	EnvChainID               = "CHAIN_ID"                // default 114 (Coston2)

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
	RPCURL              string
	FlareContractReg    string
	VaultManagerAddress string
	PriceOracleAddress  string
	FTSOFeedID          string
	MCRBps              *big.Int
	ChainID             int64
	SimulatedTEE        bool
	SignPort            string
	KeeperTEEAddress    string
	TEEProxyURL         string
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
	return c, nil
}

// CanExecuteOnChain reports whether the extension has enough configuration to
// submit real transactions (keeper address present). Decision logic runs
// regardless; only submission is gated.
func (c *Config) CanExecuteOnChain() error {
	if c.VaultManagerAddress == "" {
		return errors.New("config: VAULT_MANAGER_ADDRESS not set (resolve after deploy)")
	}
	if c.KeeperTEEAddress == "" {
		return errors.New("config: KEEPER_TEE_ADDRESS not set (needs GUARDIAN_EXECUTOR_ROLE)")
	}
	return nil
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
