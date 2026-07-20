// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title VulcraMath
/// @notice Centralized decimal-normalization and collateral-ratio helpers for Vulcra.
/// @dev All USD amounts in the protocol are 18-decimal (vUSD-native). Collateral tokens have
///      per-branch decimals (e.g. FXRP 6, wFLR 18), passed explicitly. FTSO feed decimals are
///      dynamic (`int8`). This library is the single source of truth for converting between those
///      scales — the collateral-agnostic core never assumes a fixed decimals convention (KTD4).
library VulcraMath {
    /// @dev 18-decimal fixed-point unit.
    uint256 internal constant WAD = 1e18;
    /// @dev Basis-points denominator.
    uint256 internal constant BPS = 10_000;

    /// @notice Normalize a raw FTSO feed value into an 18-decimal USD price.
    /// @dev price18 = value * 10^(18 - feedDecimals); handles feedDecimals above 18 by dividing.
    ///      `feedDecimals` is `int8` per the FTSO interface; negative decimals are handled generally.
    /// @param value Raw feed value.
    /// @param feedDecimals Feed decimals (FTSO `int8`).
    /// @return price18 The price scaled to 18 decimals.
    function toPrice18(uint256 value, int8 feedDecimals) internal pure returns (uint256 price18) {
        int256 e = int256(18) - int256(feedDecimals);
        if (e >= 0) {
            price18 = value * (10 ** uint256(e));
        } else {
            price18 = value / (10 ** uint256(-e));
        }
    }

    /// @notice USD value (18-dec) of a raw collateral amount given its decimals and the 18-dec price.
    /// @dev usd18 = (rawAmount / 10^dec) * price18 = rawAmount * price18 / 10^dec.
    /// @param rawAmount Collateral amount in the token's raw units.
    /// @param collateralDecimals Collateral token decimals (e.g. FXRP 6, wFLR 18).
    /// @param price18 Collateral/USD price in 18-decimal USD.
    /// @return usd18 Collateral value in 18-decimal USD.
    function collateralValueUsd18(uint256 rawAmount, uint8 collateralDecimals, uint256 price18)
        internal
        pure
        returns (uint256 usd18)
    {
        usd18 = (rawAmount * price18) / (10 ** collateralDecimals);
    }

    /// @notice Raw collateral amount worth a given 18-dec USD value at the given 18-dec price.
    /// @dev raw = usd18 * 10^dec / price18. Rounds down (favours the protocol/remaining vaults).
    /// @param usd18 USD value in 18 decimals.
    /// @param collateralDecimals Collateral token decimals.
    /// @param price18 Collateral/USD price in 18-decimal USD (must be > 0).
    /// @return rawAmount Collateral amount in the token's raw units.
    function collateralForUsd18(uint256 usd18, uint8 collateralDecimals, uint256 price18)
        internal
        pure
        returns (uint256 rawAmount)
    {
        rawAmount = (usd18 * (10 ** collateralDecimals)) / price18;
    }

    /// @notice Collateral ratio in basis points: collateralValueUsd18 * 10000 / debt18.
    /// @dev Returns type(uint256).max when debt is zero (a debt-free position is infinitely collateralized).
    /// @param collateralValueUsd18_ Collateral value in 18-dec USD.
    /// @param debt18 Debt in 18-dec vUSD.
    /// @return crBps_ Collateral ratio in basis points.
    function crBps(uint256 collateralValueUsd18_, uint256 debt18) internal pure returns (uint256 crBps_) {
        if (debt18 == 0) return type(uint256).max;
        crBps_ = (collateralValueUsd18_ * BPS) / debt18;
    }

    /// @notice Nominal collateral ratio (price-free), scaled to WAD: rawCollateral * 1e18 / debt18.
    /// @dev Used to order vaults within a branch. Within a branch every vault shares one collateral
    ///      token (fixed decimals) and one price, so NICR ordering is identical to actual-CR ordering
    ///      (KTD1). NICR is only ever compared within a branch, never across branches. Returns max
    ///      for zero debt.
    /// @param rawCollateral Collateral in the token's raw units.
    /// @param debt18 Debt in 18-dec vUSD.
    /// @return nicr_ Nominal collateral ratio, WAD-scaled.
    function nicr(uint256 rawCollateral, uint256 debt18) internal pure returns (uint256 nicr_) {
        if (debt18 == 0) return type(uint256).max;
        nicr_ = (rawCollateral * WAD) / debt18;
    }
}
