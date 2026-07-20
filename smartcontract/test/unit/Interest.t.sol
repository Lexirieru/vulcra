// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultTestSetup} from "../helpers/VaultTestSetup.sol";
import {VaultManager} from "../../src/VaultManager.sol";

/// @notice V2 interest accrual: continuous accrual, settlement/minting, adjustInterestRate, bounds,
///         and the aggregate-vs-per-vault reconciliation — all exercised with vm.warp.
contract InterestTest is VaultTestSetup {
    address internal alice = makeAddr("alice");
    address internal a = makeAddr("a");
    address internal b = makeAddr("b");
    address internal c = makeAddr("c");

    function setUp() public {
        _deployStack();
    }

    function test_accrual_growsEntireDebtOverTime() public {
        _openVaultRate(alice, 1000e6, 1000e18, 1000); // rate 10%/yr; debt = 1005 (0.5% fee)
        (, uint256 d0,) = mgr.getVault(alice);
        assertEq(d0, 1005e18);

        vm.warp(block.timestamp + 365 days);
        _setXrpPrice(2.5e18, 18); // FTSO keeps a fresh timestamp as time passes
        // entire debt = 1005 * (1 + 10%) = 1105.5
        assertEq(mgr.getTroveEntireDebt(alice), 1105.5e18);
        (, uint256 dv,) = mgr.getVault(alice);
        assertEq(dv, 1105.5e18); // getVault reflects accrued interest
        // CR fell as debt grew (still healthy here)
        assertLt(mgr.collateralRatioBps(alice), 24_875);
    }

    function test_settle_mintsInterestToReceiver() public {
        _openVaultRate(alice, 1000e6, 1000e18, 1000);
        uint256 supply0 = vusd.totalSupply();
        uint256 recv0 = vusd.balanceOf(interestReceiver);

        vm.warp(block.timestamp + 365 days);
        uint256 pending = mgr.pendingAggInterest();
        assertEq(pending, 100.5e18); // 1005 * 10%

        mgr.mintInterest(); // permissionless settle
        assertEq(vusd.totalSupply(), supply0 + pending);
        assertEq(vusd.balanceOf(interestReceiver), recv0 + pending); // yield to interestReceiver
        assertEq(vusd.totalSupply(), mgr.totalDebt()); // strong invariant, exact
        assertEq(mgr.pendingAggInterest(), 0); // settled
        assertEq(mgr.getEntireSystemDebt(), mgr.totalDebt());
    }

    /// @dev The critical invariant: after settling, VUSD supply == recorded system debt (which now
    ///      includes all accrued interest), holding across warps and multiple rates.
    function test_supplyEqualsSystemDebt_afterWarpAndSettle() public {
        _openVaultRate(a, 1000e6, 1000e18, 500);
        _openVaultRate(b, 3000e6, 1500e18, 1500);
        _openVaultRate(c, 2000e6, 200e18, 100);

        vm.warp(block.timestamp + 200 days);
        mgr.mintInterest();

        // exact: supply == recorded debt (interest realized)
        assertEq(vusd.totalSupply(), mgr.totalDebt());
        assertEq(mgr.getEntireSystemDebt(), mgr.totalDebt());
        // per-vault entire-debt sum matches within integer-division rounding (a few wei)
        uint256 sum = mgr.getTroveEntireDebt(a) + mgr.getTroveEntireDebt(b) + mgr.getTroveEntireDebt(c);
        assertApproxEqAbs(vusd.totalSupply(), sum, 10);
    }

    /// @dev The O(1) aggregate matches the O(n) per-vault sum even BEFORE settling.
    function test_aggregateMatchesPerVaultSum_beforeSettle() public {
        _openVaultRate(a, 1000e6, 1000e18, 500);
        _openVaultRate(b, 3000e6, 1500e18, 1500);
        vm.warp(block.timestamp + 123 days);
        uint256 sum = mgr.getTroveEntireDebt(a) + mgr.getTroveEntireDebt(b);
        assertApproxEqAbs(mgr.getEntireSystemDebt(), sum, 5);
    }

    function test_adjustInterestRate_foldsAndMoves() public {
        _openVaultRate(alice, 1000e6, 1000e18, 500);
        vm.warp(block.timestamp + 100 days);

        vm.prank(alice);
        mgr.adjustInterestRate(1500, address(0), address(0));
        assertEq(mgr.annualInterestRateBpsOf(alice), 1500);
        (, uint256 d,) = mgr.getVault(alice);
        assertGt(d, 1005e18); // accrued interest folded into recorded debt
        assertEq(vusd.totalSupply(), mgr.totalDebt()); // settle kept the invariant
    }

    function test_adjustInterestRate_movesQueuePosition() public {
        _openVaultRate(a, 1000e6, 1000e18, 500);
        _openVaultRate(b, 1000e6, 1000e18, 1000);
        assertEq(mgr.lowestRateVault(), a); // rate 500 is lowest -> redeemed first

        vm.prank(a);
        mgr.adjustInterestRate(2000, address(0), address(0)); // a -> highest
        assertEq(mgr.lowestRateVault(), b); // b (1000) now lowest
        assertEq(mgr.highestRateVault(), a);
    }

    function test_revert_rateOutOfBounds_open() public {
        _fundFxrp(alice, 1000e6);
        vm.prank(alice);
        vm.expectRevert(VaultManager.InterestRateOutOfBounds.selector);
        mgr.openVault(1000e6, 1000e18, MAX_RATE + 1, address(0), address(0));
    }

    function test_revert_rateOutOfBounds_adjust() public {
        _openVaultRate(alice, 1000e6, 1000e18, 500);
        vm.prank(alice);
        vm.expectRevert(VaultManager.InterestRateOutOfBounds.selector);
        mgr.adjustInterestRate(MIN_RATE - 1, address(0), address(0));
    }

    function test_repay_paysDownAccruedInterest() public {
        _openVaultRate(alice, 1000e6, 1000e18, 1000); // debt 1005
        vm.warp(block.timestamp + 365 days); // +100.5 interest -> entire 1105.5
        vm.prank(alice);
        mgr.repay(500e18, address(0), address(0)); // alice holds 1000 vUSD
        (, uint256 d,) = mgr.getVault(alice);
        assertEq(d, 605.5e18); // 1105.5 - 500
        assertEq(vusd.totalSupply(), mgr.totalDebt());
    }

    function test_liquidation_usesEntireDebt() public {
        _openVaultRate(alice, 100e6, 100e18, 2000); // 20%/yr; debt 100.5, CR ~248% at $2.50
        // accrue a lot of interest so CR degrades over time even at constant price
        vm.warp(block.timestamp + 365 days); // entire debt ~120.6
        // drop price so CR < MCR against the (grown) entire debt
        _setPrice18(1.6e18); // 100 FXRP -> $160; entire ~120.6 -> CR ~132% (still > 130? tune)
        _setPrice18(1.5e18); // $150 / 120.6 ~ 124% < 130%
        assertTrue(mgr.isLiquidatable(alice));

        _seedVusd(makeAddr("liq"), 200e18);
        vm.prank(makeAddr("liq"));
        mgr.liquidate(alice);
        (,, bool active) = mgr.getVault(alice);
        assertFalse(active);
        assertEq(vusd.totalSupply(), mgr.totalDebt());
    }

    function test_fuzz_accrualMonotonic(uint256 rate, uint256 dt) public {
        rate = bound(rate, MIN_RATE, MAX_RATE);
        dt = bound(dt, 1, 5 * 365 days);
        _openVaultRate(alice, 1e12, 1000e18, rate); // huge collateral so it stays healthy
        uint256 d0 = mgr.getTroveEntireDebt(alice);
        vm.warp(block.timestamp + dt);
        uint256 d1 = mgr.getTroveEntireDebt(alice);
        assertGe(d1, d0, "debt never shrinks from accrual");
        // settle realizes it into supply, keeping the exact invariant
        mgr.mintInterest();
        assertEq(vusd.totalSupply(), mgr.totalDebt());
    }
}
