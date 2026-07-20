// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultTestSetup} from "../helpers/VaultTestSetup.sol";
import {VaultManager} from "../../src/VaultManager.sol";

contract DelegatedRepayTest is VaultTestSetup {
    address internal alice = makeAddr("alice");
    address internal guardian = makeAddr("guardian"); // TEE executor
    address internal funderAcct = makeAddr("funderAcct");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        _deployStack();
        bytes32 role = mgr.GUARDIAN_EXECUTOR_ROLE();
        vm.prank(admin);
        mgr.grantRole(role, guardian);

        // alice: 700 FXRP, mint 1000 vUSD => debt 1005, CR ~174% at $2.50
        _openVault(alice, 700e6, 1000e18);
        vm.prank(alice);
        vusd.approve(address(mgr), type(uint256).max); // funder allowance (default funder = owner)
    }

    function _supplyEqualsDebt() internal view {
        assertEq(vusd.totalSupply(), mgr.totalDebt());
    }

    function test_delegatedRepay_happy() public {
        uint256 crBefore = mgr.collateralRatioBps(alice);
        vm.prank(guardian);
        mgr.delegatedRepay(alice, 100e18, address(0), address(0));

        (, uint256 debt,) = mgr.getVault(alice);
        assertEq(debt, 905e18);
        assertEq(vusd.balanceOf(alice), 900e18); // 1000 - 100 pulled
        assertGt(mgr.collateralRatioBps(alice), crBefore); // strictly CR-improving
        _supplyEqualsDebt();
    }

    /// @dev AE3: private trigger 150%. Price pushes CR below 150% but above MCR; the TEE repays and
    ///      the vault returns above trigger — the rule was never on-chain before execution.
    function test_AE3_restoresAboveTrigger() public {
        _setPrice18(2.0e18); // collValue 1400 -> CR ~139% (< 150% trigger, > 130% MCR)
        assertLt(mgr.collateralRatioBps(alice), 15_000);
        assertGt(mgr.collateralRatioBps(alice), MCR_BPS);

        vm.prank(guardian);
        mgr.delegatedRepay(alice, 75e18, address(0), address(0)); // debt 1005 -> 930

        assertGt(mgr.collateralRatioBps(alice), 15_000, "back above 150% trigger");
        _supplyEqualsDebt();
    }

    function test_revert_notGuardian() public {
        vm.prank(stranger);
        vm.expectRevert();
        mgr.delegatedRepay(alice, 100e18, address(0), address(0));
    }

    function test_maxAmount_clampedToDebt() public {
        _seedVusd(alice, 5e18); // give alice the fee portion so full repay is fundable
        vm.prank(guardian);
        mgr.delegatedRepay(alice, 5000e18, address(0), address(0)); // way over debt
        (, uint256 debt,) = mgr.getVault(alice);
        assertEq(debt, 0); // repaid full 1005 only
        _supplyEqualsDebt();
    }

    function test_clampDustToFullRepay() public {
        _seedVusd(alice, 5e18);
        // repay 950 would leave 55 (< minDebt 100) -> clamp to full repay
        vm.prank(guardian);
        mgr.delegatedRepay(alice, 950e18, address(0), address(0));
        (, uint256 debt,) = mgr.getVault(alice);
        assertEq(debt, 0);
    }

    function test_revert_funderInsufficientAllowance() public {
        // alice lowers allowance below the repay amount
        vm.prank(alice);
        vusd.approve(address(mgr), 50e18);
        vm.prank(guardian);
        vm.expectRevert(VaultManager.FunderInsufficient.selector);
        mgr.delegatedRepay(alice, 100e18, address(0), address(0));
    }

    function test_revert_funderInsufficientBalance() public {
        // move alice's vUSD away so balance < repay amount
        vm.prank(alice);
        vusd.transfer(stranger, 1000e18);
        vm.prank(guardian);
        vm.expectRevert(VaultManager.FunderInsufficient.selector);
        mgr.delegatedRepay(alice, 100e18, address(0), address(0));
    }

    function test_nominatedFunder() public {
        // alice nominates funderAcct; funderAcct holds + approves vUSD
        vm.prank(alice);
        mgr.setGuardianFunder(funderAcct);
        _seedVusd(funderAcct, 200e18);
        vm.prank(funderAcct);
        vusd.approve(address(mgr), type(uint256).max);

        uint256 aliceBalBefore = vusd.balanceOf(alice);
        vm.prank(guardian);
        mgr.delegatedRepay(alice, 100e18, address(0), address(0));

        (, uint256 debt,) = mgr.getVault(alice);
        assertEq(debt, 905e18);
        assertEq(vusd.balanceOf(alice), aliceBalBefore); // alice's vUSD untouched
        assertEq(vusd.balanceOf(funderAcct), 100e18); // 200 - 100 pulled from funder
        _supplyEqualsDebt();
    }

    function test_revert_noVault() public {
        vm.prank(guardian);
        vm.expectRevert(VaultManager.NoVault.selector);
        mgr.delegatedRepay(stranger, 100e18, address(0), address(0));
    }

    function test_confidentiality_noStateBeforeExecution() public view {
        // No on-chain trigger/rule is stored: guardianFunder defaults to zero (owner) and nothing
        // reveals a protection threshold. Only the DelegatedRepay event (at execution) is observable.
        assertEq(mgr.guardianFunder(alice), address(0));
    }
}
