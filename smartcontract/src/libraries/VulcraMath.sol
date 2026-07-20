// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title VulcraMath
/// @notice Centralized decimal-normalization and collateral-ratio helpers for Vulcra.
/// @dev All USD amounts in the protocol are 18-decimal (vUSD-native). FXRP is 6-decimal
///      (XRP drops convention). FTSO feed decimals are dynamic (`int8`). This library is the
///      single source of truth for converting between those scales — no other contract touches
///      raw feed decimals or the FXRP 6-decimal convention (KTD4).
library VulcraMath {
    /// @dev 18-decimal fixed-point unit.
    uint256 internal constant WAD = 1e18;
    /// @dev Basis-points denominator.
    uint256 internal constant BPS = 10_000;
    /// @dev FXRP token decimals (drops convention).
    uint8 internal constant FXRP_DECIMALS = 6;
    /// @dev 10 ** FXRP_DECIMALS.
    uint256 internal constant FXRP_UNIT = 1e6;

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

    /// @notice USD value (18-dec) of an FXRP amount given the 18-dec XRP/USD price.
    /// @dev usd18 = (fxrpAmount6 / 1e6) * price18 = fxrpAmount6 * price18 / 1e6.
    /// @param fxrpAmount6 FXRP amount in raw 6-decimal units.
    /// @param price18 XRP price in 18-decimal USD.
    /// @return usd18 Collateral value in 18-decimal USD.
    function collateralValueUsd18(uint256 fxrpAmount6, uint256 price18) internal pure returns (uint256 usd18) {
        usd18 = (fxrpAmount6 * price18) / FXRP_UNIT;
    }

    /// @notice FXRP amount (6-dec) worth a given 18-dec USD value at the given 18-dec price.
    /// @dev fxrp6 = usd18 * 1e6 / price18. Rounds down (favours the protocol/remaining vaults).
    /// @param usd18 USD value in 18 decimals.
    /// @param price18 XRP price in 18-decimal USD (must be > 0).
    /// @return fxrp6 FXRP amount in raw 6-decimal units.
    function collateralForUsd18(uint256 usd18, uint256 price18) internal pure returns (uint256 fxrp6) {
        fxrp6 = (usd18 * FXRP_UNIT) / price18;
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

    /// @notice Nominal collateral ratio (price-free), scaled to WAD: collateral6 * 1e18 / debt18.
    /// @dev Used to order vaults in the sorted list. Because a single price multiplies every vault,
    ///      NICR ordering is identical to actual-CR ordering (KTD1). Returns max for zero debt.
    /// @param collateral6 Collateral in raw 6-decimal FXRP units.
    /// @param debt18 Debt in 18-dec vUSD.
    /// @return nicr_ Nominal collateral ratio, WAD-scaled.
    function nicr(uint256 collateral6, uint256 debt18) internal pure returns (uint256 nicr_) {
        if (debt18 == 0) return type(uint256).max;
        nicr_ = (collateral6 * WAD) / debt18;
    }
}
