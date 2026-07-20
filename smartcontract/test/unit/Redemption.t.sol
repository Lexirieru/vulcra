// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultTestSetup} from "../helpers/VaultTestSetup.sol";
import {VaultManager} from "../../src/VaultManager.sol";
import {IVaultManager} from "../../src/interfaces/IVaultManager.sol";

/// @notice V2 redemption is ordered by ANNUAL INTEREST RATE (lowest first), not by CR.
contract RedemptionTest is VaultTestSetup {
    address internal v1 = makeAddr("v1"); // rate 100 bps (lowest) -> redeemed first
    address internal v2 = makeAddr("v2"); // rate 500 bps
    address internal v3 = makeAddr("v3"); // rate 1000 bps (highest of the three)
    address internal redeemer = makeAddr("redeemer");
    address internal funder = makeAddr("funder");

    function setUp() public {
        _deployStack();
        // Same collateral/debt; only the interest rate differs -> that alone sets redemption order.
        _openVaultRate(v1, 100e6, 100e18, 100); // debt 100.5, CR ~248%
        _openVaultRate(v2, 100e6, 100e18, 500);
        _openVaultRate(v3, 100e6, 100e18, 1000);
    }

    /// @dev Fund the redeemer from a MAX-rate vault so it sits at the tail of the queue (redeemed
    ///      last) and never interferes with these scenarios.
    function _fundRedeemer(uint256 amount18) internal {
        (,, bool active) = mgr.getVault(funder);
        if (!active) {
            _openVaultRate(funder, 1e13, 100_000e18, MAX_RATE); // huge, highest rate
        }
        vm.prank(funder);
        vusd.transfer(redeemer, amount18);
    }

    function _supplyEqualsDebt() internal view {
        assertEq(vusd.totalSupply(), mgr.totalDebt());
    }

    function test_lowestRateIsRedeemedFirst() public view {
        assertEq(mgr.redemptionQueueHead(), v1);
        assertEq(mgr.lowestRateVault(), v1);
    }

    function test_redeem_drawsFromLowestRateFirst() public {
        _fundRedeemer(50e18);
        vm.prank(redeemer);
        uint256 paid = mgr.redeem(50e18, 0);

        assertEq(paid, 20e6); // 50 vUSD / $2.50 = 20 FXRP
        assertEq(fxrp.balanceOf(redeemer), 20e6);
        (uint256 c1, uint256 d1,) = mgr.getVault(v1);
        assertEq(d1, 50.5e18); // 100.5 - 50
        assertEq(c1, 100e6 - 20e6);
        // v2, v3 untouched (higher rate)
        (, uint256 d2,) = mgr.getVault(v2);
        assertEq(d2, 100.5e18);
        _supplyEqualsDebt();
    }

    function test_redeem_spillsToNextRate() public {
        _fundRedeemer(120e18);
        vm.prank(redeemer);
        uint256 paid = mgr.redeem(120e18, 0);

        assertEq(paid, 48e6); // 120 / 2.5
        // v1 (rate 100) fully redeemed & closed; dust collateral returned to v1
        (,, bool a1) = mgr.getVault(v1);
        assertFalse(a1);
        assertEq(fxrp.balanceOf(v1), 100e6 - 40_200_000); // 100.5/2.5 = 40.2 FXRP seized
        // v2 (rate 500) partially redeemed by 19.5
        (, uint256 d2,) = mgr.getVault(v2);
        assertEq(d2, 100.5e18 - 19.5e18);
        // queue head now v2 (next-lowest rate)
        assertEq(mgr.redemptionQueueHead(), v2);
        _supplyEqualsDebt();
    }

    function test_redeem_exactVaultDebtCloses() public {
        _fundRedeemer(100.5e18);
        vm.prank(redeemer);
        mgr.redeem(100.5e18, 0);
        (,, bool a1) = mgr.getVault(v1);
        assertFalse(a1); // exactly redeemed -> closed
        assertEq(mgr.redemptionQueueHead(), v2);
        _supplyEqualsDebt();
    }

    function test_revert_redeem_exceedsSystemDebt() public {
        _fundRedeemer(1e18); // creates funder so totalDebt is final
        uint256 tooMuch = mgr.totalDebt() + 1;
        vm.prank(redeemer);
        vm.expectRevert(VaultManager.ExceedsSystemDebt.selector);
        mgr.redeem(tooMuch, 0);
    }

    function test_revert_redeem_zero() public {
        vm.prank(redeemer);
        vm.expectRevert(VaultManager.ZeroAmount.selector);
        mgr.redeem(0, 0);
    }

    function test_redeem_withFee() public {
        vm.prank(admin);
        mgr.setParams(IVaultManager.Params(MCR_BPS, MIN_DEBT, MINT_FEE_BPS, LIQ_BONUS_BPS, 100)); // 1% fee
        _fundRedeemer(50e18);
        vm.prank(redeemer);
        uint256 paid = mgr.redeem(50e18, 0);
        // gross 20 FXRP, 1% fee = 0.2 FXRP to feeReceiver
        assertEq(paid, 20e6 - 0.2e6);
        assertEq(fxrp.balanceOf(redeemer), 19.8e6);
        assertEq(fxrp.balanceOf(feeReceiver), 0.2e6);
    }

    function test_redeem_orderingMaintainedByRate() public {
        _fundRedeemer(50e18);
        vm.prank(redeemer);
        mgr.redeem(50e18, 0); // redeems from v1 (rate unchanged)
        // v1 still lowest rate (100) -> still queue head
        assertEq(mgr.redemptionQueueHead(), v1);
        assertEq(mgr.annualInterestRateBpsOf(v1), 100);
    }
}
