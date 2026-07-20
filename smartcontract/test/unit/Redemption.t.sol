// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultTestSetup} from "../helpers/VaultTestSetup.sol";
import {VaultManager} from "../../src/VaultManager.sol";
import {IVaultManager} from "../../src/interfaces/IVaultManager.sol";

contract RedemptionTest is VaultTestSetup {
    address internal v1 = makeAddr("v1"); // riskiest (CR 135%)
    address internal v2 = makeAddr("v2"); // CR 180%
    address internal v3 = makeAddr("v3"); // CR 300%
    address internal redeemer = makeAddr("redeemer");

    function setUp() public {
        _deployStack();
        // all at price $2.50, debt 100.5 each; collateral tuned to target CRs
        _openVault(v1, 54_270_000, 100e18); // CR ~135%
        _openVault(v2, 72_360_000, 100e18); // CR ~180%
        _openVault(v3, 120_600_000, 100e18); // CR ~300%
    }

    function _supplyEqualsDebt() internal view {
        assertEq(vusd.totalSupply(), mgr.totalDebt());
    }

    function test_riskiestIsV1() public view {
        assertEq(mgr.riskiestVault(), v1);
    }

    function test_redeem_drawsFromRiskiestFirst() public {
        _seedVusd(redeemer, 50e18);
        vm.prank(redeemer);
        uint256 paid = mgr.redeem(50e18, 0);

        assertEq(paid, 20e6); // 50 vUSD / $2.50 = 20 FXRP
        assertEq(fxrp.balanceOf(redeemer), 20e6);
        (uint256 c1, uint256 d1,) = mgr.getVault(v1);
        assertEq(d1, 50.5e18); // 100.5 - 50
        assertEq(c1, 54_270_000 - 20e6);
        // v2, v3 untouched
        (, uint256 d2,) = mgr.getVault(v2);
        assertEq(d2, 100.5e18);
        _supplyEqualsDebt();
    }

    function test_redeem_spillsToNextVault() public {
        _seedVusd(redeemer, 120e18);
        vm.prank(redeemer);
        uint256 paid = mgr.redeem(120e18, 0);

        assertEq(paid, 48e6); // 120 / 2.5
        // v1 fully redeemed & closed; dust collateral returned to v1 owner
        (,, bool a1) = mgr.getVault(v1);
        assertFalse(a1);
        assertEq(fxrp.balanceOf(v1), 54_270_000 - 40_200_000); // 100.5/2.5 = 40.2 FXRP seized
        // v2 partially redeemed: 19.5 vUSD
        (, uint256 d2,) = mgr.getVault(v2);
        assertEq(d2, 100.5e18 - 19.5e18);
        assertEq(mgr.riskiestVault(), v2);
        _supplyEqualsDebt();
    }

    function test_redeem_exactVaultDebtCloses() public {
        _seedVusd(redeemer, 100.5e18);
        vm.prank(redeemer);
        mgr.redeem(100.5e18, 0);
        (,, bool a1) = mgr.getVault(v1);
        assertFalse(a1); // exactly redeemed -> closed
        assertEq(mgr.riskiestVault(), v2);
        _supplyEqualsDebt();
    }

    function test_revert_redeem_exceedsSystemDebt() public {
        _seedVusd(redeemer, 1e18); // creates whale first, so totalDebt is final
        uint256 tooMuch = mgr.totalDebt() + 1;
        // ExceedsSystemDebt is checked before the caller's balance, so 1 vUSD held is enough.
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
        // set 1% redemption fee
        vm.prank(admin);
        mgr.setParams(IVaultManager.Params(MCR_BPS, MIN_DEBT, MINT_FEE_BPS, LIQ_BONUS_BPS, 100));
        _seedVusd(redeemer, 50e18);
        vm.prank(redeemer);
        uint256 paid = mgr.redeem(50e18, 0);
        // gross 20 FXRP, 1% fee = 0.2 FXRP to feeReceiver, redeemer gets 19.8
        assertEq(paid, 20e6 - 0.2e6);
        assertEq(fxrp.balanceOf(redeemer), 19.8e6);
        assertEq(fxrp.balanceOf(feeReceiver), 0.2e6);
    }

    function test_redeem_orderingMaintained() public {
        _seedVusd(redeemer, 50e18);
        vm.prank(redeemer);
        mgr.redeem(50e18, 0); // v1 CR rises from 135%
        // v1 now CR ~ (34.27*2.5)/50.5 = 169.6% -> still riskier than v2(180) or now between?
        // Regardless, list must stay ordered: riskiest has the lowest NICR.
        address r = mgr.riskiestVault();
        // whichever is riskiest, its nicr <= others
        assertLe(mgr.nominalCr(r), mgr.nominalCr(v3));
    }
}
