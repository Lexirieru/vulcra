// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IPriceOracle
/// @notice Vulcra price oracle: normalized XRP/USD from FTSOv2 with a staleness guard.
interface IPriceOracle {
    /// @notice XRP price in 18-decimal USD, reverting if the feed is stale or zero.
    function xrpUsdPrice18() external view returns (uint256);

    /// @notice USD value (18-dec) of an FXRP amount (6-dec), using the live XRP/USD price.
    function collateralValueUsd18(uint256 fxrpAmount6) external view returns (uint256);

    /// @notice FXRP amount (6-dec) worth a given 18-dec USD value at the live price.
    function collateralForUsd18(uint256 usd18) external view returns (uint256);

    /// @notice The XRP/USD block-latency feed id used by this oracle.
    function feedId() external view returns (bytes21);

    /// @notice Maximum age (seconds) of a feed reading before it is considered stale.
    function maxStalenessSeconds() external view returns (uint64);
}
