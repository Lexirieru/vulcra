// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IVaultManager} from "../../src/interfaces/IVaultManager.sol";

/// @title Coston2Config
/// @notice Deployment configuration for Vulcra multi-collateral branches on Flare Coston2 (114).
/// @dev Collateral token addresses are resolved at runtime via FlareContractRegistry (FXRP via
///      AssetManagerFXRP.fAsset(); wFLR via WNat) — never hardcoded here. Feed ids + decimals below
///      were verified live on Coston2. Mainnet reuse only swaps these constants + the periphery
///      import namespace (coston2/ -> flare/). Params may differ per branch (Enosys-style).
library Coston2Config {
    // --- feeds (verified live) ---
    /// @notice XRP/USD block-latency feed id (6-dec on Coston2, ~$1.11).
    bytes21 internal constant XRP_USD_FEED_ID = bytes21(0x015852502f55534400000000000000000000000000);
    /// @notice FLR/USD block-latency feed id (8-dec on Coston2).
    bytes21 internal constant FLR_USD_FEED_ID = bytes21(0x01464c522f55534400000000000000000000000000);

    // --- collateral decimals ---
    uint8 internal constant FXRP_DECIMALS = 6;
    uint8 internal constant WFLR_DECIMALS = 18;

    /// @notice Max feed age (seconds) before the oracle rejects a price as stale.
    uint64 internal constant PRICE_MAX_STALENESS = 3600;

    // --- per-branch debt ceilings (vUSD mint caps; 0 = unlimited) ---
    uint256 internal constant FXRP_DEBT_CEILING = 0; // unlimited
    uint256 internal constant WFLR_DEBT_CEILING = 500_000e18; // 500k vUSD cap for the more volatile branch

    /// @notice FXRP branch parameters: MCR 130%, min debt 100 vUSD, mint fee 0.5%, liq bonus 10%.
    function fxrpParams() internal pure returns (IVaultManager.Params memory) {
        return IVaultManager.Params({
            mcrBps: 13_000, minDebt18: 100e18, mintFeeBps: 50, liqBonusBps: 1_000, redemptionFeeBps: 0
        });
    }

    /// @notice wFLR branch parameters: MCR 150% (FLR is more volatile), min debt 200 vUSD,
    ///         mint fee 0.5%, liq bonus 12%.
    function wflrParams() internal pure returns (IVaultManager.Params memory) {
        return IVaultManager.Params({
            mcrBps: 15_000, minDebt18: 200e18, mintFeeBps: 50, liqBonusBps: 1_200, redemptionFeeBps: 0
        });
    }
}
