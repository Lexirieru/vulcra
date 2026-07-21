// Package chain is the enclave's authoritative Coston2 reader. It performs the
// on-chain reads the keeper/guardian decisions depend on — VaultManager.getVault
// and the branch FTSO price — directly against the configured RPC, resolving
// FtsoV2 through the FlareContractRegistry at runtime (KTD5: the enclave never
// trusts indexer-supplied state for a decision, it re-reads the chain).
//
// This package is intentionally read-only: transaction submission (liquidate /
// delegatedRepay) is signed via the TEE sign port and stays gated behind
// config.CanExecuteOnChain.
package chain

import (
	"context"
	"fmt"
	"math/big"
	"strings"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
)

// callMsg builds the read-only eth_call message for a contract invocation.
func callMsg(to common.Address, data []byte) ethereum.CallMsg {
	return ethereum.CallMsg{To: &to, Data: data}
}

// ABI fragments for the three read entry points. The VaultManager fragment MUST
// match smartcontract/src/VaultManager.sol (the interface authority):
//
//	getVault(address owner) → (uint256 collateral6, uint256 debt18, bool active)
//
// where debt18 is the vault's ENTIRE current debt including accrued interest
// (V2 user-set interest rates).
const (
	registryABIJSON = `[{"name":"getContractAddressByName","type":"function","stateMutability":"view",
		"inputs":[{"name":"_name","type":"string"}],
		"outputs":[{"name":"","type":"address"}]}]`

	vaultManagerABIJSON = `[{"name":"getVault","type":"function","stateMutability":"view",
		"inputs":[{"name":"owner","type":"address"}],
		"outputs":[{"name":"collateral6","type":"uint256"},{"name":"debt18","type":"uint256"},{"name":"active","type":"bool"}]}]`

	ftsoV2ABIJSON = `[{"name":"getFeedById","type":"function","stateMutability":"payable",
		"inputs":[{"name":"_feedId","type":"bytes21"}],
		"outputs":[{"name":"","type":"uint256"},{"name":"","type":"int8"},{"name":"","type":"uint64"}]}]`
)

// FtsoV2Name is the FlareContractRegistry name the FTSOv2 consumer contract is
// resolved under. Only the registry ADDRESS is configured; everything else is
// resolved at runtime.
const FtsoV2Name = "FtsoV2"

// DefaultMaxPriceStaleness bounds how old an FTSO block-latency feed value may
// be before the enclave refuses to decide on it (KTD5: a stale price is treated
// like no price). Block-latency feeds update every ~1.8s block, so 5 minutes is
// generous headroom for RPC lag without ever accepting a dead feed.
const DefaultMaxPriceStaleness = 5 * time.Minute

// Client reads authoritative chain state over a single RPC connection.
type Client struct {
	ec       *ethclient.Client
	registry common.Address

	registryABI abi.ABI
	vmABI       abi.ABI
	ftsoABI     abi.ABI

	mu     sync.Mutex
	ftsoV2 common.Address // resolved once, cached

	// MaxPriceStaleness overrides DefaultMaxPriceStaleness when > 0.
	MaxPriceStaleness time.Duration
}

// Dial connects the reader to an RPC endpoint with the given contract registry.
func Dial(rpcURL, registryHex string) (*Client, error) {
	if !common.IsHexAddress(registryHex) {
		return nil, fmt.Errorf("chain: registry %q is not a hex address", registryHex)
	}
	ec, err := ethclient.Dial(rpcURL)
	if err != nil {
		return nil, fmt.Errorf("chain: dial %s: %w", rpcURL, err)
	}
	rABI, err := abi.JSON(strings.NewReader(registryABIJSON))
	if err != nil {
		return nil, fmt.Errorf("chain: registry abi: %w", err)
	}
	vABI, err := abi.JSON(strings.NewReader(vaultManagerABIJSON))
	if err != nil {
		return nil, fmt.Errorf("chain: vaultmanager abi: %w", err)
	}
	fABI, err := abi.JSON(strings.NewReader(ftsoV2ABIJSON))
	if err != nil {
		return nil, fmt.Errorf("chain: ftsov2 abi: %w", err)
	}
	return &Client{
		ec:          ec,
		registry:    common.HexToAddress(registryHex),
		registryABI: rABI,
		vmABI:       vABI,
		ftsoABI:     fABI,
	}, nil
}

// call performs an eth_call against `to` and returns the raw return data.
func (c *Client) call(ctx context.Context, to common.Address, data []byte) ([]byte, error) {
	return c.ec.CallContract(ctx, callMsg(to, data), nil)
}

// GetVault reads VaultManager.getVault(owner) on one branch's VaultManager.
// debt18 includes accrued interest (V2).
func (c *Client) GetVault(ctx context.Context, vaultManagerHex, ownerHex string) (collateral, debt18 *big.Int, active bool, err error) {
	if !common.IsHexAddress(vaultManagerHex) {
		return nil, nil, false, fmt.Errorf("chain: vault manager %q is not a hex address", vaultManagerHex)
	}
	if !common.IsHexAddress(ownerHex) {
		return nil, nil, false, fmt.Errorf("chain: owner %q is not a hex address", ownerHex)
	}
	data, err := c.vmABI.Pack("getVault", common.HexToAddress(ownerHex))
	if err != nil {
		return nil, nil, false, fmt.Errorf("chain: pack getVault: %w", err)
	}
	raw, err := c.call(ctx, common.HexToAddress(vaultManagerHex), data)
	if err != nil {
		return nil, nil, false, fmt.Errorf("chain: getVault(%s): %w", ownerHex, err)
	}
	out, err := c.vmABI.Unpack("getVault", raw)
	if err != nil {
		return nil, nil, false, fmt.Errorf("chain: unpack getVault: %w", err)
	}
	collateral, _ = out[0].(*big.Int)
	debt18, _ = out[1].(*big.Int)
	active, _ = out[2].(bool)
	return collateral, debt18, active, nil
}

// FtsoV2Address resolves (and caches) the FtsoV2 address from the registry.
func (c *Client) FtsoV2Address(ctx context.Context) (common.Address, error) {
	c.mu.Lock()
	cached := c.ftsoV2
	c.mu.Unlock()
	if cached != (common.Address{}) {
		return cached, nil
	}

	data, err := c.registryABI.Pack("getContractAddressByName", FtsoV2Name)
	if err != nil {
		return common.Address{}, fmt.Errorf("chain: pack registry lookup: %w", err)
	}
	raw, err := c.call(ctx, c.registry, data)
	if err != nil {
		return common.Address{}, fmt.Errorf("chain: registry lookup %s: %w", FtsoV2Name, err)
	}
	out, err := c.registryABI.Unpack("getContractAddressByName", raw)
	if err != nil {
		return common.Address{}, fmt.Errorf("chain: unpack registry lookup: %w", err)
	}
	addr, _ := out[0].(common.Address)
	if addr == (common.Address{}) {
		return common.Address{}, fmt.Errorf("chain: registry resolved %s to the zero address", FtsoV2Name)
	}
	c.mu.Lock()
	c.ftsoV2 = addr
	c.mu.Unlock()
	return addr, nil
}

// FeedPrice18 reads a block-latency FTSOv2 feed and scales it to 18 decimals.
// It errors on a zero value or a value older than the staleness bound so a dead
// feed can never mark a vault liquidatable (KTD5).
func (c *Client) FeedPrice18(ctx context.Context, feedIDHex string) (price18 *big.Int, feedTimestamp uint64, err error) {
	feedID, err := parseFeedID(feedIDHex)
	if err != nil {
		return nil, 0, err
	}
	ftso, err := c.FtsoV2Address(ctx)
	if err != nil {
		return nil, 0, err
	}
	data, err := c.ftsoABI.Pack("getFeedById", feedID)
	if err != nil {
		return nil, 0, fmt.Errorf("chain: pack getFeedById: %w", err)
	}
	raw, err := c.call(ctx, ftso, data)
	if err != nil {
		return nil, 0, fmt.Errorf("chain: getFeedById(%s): %w", feedIDHex, err)
	}
	out, err := c.ftsoABI.Unpack("getFeedById", raw)
	if err != nil {
		return nil, 0, fmt.Errorf("chain: unpack getFeedById: %w", err)
	}
	value, _ := out[0].(*big.Int)
	decimals, _ := out[1].(int8)
	ts, _ := out[2].(uint64)

	if value == nil || value.Sign() <= 0 {
		return nil, ts, fmt.Errorf("chain: feed %s returned a zero price", feedIDHex)
	}
	maxAge := c.MaxPriceStaleness
	if maxAge <= 0 {
		maxAge = DefaultMaxPriceStaleness
	}
	if age := time.Since(time.Unix(int64(ts), 0)); age > maxAge {
		return nil, ts, fmt.Errorf("chain: feed %s is stale (age %s > %s)", feedIDHex, age.Round(time.Second), maxAge)
	}

	// Scale value (feed decimals) → 18 decimals. FTSO decimals may be negative
	// (value already a multiple of 10^-decimals).
	exp := int64(18) - int64(decimals)
	scaled := new(big.Int).Set(value)
	switch {
	case exp > 0:
		scaled.Mul(scaled, new(big.Int).Exp(big.NewInt(10), big.NewInt(exp), nil))
	case exp < 0:
		scaled.Div(scaled, new(big.Int).Exp(big.NewInt(10), big.NewInt(-exp), nil))
	}
	return scaled, ts, nil
}

// parseFeedID parses a "0x"-prefixed 21-byte feed id into the fixed-size array
// the ABI encoder expects for bytes21.
func parseFeedID(feedIDHex string) ([21]byte, error) {
	var id [21]byte
	b := common.FromHex(strings.TrimSpace(feedIDHex))
	if len(b) != 21 {
		return id, fmt.Errorf("chain: feed id %q is not 21 bytes", feedIDHex)
	}
	copy(id[:], b)
	return id, nil
}
