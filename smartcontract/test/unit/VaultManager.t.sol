// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultTestSetup} from "../helpers/VaultTestSetup.sol";
import {VaultManager} from "../../src/VaultManager.sol";
import {IVaultManager} from "../../src/interfaces/IVaultManager.sol";

contract VaultManagerTest is VaultTestSetup {
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal zap = makeAddr("zap");

    function setUp() public {
        _deployStack();
    }

    function _supplyEqualsDebt() internal view {
        assertEq(vusd.totalSupply(), mgr.totalDebt(), "totalSupply == totalDebt");
    }

    function test_open_basic() public {
        _openVault(alice, 100e6, 100e18); // 100 FXRP, mint 100 vUSD
        (uint256 coll, uint256 debt, bool active) = mgr.getVault(alice);
        assertEq(coll, 100e6);
        assertEq(debt, 100.5e18); // 100 + 0.5% fee
        assertTrue(active);
        assertEq(vusd.balanceOf(alice), 100e18);
        assertEq(vusd.balanceOf(feeReceiver), 0.5e18);
        assertEq(mgr.totalDebt(), 100.5e18);
        _supplyEqualsDebt();
        // CR = 250/100.5 ~ 2487 bps*100 => 24875 bps
        assertApproxEqAbs(mgr.collateralRatioBps(alice), 24_875, 5);
    }

    function test_open_atExactMcr() public {
        // debt = 100.5e18; need collateralValue = 1.3 * 100.5e18 = 130.65e18; at $2.50 => 52.26 FXRP
        uint256 coll = 52_260_000; // 52.26e6
        _fundFxrp(alice, coll);
        vm.prank(alice);
        mgr.openVault(coll, 100e18, 500, address(0), address(0));
        assertEq(mgr.collateralRatioBps(alice), MCR_BPS);
    }

    function test_revert_open_belowMcr() public {
        uint256 coll = 52_260_000 - 1; // one drop less than exact-MCR
        _fundFxrp(alice, coll);
        vm.expectRevert(VaultManager.CRTooLow.selector);
        vm.prank(alice);
        mgr.openVault(coll, 100e18, 500, address(0), address(0));
    }

    function test_revert_open_debtBelowMin() public {
        _fundFxrp(alice, 100e6);
        vm.expectRevert(VaultManager.DebtBelowMin.selector);
        vm.prank(alice);
        mgr.openVault(100e6, 90e18, 500, address(0), address(0)); // debt 90.45 < 100
    }

    function test_revert_open_twice() public {
        _openVault(alice, 100e6, 100e18);
        _fundFxrp(alice, 100e6);
        vm.expectRevert(VaultManager.VaultExists.selector);
        vm.prank(alice);
        mgr.openVault(100e6, 100e18, 500, address(0), address(0));
    }

    function test_addCollateral() public {
        _openVault(alice, 100e6, 100e18);
        _fundFxrp(alice, 50e6);
        vm.prank(alice);
        mgr.addCollateral(50e6, address(0), address(0));
        (uint256 coll,,) = mgr.getVault(alice);
        assertEq(coll, 150e6);
        _supplyEqualsDebt();
    }

    function test_withdrawCollateral() public {
        _openVault(alice, 100e6, 100e18);
        vm.prank(alice);
        mgr.withdrawCollateral(20e6, address(0), address(0));
        (uint256 coll,,) = mgr.getVault(alice);
        assertEq(coll, 80e6);
        assertEq(fxrp.balanceOf(alice), 20e6);
    }

    function test_revert_withdraw_breaksMcr() public {
        _openVault(alice, 100e6, 100e18); // CR ~248%
        // withdraw enough to fall below 130%: keep < 52.26 FXRP
        vm.expectRevert(VaultManager.CRTooLow.selector);
        vm.prank(alice);
        mgr.withdrawCollateral(50e6, address(0), address(0)); // -> 50 FXRP < 52.26 needed
    }

    function test_mintMore() public {
        _openVault(alice, 100e6, 100e18); // debt 100.5, coll value 250
        vm.prank(alice);
        mgr.mintMore(50e18, address(0), address(0)); // +50 + 0.25 fee => debt 150.75
        (, uint256 debt,) = mgr.getVault(alice);
        assertEq(debt, 150.75e18);
        assertEq(vusd.balanceOf(alice), 150e18);
        _supplyEqualsDebt();
    }

    function test_revert_mintMore_breaksMcr() public {
        _openVault(alice, 100e6, 100e18); // coll value 250; MCR needs debt <= 250/1.3 = 192.3
        vm.expectRevert(VaultManager.CRTooLow.selector);
        vm.prank(alice);
        mgr.mintMore(100e18, address(0), address(0)); // debt -> ~200.5 > 192.3
    }

    function test_repay_partial() public {
        _openVault(alice, 100e6, 100e18); // debt 100.5, alice has 100 vUSD
        vm.prank(alice);
        mgr.repay(0.5e18, address(0), address(0)); // debt -> 100
        (, uint256 debt,) = mgr.getVault(alice);
        assertEq(debt, 100e18);
        _supplyEqualsDebt();
    }

    function test_revert_repay_leavesDust() public {
        _openVault(alice, 100e6, 100e18); // debt 100.5, minDebt 100
        vm.prank(alice);
        vm.expectRevert(VaultManager.DebtBelowMin.selector);
        mgr.repay(1e18, address(0), address(0)); // -> 99.5 < 100 minDebt (nonzero dust)
    }

    function test_closeVault() public {
        _openVault(alice, 100e6, 100e18); // debt 100.5; alice only holds 100 vUSD
        // give alice the 0.5 fee so she can fully repay+close
        vm.prank(feeReceiver);
        vusd.transfer(alice, 0.5e18);
        vm.prank(alice);
        mgr.closeVault();
        (,, bool active) = mgr.getVault(alice);
        assertFalse(active);
        assertEq(fxrp.balanceOf(alice), 100e6);
        assertEq(vusd.totalSupply(), 0);
        assertEq(mgr.totalDebt(), 0);
        assertEq(mgr.vaultCount(), 0);
    }

    function test_openVaultFor_ownershipAndRecipient() public {
        // zap-style: caller funds collateral, owner = alice, vUSD -> bob
        bytes32 zapRole = mgr.ZAP_ROLE();
        vm.prank(admin);
        mgr.grantRole(zapRole, zap);
        _fundFxrp(zap, 100e6);
        vm.prank(zap);
        mgr.openVaultFor(alice, 100e6, 100e18, 500, bob, address(0), address(0));
        (uint256 coll,, bool active) = mgr.getVault(alice);
        assertEq(coll, 100e6);
        assertTrue(active);
        assertEq(vusd.balanceOf(bob), 100e18); // debt recipient
        (,, bool zapActive) = mgr.getVault(zap);
        assertFalse(zapActive); // vault owned by alice, not the caller
        _supplyEqualsDebt();
    }

    function test_revert_openVaultFor_notZap() public {
        // openVaultFor is gated to ZAP_ROLE to prevent occupying a victim's vault slot
        _fundFxrp(zap, 100e6);
        vm.expectRevert();
        vm.prank(zap);
        mgr.openVaultFor(alice, 100e6, 100e18, 500, bob, address(0), address(0));
    }

    function test_redemptionQueue_orderedByRate() public {
        // V2: the sorted list is keyed by interest rate; lowest rate is redeemed first.
        _openVaultRate(alice, 100e6, 100e18, 800);
        _openVaultRate(bob, 100e6, 100e18, 300); // lower rate
        assertEq(mgr.lowestRateVault(), bob); // bob (rate 300) at the head of the redemption queue
        assertEq(mgr.highestRateVault(), alice);
        assertEq(mgr.annualInterestRateBpsOf(bob), 300);
    }

    function test_previewOpen() public view {
        (uint256 debt, uint256 crBps, bool meetsMcr, bool meetsMinDebt) = mgr.previewOpen(100e6, 100e18);
        assertEq(debt, 100.5e18);
        assertApproxEqAbs(crBps, 24_875, 5);
        assertTrue(meetsMcr);
        assertTrue(meetsMinDebt);
    }

    function test_setParams_paramAdmin() public {
        IVaultManager.Params memory p = IVaultManager.Params(14_000, 200e18, 100, 1_500, 50);
        vm.prank(admin);
        mgr.setParams(p);
        (uint256 mcr,,,,) = mgr.params();
        assertEq(mcr, 14_000);
    }

    function test_revert_setParams_notAdmin() public {
        IVaultManager.Params memory p = IVaultManager.Params(14_000, 200e18, 100, 1_500, 50);
        vm.expectRevert();
        vm.prank(alice);
        mgr.setParams(p);
    }

    function test_revert_setParams_invalid() public {
        IVaultManager.Params memory p = IVaultManager.Params(9_000, 200e18, 100, 1_500, 50); // mcr < 100%
        vm.prank(admin);
        vm.expectRevert(VaultManager.InvalidParams.selector);
        mgr.setParams(p);
    }

    function test_pause_blocksOpen() public {
        vm.prank(admin);
        mgr.pause();
        _fundFxrp(alice, 100e6);
        vm.expectRevert();
        vm.prank(alice);
        mgr.openVault(100e6, 100e18, 500, address(0), address(0));
    }
}
