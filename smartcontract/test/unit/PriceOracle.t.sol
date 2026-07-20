// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VulcraTestBase} from "../helpers/VulcraTestBase.sol";
import {PriceOracle} from "../../src/PriceOracle.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

contract PriceOracleTest is VulcraTestBase {
    PriceOracle internal oracle;
    address internal admin = makeAddr("admin");
    address internal stranger = makeAddr("stranger");
    uint64 internal constant STALENESS = 3600;

    function setUp() public {
        vm.warp(1_800_000_000); // deterministic, well past epoch
        PriceOracle impl = new PriceOracle();
        oracle = PriceOracle(
            _deployProxy(address(impl), abi.encodeCall(PriceOracle.initialize, (admin, XRP_USD_FEED_ID, STALENESS)))
        );
    }

    function test_initialState() public view {
        assertEq(oracle.feedId(), XRP_USD_FEED_ID);
        assertEq(oracle.maxStalenessSeconds(), STALENESS);
        assertTrue(oracle.hasRole(oracle.DEFAULT_ADMIN_ROLE(), admin));
    }

    function test_price_8decimals() public {
        _setXrpPrice(284_000_000, 8); // $2.84
        assertEq(oracle.xrpUsdPrice18(), 2.84e18);
        assertEq(oracle.collateralValueUsd18(1e6), 2.84e18); // 1 FXRP -> $2.84
        assertEq(oracle.collateralForUsd18(2.84e18), 1e6); // $2.84 -> 1 FXRP
    }

    function test_price_18decimals() public {
        _setXrpPrice(2.84e18, 18);
        assertEq(oracle.xrpUsdPrice18(), 2.84e18);
    }

    function test_price_0decimals() public {
        _setXrpPrice(3, 0);
        assertEq(oracle.xrpUsdPrice18(), 3e18);
    }

    function test_price_decimalsAbove18_divides() public {
        // value 2_840000000000000000000000 with 24 decimals == 2.84
        _setXrpPrice(2_840_000 * 1e18, 24);
        assertEq(oracle.xrpUsdPrice18(), 2.84e18);
    }

    function test_collateralValue_zeroAmount() public {
        _setXrpPrice(284_000_000, 8);
        assertEq(oracle.collateralValueUsd18(0), 0);
    }

    function test_revert_zeroPrice() public {
        _setXrpPrice(0, 8);
        vm.expectRevert(PriceOracle.ZeroPrice.selector);
        oracle.xrpUsdPrice18();
    }

    function test_revert_stalePrice() public {
        _setFeed(284_000_000, 8, uint64(block.timestamp - STALENESS - 1));
        vm.expectRevert();
        oracle.xrpUsdPrice18();
    }

    function test_freshAtExactBound() public {
        _setFeed(284_000_000, 8, uint64(block.timestamp - STALENESS));
        assertEq(oracle.xrpUsdPrice18(), 2.84e18); // exactly at the bound is still fresh
    }

    function test_futureTimestampTreatedFresh() public {
        _setFeed(284_000_000, 8, uint64(block.timestamp + 100));
        assertEq(oracle.xrpUsdPrice18(), 2.84e18);
    }

    function test_setMaxStaleness_paramAdmin() public {
        vm.prank(admin);
        oracle.setMaxStalenessSeconds(7200);
        assertEq(oracle.maxStalenessSeconds(), 7200);
    }

    function test_revert_setMaxStaleness_notParamAdmin() public {
        vm.expectRevert();
        vm.prank(stranger);
        oracle.setMaxStalenessSeconds(7200);
    }

    function test_revert_setMaxStaleness_zero() public {
        vm.prank(admin);
        vm.expectRevert(PriceOracle.InvalidStaleness.selector);
        oracle.setMaxStalenessSeconds(0);
    }

    function test_revert_upgrade_notUpgrader() public {
        address newImpl = address(new PriceOracle());
        vm.expectRevert();
        vm.prank(stranger);
        oracle.upgradeToAndCall(newImpl, "");
    }
}
