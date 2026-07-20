// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VulcraTestBase} from "../helpers/VulcraTestBase.sol";
import {PriceOracle} from "../../src/PriceOracle.sol";
import {VulcraMath} from "../../src/libraries/VulcraMath.sol";

/// @notice Fuzz coverage for centralized price normalization across branches (R3/R9):
///         FXRP (6-dec collateral, 6-dec XRP/USD feed) and wFLR (18-dec collateral, 8-dec FLR/USD).
contract PriceNormalizationFuzzTest is VulcraTestBase {
    PriceOracle internal xrpOracle; // FXRP branch feed
    PriceOracle internal flrOracle; // wFLR branch feed

    function setUp() public {
        vm.warp(1_800_000_000);
        xrpOracle = PriceOracle(
            _deployProxy(
                address(new PriceOracle()),
                abi.encodeCall(PriceOracle.initialize, (makeAddr("admin"), XRP_USD_FEED_ID, 3600))
            )
        );
        flrOracle = PriceOracle(
            _deployProxy(
                address(new PriceOracle()),
                abi.encodeCall(PriceOracle.initialize, (makeAddr("admin"), FLR_USD_FEED_ID, 3600))
            )
        );
    }

    /// @dev Feed normalization matches the closed-form across decimals on both sides of 18.
    function testFuzz_toPrice18(uint256 value, uint8 decimalsRaw) public {
        value = bound(value, 1, 1e30);
        int8 decimals = int8(int256(bound(decimalsRaw, 0, 24)));
        _setFeedById(XRP_USD_FEED_ID, value, decimals, uint64(block.timestamp));

        uint256 got = xrpOracle.price18();
        uint256 expected;
        if (decimals <= 18) {
            expected = value * (10 ** uint256(int256(18) - int256(decimals)));
        } else {
            expected = value / (10 ** uint256(int256(decimals) - int256(18)));
        }
        assertEq(got, expected, "price18 mismatch");
    }

    /// @dev FXRP branch: 6-dec collateral, matches the formula and never reverts on valid ranges.
    function testFuzz_collateralValue_fxrp(uint256 value, uint8 decimalsRaw, uint256 fxrp6) public {
        value = bound(value, 1, 1e18);
        int8 decimals = int8(int256(bound(decimalsRaw, 0, 18)));
        fxrp6 = bound(fxrp6, 0, 1e18);
        _setFeedById(XRP_USD_FEED_ID, value, decimals, uint64(block.timestamp));

        uint256 price18 = xrpOracle.price18();
        uint256 got = VulcraMath.collateralValueUsd18(fxrp6, 6, price18);
        assertEq(got, (fxrp6 * price18) / 1e6, "fxrp collateral value mismatch");
    }

    /// @dev wFLR branch: 18-dec collateral + 8-dec FLR/USD feed (both verified live on Coston2).
    ///      Verifies the full 8-dec-feed -> price18 -> 18-dec-collateral chain.
    function testFuzz_collateralValue_wflr(uint256 flrPriceRaw, uint256 wflr18) public {
        flrPriceRaw = bound(flrPriceRaw, 1, 1e12); // 8-dec FLR/USD (e.g. 2_000_000 = $0.02)
        wflr18 = bound(wflr18, 0, 1e24); // up to 1,000,000 wFLR
        _setFeedById(FLR_USD_FEED_ID, flrPriceRaw, 8, uint64(block.timestamp));

        uint256 price18 = flrOracle.price18();
        assertEq(price18, flrPriceRaw * 1e10, "8-dec feed -> 18-dec price"); // 18 - 8 = 10

        uint256 got = VulcraMath.collateralValueUsd18(wflr18, 18, price18);
        assertEq(got, (wflr18 * price18) / 1e18, "wflr collateral value mismatch");
    }

    /// @dev collateralForUsd18 is the (rounding-down) inverse of collateralValueUsd18, for either
    ///      collateral decimals (6 or 18).
    function testFuzz_roundTrip(uint256 value, uint256 amount, bool wide) public {
        value = bound(value, 1e4, 1e14);
        _setFeedById(XRP_USD_FEED_ID, value, 8, uint64(block.timestamp));
        uint256 price18 = xrpOracle.price18();

        uint8 dec = wide ? 18 : 6;
        amount = bound(amount, 10 ** dec, 1000 * (10 ** dec));

        uint256 usd18 = VulcraMath.collateralValueUsd18(amount, dec, price18);
        uint256 back = VulcraMath.collateralForUsd18(usd18, dec, price18);
        assertLe(back, amount, "round-trip must not inflate collateral");
    }

    /// @dev NICR ordering is price-independent: scaling both vaults' price does not reorder them.
    function testFuzz_nicrOrderingPriceInvariant(uint256 c1, uint256 d1, uint256 c2, uint256 d2) public pure {
        c1 = bound(c1, 1e6, 1e15);
        d1 = bound(d1, 1e18, 1e24);
        c2 = bound(c2, 1e6, 1e15);
        d2 = bound(d2, 1e18, 1e24);
        uint256 n1 = VulcraMath.nicr(c1, d1);
        uint256 n2 = VulcraMath.nicr(c2, d2);
        // Within a branch (same decimals + price), actual-CR ordering equals NICR ordering.
        uint256 p = 2.5e18;
        uint256 cr1 = VulcraMath.crBps(VulcraMath.collateralValueUsd18(c1, 6, p), d1);
        uint256 cr2 = VulcraMath.crBps(VulcraMath.collateralValueUsd18(c2, 6, p), d2);
        if (n1 < n2) assertLe(cr1, cr2, "NICR< implies CR<=");
        if (n1 > n2) assertGe(cr1, cr2, "NICR> implies CR>=");
    }
}
