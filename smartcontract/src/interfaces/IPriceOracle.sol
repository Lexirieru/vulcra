// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IPriceOracle
/// @notice Vulcra per-branch price oracle: a normalized collateral/USD price from FTSOv2 with a
///         staleness guard. Collateral-decimal normalization is not the oracle's concern — it lives
///         in the VaultManager (which knows its collateral decimals) via {VulcraMath}.
interface IPriceOracle {
    /// @notice Collateral/USD price in 18-decimal USD, reverting if the feed is stale or zero.
    function price18() external view returns (uint256);

    /// @notice The block-latency FTSO feed id this oracle reads (e.g. XRP/USD or FLR/USD).
    function feedId() external view returns (bytes21);

    /// @notice Maximum age (seconds) of a feed reading before it is considered stale.
    function maxStalenessSeconds() external view returns (uint64);
}
