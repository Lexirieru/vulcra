// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultTestSetup} from "../helpers/VaultTestSetup.sol";
import {VaultManager} from "../../src/VaultManager.sol";

contract LiquidationTest is VaultTestSetup {
    address internal alice = makeAddr("alice");
    address internal liquidator = makeAddr("liquidator");

    function setUp() public {
        _deployStack();
    }

    function _supplyEqualsDebt() internal view {
        assertEq(vusd.totalSupply(), mgr.totalDebt());
    }

    function test_liquidate_happy() public {
        _openVault(alice, 100e6, 100e18); // debt 100.5, CR ~248% at $2.50
        _seedVusd(liquidator, 200e18);
        _setPrice18(1.2e18); // collValue 120 -> CR ~119% < 130%

        assertTrue(mgr.isLiquidatable(alice));
        uint256 liqBefore = fxrp.balanceOf(liquidator);

        vm.prank(liquidator);
        mgr.liquidate(alice);

        // seize = 100.5 * 1.10 = 110.55 USD; at $1.20 => 92.125 FXRP; owner keeps remainder
        uint256 expectedSeize = (110.55e18 * 1e6) / 1.2e18; // 92_125_000
        assertEq(fxrp.balanceOf(liquidator) - liqBefore, expectedSeize);
        assertEq(fxrp.balanceOf(alice), 100e6 - expectedSeize);
        (,, bool active) = mgr.getVault(alice);
        assertFalse(active);
        _supplyEqualsDebt();
    }

    function test_revert_liquidate_healthy() public {
        _openVault(alice, 100e6, 100e18); // CR ~248% at $2.50
        _seedVusd(liquidator, 200e18);
        vm.prank(liquidator);
        vm.expectRevert(VaultManager.NotLiquidatable.selector);
        mgr.liquidate(alice);
    }

    function test_liquidate_atExactMcr_notLiquidatable() public {
        // open at exactly MCR (52.26 FXRP), price unchanged => CR == MCR (not < MCR)
        uint256 coll = 52_260_000;
        _fundFxrp(alice, coll);
        vm.prank(alice);
        mgr.openVault(coll, 100e18, address(0), address(0));
        assertEq(mgr.collateralRatioBps(alice), MCR_BPS);
        _seedVusd(liquidator, 200e18);
        vm.prank(liquidator);
        vm.expectRevert(VaultManager.NotLiquidatable.selector);
        mgr.liquidate(alice);
    }

    function test_liquidate_justBelowMcr() public {
        // open at exactly MCR, then nudge price down slightly so CR falls just below MCR
        _fundFxrp(alice, 52_260_000);
        vm.prank(alice);
        mgr.openVault(52_260_000, 100e18, address(0), address(0));
        _seedVusd(liquidator, 200e18);
        _setPrice18(2.49e18); // tiny drop -> just below MCR
        assertTrue(mgr.isLiquidatable(alice));
        vm.prank(liquidator);
        mgr.liquidate(alice);
        (,, bool active) = mgr.getVault(alice);
        assertFalse(active);
    }

    function test_liquidate_badDebt_seizesAllCollateral() public {
        _openVault(alice, 100e6, 100e18); // debt 100.5
        _seedVusd(liquidator, 200e18);
        _setPrice18(0.9e18); // collValue 90 < debt 100.5 => CR ~89.5% (bad debt)

        uint256 liqBefore = fxrp.balanceOf(liquidator);
        vm.prank(liquidator);
        mgr.liquidate(alice);

        // seize capped at all collateral; owner gets nothing
        assertEq(fxrp.balanceOf(liquidator) - liqBefore, 100e6);
        assertEq(fxrp.balanceOf(alice), 0);
        _supplyEqualsDebt();
    }

    function test_revert_liquidate_insufficientVusd() public {
        _openVault(alice, 100e6, 100e18);
        _setPrice18(1.2e18);
        // liquidator holds no vUSD -> burn reverts
        vm.prank(liquidator);
        vm.expectRevert();
        mgr.liquidate(alice);
    }

    function test_revert_liquidate_noVault() public {
        _seedVusd(liquidator, 200e18);
        vm.prank(liquidator);
        vm.expectRevert(VaultManager.NoVault.selector);
        mgr.liquidate(alice);
    }

    function test_liquidate_removesFromList() public {
        _openVault(alice, 100e6, 100e18);
        address bob = makeAddr("bob");
        _openVault(bob, 200e6, 100e18); // safer vault
        _seedVusd(liquidator, 200e18);
        _setPrice18(1.2e18);
        // alice is riskiest
        assertEq(mgr.riskiestVault(), alice);
        vm.prank(liquidator);
        mgr.liquidate(alice);
        assertEq(mgr.riskiestVault(), bob); // alice removed; bob now riskiest active
    }
}
