// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IVaultManager} from "../../src/interfaces/IVaultManager.sol";

/// @title Coston2Config
/// @notice Deployment configuration for Vulcra on Flare Coston2 (chain 114).
/// @dev Mainnet reuse only needs to swap these constants + the periphery import namespace
///      (coston2/ -> flare/). The XRP/USD feed id is verified live at Gate 0.
library Coston2Config {
    /// @notice XRP/USD block-latency feed id (category 0x01 + "XRP/USD" utf8, right-padded).
    bytes21 internal constant XRP_USD_FEED_ID = bytes21(0x015852502f55534400000000000000000000000000);

    /// @notice Max feed age (seconds) before the oracle rejects a price as stale.
    uint64 internal constant PRICE_MAX_STALENESS = 3600;

    // Protocol parameters (R7).
    uint256 internal constant MCR_BPS = 13_000; // 130%
    uint256 internal constant MIN_DEBT_18 = 100e18; // 100 vUSD
    uint256 internal constant MINT_FEE_BPS = 50; // 0.5%
    uint256 internal constant LIQ_BONUS_BPS = 1_000; // 10%
    uint256 internal constant REDEMPTION_FEE_BPS = 0; // face value

    function params() internal pure returns (IVaultManager.Params memory) {
        return IVaultManager.Params({
            mcrBps: MCR_BPS,
            minDebt18: MIN_DEBT_18,
            mintFeeBps: MINT_FEE_BPS,
            liqBonusBps: LIQ_BONUS_BPS,
            redemptionFeeBps: REDEMPTION_FEE_BPS
        });
    }
}
