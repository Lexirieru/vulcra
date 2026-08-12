// Package chain — transaction SUBMISSION side of the Guardian.
//
// ⚠️ UNVERIFIED (as of this deployment). The read path (client.go) is exercised
// live; this write path is NOT yet run end-to-end against a real TEE node + a
// funded keeper wallet on GCP Confidential Space. It compiles and follows the
// tee-node /sign contract (teetypes.SignRequest/SignResponse) and go-ethereum
// EIP-1559 signing, but the exact recovery-id (v) encoding returned by the sign
// port and the on-chain round-trip have not been confirmed. Kept gated behind
// config.CanExecuteOnChain until a live Confidential Space run verifies it.
package chain

import (
	"context"
	"fmt"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

// VaultManager write fragment for the Guardian's two on-chain actions (must match
// smartcontract/src/VaultManager.sol):
//
//	liquidate(address owner)
//	delegatedRepay(address owner, uint256 maxAmount18, address prevHint, address nextHint)  [GUARDIAN_EXECUTOR_ROLE]
const vaultManagerWriteABIJSON = `[
	{"name":"liquidate","type":"function","stateMutability":"nonpayable",
	 "inputs":[{"name":"owner","type":"address"}],"outputs":[]},
	{"name":"delegatedRepay","type":"function","stateMutability":"nonpayable",
	 "inputs":[{"name":"owner","type":"address"},{"name":"maxAmount18","type":"uint256"},
	           {"name":"prevHint","type":"address"},{"name":"nextHint","type":"address"}],"outputs":[]}
]`

func vmWriteABI() (abi.ABI, error) { return abi.JSON(strings.NewReader(vaultManagerWriteABIJSON)) }

// PackLiquidate builds the calldata for VaultManager.liquidate(owner).
func PackLiquidate(owner common.Address) ([]byte, error) {
	a, err := vmWriteABI()
	if err != nil {
		return nil, fmt.Errorf("chain: vm write abi: %w", err)
	}
	return a.Pack("liquidate", owner)
}

// PackDelegatedRepay builds the calldata for VaultManager.delegatedRepay(owner,
// maxAmount18, 0x0, 0x0) — the hint args are vestigial (rate-keyed list).
func PackDelegatedRepay(owner common.Address, maxAmount18 *big.Int) ([]byte, error) {
	a, err := vmWriteABI()
	if err != nil {
		return nil, fmt.Errorf("chain: vm write abi: %w", err)
	}
	return a.Pack("delegatedRepay", owner, maxAmount18, common.Address{}, common.Address{})
}

// PrepareTx builds an unsigned EIP-1559 transaction (nonce + fees read live, gas
// estimated) and returns it plus the hash the TEE sign port must sign.
func (c *Client) PrepareTx(
	ctx context.Context, from, to common.Address, data []byte, chainID *big.Int,
) (*types.Transaction, common.Hash, error) {
	nonce, err := c.ec.PendingNonceAt(ctx, from)
	if err != nil {
		return nil, common.Hash{}, fmt.Errorf("chain: pending nonce: %w", err)
	}
	tip, err := c.ec.SuggestGasTipCap(ctx)
	if err != nil {
		return nil, common.Hash{}, fmt.Errorf("chain: gas tip: %w", err)
	}
	head, err := c.ec.HeaderByNumber(ctx, nil)
	if err != nil {
		return nil, common.Hash{}, fmt.Errorf("chain: latest header: %w", err)
	}
	// Generous headroom for Coston2's elevated base fee: maxFee = 2·baseFee + tip.
	feeCap := new(big.Int).Add(new(big.Int).Mul(head.BaseFee, big.NewInt(2)), tip)
	gas, err := c.ec.EstimateGas(ctx, ethereum.CallMsg{From: from, To: &to, Data: data})
	if err != nil {
		return nil, common.Hash{}, fmt.Errorf("chain: estimate gas (would the tx revert?): %w", err)
	}
	tx := types.NewTx(&types.DynamicFeeTx{
		ChainID:   chainID,
		Nonce:     nonce,
		GasTipCap: tip,
		GasFeeCap: feeCap,
		Gas:       gas * 12 / 10, // +20% headroom
		To:        &to,
		Value:     big.NewInt(0),
		Data:      data,
	})
	signer := types.LatestSignerForChainID(chainID)
	return tx, signer.Hash(tx), nil
}

// SendSigned attaches the sign-port signature (65 bytes: r‖s‖v) to the prepared
// tx and broadcasts it, returning the tx hash. The recovery id (v) encoding the
// sign port returns is the main UNVERIFIED assumption — see the package note.
func (c *Client) SendSigned(
	ctx context.Context, tx *types.Transaction, chainID *big.Int, sig []byte,
) (string, error) {
	if len(sig) != 65 {
		return "", fmt.Errorf("chain: signature must be 65 bytes, got %d", len(sig))
	}
	signer := types.LatestSignerForChainID(chainID)
	signed, err := tx.WithSignature(signer, sig)
	if err != nil {
		return "", fmt.Errorf("chain: attach signature: %w", err)
	}
	if err := c.ec.SendTransaction(ctx, signed); err != nil {
		return "", fmt.Errorf("chain: send transaction: %w", err)
	}
	return signed.Hash().Hex(), nil
}
