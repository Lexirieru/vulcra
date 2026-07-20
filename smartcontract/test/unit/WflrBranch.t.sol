// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VulcraTestBase} from "../helpers/VulcraTestBase.sol";
import {VulcraDeployerBase} from "../../script/VulcraDeployerBase.sol";
import {MockERC20} from "../helpers/MockERC20.sol";
import {VUSD} from "../../src/VUSD.sol";
import {VaultManager} from "../../src/VaultManager.sol";
import {IVaultManager} from "../../src/interfaces/IVaultManager.sol";

/// @notice Full CDP flow on the wFLR branch: 18-dec collateral + 8-dec FLR/USD feed (both verified
///         live on Coston2), exercising open / CR math / liquidation / debt ceiling.
contract WflrBranchTest is VulcraTestBase, VulcraDeployerBase {
    VUSD internal vusd;
    VaultManager internal mgr;
    MockERC20 internal wflr;
    address internal alice = makeAddr("alice");
    address internal liquidator = makeAddr("liquidator");

    uint256 internal constant CEILING = 10_000e18;

    function setUp() public {
        vm.warp(1_800_000_000);
        wflr = new MockERC20("Wrapped C2FLR", "WC2FLR", 18);
        _setFeedById(FLR_USD_FEED_ID, 2_000_000, 8, uint64(block.timestamp)); // $0.02 (8-dec)

        vusd = _deployVusd(address(this));
        // wFLR params: MCR 150%, minDebt 200; small ceiling to test the cap.
        IVaultManager.Params memory p = IVaultManager.Params({
            mcrBps: 15_000, minDebt18: 200e18, mintFeeBps: 50, liqBonusBps: 1_200, redemptionFeeBps: 0
        });
        Branch memory b = _deployBranch(
            address(this), vusd, address(wflr), 18, FLR_USD_FEED_ID, 3600, makeAddr("fee"), p, CEILING, false
        );
        mgr = b.manager;
    }

    function _fund(address u, uint256 amt18) internal {
        wflr.mint(u, amt18);
        vm.prank(u);
        wflr.approve(address(mgr), type(uint256).max);
    }

    function _setFlrPrice(uint256 price18) internal {
        _setFeedById(FLR_USD_FEED_ID, price18 / 1e10, 8, uint64(block.timestamp)); // to 8-dec raw
    }

    function test_collateralDecimals() public view {
        assertEq(mgr.collateralDecimals(), 18);
        assertEq(mgr.fxrp(), address(wflr)); // alias returns the branch collateral
    }

    function test_open_18decCollateral_crMath() public {
        // 30,000 wFLR @ $0.02 = $600 collateral; mint 300 vUSD -> debt 301.5; CR ~199%
        _fund(alice, 30_000e18);
        vm.prank(alice);
        mgr.openVault(30_000e18, 300e18, address(0), address(0));

        (uint256 coll, uint256 debt,) = mgr.getVault(alice);
        assertEq(coll, 30_000e18);
        assertEq(debt, 301.5e18);
        assertEq(vusd.balanceOf(alice), 300e18);
        // CR = collateralValueUsd18 * 10000 / debt = $600 * 10000 / 301.5 (runtime uint division)
        uint256 collVal = 600e18;
        uint256 debt_ = 301.5e18;
        assertApproxEqAbs(mgr.collateralRatioBps(alice), (collVal * 10_000) / debt_, 2);
        assertEq(vusd.totalSupply(), mgr.totalDebt());
    }

    function test_liquidate_18decCollateral() public {
        _fund(alice, 30_000e18);
        vm.prank(alice);
        mgr.openVault(30_000e18, 300e18, address(0), address(0)); // debt 301.5, CR ~199%
        // seed liquidator with vUSD via a whale
        _fund(liquidator, 100_000_000e18);
        vm.prank(liquidator);
        mgr.openVault(100_000_000e18, 300e18, address(0), address(0)); // whale, very safe
        vm.prank(liquidator);
        mgr.mintMore(400e18, address(0), address(0)); // liquidator now holds ~700 vUSD

        _setFlrPrice(0.012e18); // collValue 30000*0.012 = $360, CR ~119% < 150%
        assertTrue(mgr.isLiquidatable(alice));

        uint256 liqBefore = wflr.balanceOf(liquidator);
        vm.prank(liquidator);
        mgr.liquidate(alice);

        // seize = 301.5 * 1.12 = 337.68 USD at $0.012 => 28_140 wFLR (18-dec)
        uint256 seizeValue = 337.68e18;
        uint256 price = 0.012e18;
        uint256 expectedSeize = (seizeValue * 1e18) / price;
        assertEq(wflr.balanceOf(liquidator) - liqBefore, expectedSeize);
        (,, bool active) = mgr.getVault(alice);
        assertFalse(active);
        assertEq(vusd.totalSupply(), mgr.totalDebt());
    }

    function test_debtCeiling_enforced() public {
        // user1 mints 9000 (debt 9045) under the 10k ceiling
        _fund(alice, 1e24); // 1,000,000 wFLR = $20,000
        vm.prank(alice);
        mgr.openVault(1e24, 9000e18, address(0), address(0));
        assertEq(mgr.totalDebt(), 9045e18);

        // user2 minting 2000 would push total to 11,055 > 10,000 ceiling -> revert
        address bob = makeAddr("bob");
        _fund(bob, 1e24);
        vm.prank(bob);
        vm.expectRevert(VaultManager.DebtCeilingExceeded.selector);
        mgr.openVault(1e24, 2000e18, address(0), address(0));
    }

    function test_setDebtCeiling_admin() public {
        vm.prank(address(this)); // admin
        mgr.setDebtCeiling(0); // lift the cap
        _fund(alice, 1e26);
        vm.prank(alice);
        mgr.openVault(1e26, 50_000e18, address(0), address(0)); // now allowed above old cap
        assertEq(mgr.totalDebt(), 50_250e18);
    }
}
