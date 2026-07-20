// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VulcraTestBase} from "../helpers/VulcraTestBase.sol";
import {PriceOracle} from "../../src/PriceOracle.sol";
import {VulcraMath} from "../../src/libraries/VulcraMath.sol";

/// @notice Fuzz coverage for centralized price normalization (R3/R9).
contract PriceNormalizationFuzzTest is VulcraTestBase {
    PriceOracle internal oracle;

    function setUp() public {
        vm.warp(1_800_000_000);
        PriceOracle impl = new PriceOracle();
        oracle = PriceOracle(
            _deployProxy(
                address(impl),
                abi.encodeCall(PriceOracle.initialize, (makeAddr("admin"), XRP_USD_FEED_ID, 3600))
            )
        );
    }

    /// @dev Normalization matches the closed-form across decimals on both sides of 18.
    function testFuzz_toPrice18(uint256 value, uint8 decimalsRaw) public {
        value = bound(value, 1, 1e30);
        int8 decimals = int8(int256(bound(decimalsRaw, 0, 24)));
        _setXrpPrice(value, decimals);

        uint256 got = oracle.xrpUsdPrice18();
        uint256 expected;
        if (decimals <= 18) {
            expected = value * (10 ** uint256(int256(18) - int256(decimals)));
        } else {
            expected = value / (10 ** uint256(int256(decimals) - int256(18)));
        }
        assertEq(got, expected, "price18 mismatch");
    }

    /// @dev collateralValueUsd18 never reverts on valid ranges and matches the formula.
    function testFuzz_collateralValue(uint256 value, uint8 decimalsRaw, uint256 fxrp6) public {
        value = bound(value, 1, 1e18);
        int8 decimals = int8(int256(bound(decimalsRaw, 0, 18)));
        fxrp6 = bound(fxrp6, 0, 1e18); // up to 1e12 FXRP
        _setXrpPrice(value, decimals);

        uint256 price18 = oracle.xrpUsdPrice18();
        uint256 got = oracle.collateralValueUsd18(fxrp6);
        assertEq(got, (fxrp6 * price18) / 1e6, "collateral value mismatch");
    }

    /// @dev collateralForUsd18 is the (rounding-down) inverse of collateralValueUsd18.
    function testFuzz_roundTrip(uint256 value, uint8 decimalsRaw, uint256 fxrp6) public {
        value = bound(value, 1e4, 1e14); // realistic price band, avoids degenerate rounding
        int8 decimals = int8(int256(bound(decimalsRaw, 2, 12)));
        fxrp6 = bound(fxrp6, 1e6, 1e15);
        _setXrpPrice(value, decimals);

        uint256 usd18 = oracle.collateralValueUsd18(fxrp6);
        uint256 backToFxrp = oracle.collateralForUsd18(usd18);
        // Inverse rounds down; never returns more collateral than we started with.
        assertLe(backToFxrp, fxrp6, "round-trip must not inflate collateral");
    }

    /// @dev NICR ordering is price-independent: scaling both vaults' price does not reorder them.
    function testFuzz_nicrOrderingPriceInvariant(uint256 c1, uint256 d1, uint256 c2, uint256 d2)
        public
        pure
    {
        c1 = bound(c1, 1e6, 1e15);
        d1 = bound(d1, 1e18, 1e24);
        c2 = bound(c2, 1e6, 1e15);
        d2 = bound(d2, 1e18, 1e24);
        uint256 n1 = VulcraMath.nicr(c1, d1);
        uint256 n2 = VulcraMath.nicr(c2, d2);
        // Actual CR at any positive price P (18-dec) = collateralValueUsd18 * BPS / debt.
        // Since P multiplies both, the ordering of actual CR equals ordering of NICR.
        uint256 p = 2.5e18;
        uint256 cr1 = VulcraMath.crBps(VulcraMath.collateralValueUsd18(c1, p), d1);
        uint256 cr2 = VulcraMath.crBps(VulcraMath.collateralValueUsd18(c2, p), d2);
        if (n1 < n2) assertLe(cr1, cr2, "NICR<  implies CR<=");
        if (n1 > n2) assertGe(cr1, cr2, "NICR>  implies CR>=");
    }
}
