// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VulcraTestBase} from "../helpers/VulcraTestBase.sol";
import {MockERC20} from "../helpers/MockERC20.sol";
import {VulcraDeployerBase} from "../../script/VulcraDeployerBase.sol";
import {Coston2Config} from "../../script/config/Coston2Config.sol";
import {VUSD} from "../../src/VUSD.sol";
import {VaultManager} from "../../src/VaultManager.sol";

/// @notice Multi-branch deploy wiring, exercising the exact shared deploy sequence the script uses
///         (VulcraDeployerBase): one shared VUSD + FXRP branch (6-dec, +Zap) + wFLR branch (18-dec).
contract DeployWiringTest is VulcraTestBase, VulcraDeployerBase {
    address internal feeReceiver = makeAddr("feeReceiver");
    MockERC20 internal fxrp;
    MockERC20 internal wflr;
    VUSD internal vusd;
    Branch internal fxrpB;
    Branch internal wflrB;

    function setUp() public {
        vm.warp(1_800_000_000);
        fxrp = new MockERC20("Test FXRP", "FXRP", 6);
        wflr = new MockERC20("Wrapped C2FLR", "WC2FLR", 18);
        _setFeedById(XRP_USD_FEED_ID, 2.5e18, 18, uint64(block.timestamp)); // XRP $2.50
        _setFeedById(FLR_USD_FEED_ID, 2_000_000, 8, uint64(block.timestamp)); // FLR $0.02 (8-dec)

        vusd = _deployVusd(address(this));
        fxrpB = _deployBranch(
            address(this),
            vusd,
            address(fxrp),
            6,
            XRP_USD_FEED_ID,
            3600,
            feeReceiver,
            Coston2Config.fxrpParams(),
            0,
            true
        );
        wflrB = _deployBranch(
            address(this),
            vusd,
            address(wflr),
            18,
            FLR_USD_FEED_ID,
            3600,
            feeReceiver,
            Coston2Config.wflrParams(),
            Coston2Config.WFLR_DEBT_CEILING,
            false
        );
    }

    function test_sharedVusd_bothBranchesAreMinters() public view {
        assertTrue(vusd.hasRole(vusd.MINTER_ROLE(), address(fxrpB.manager)), "FXRP branch is minter");
        assertTrue(vusd.hasRole(vusd.MINTER_ROLE(), address(wflrB.manager)), "wFLR branch is minter");
        // Same shared vUSD wired into both.
        assertEq(fxrpB.manager.vusd(), address(vusd));
        assertEq(wflrB.manager.vusd(), address(vusd));
    }

    function test_branchConfigDiffers() public view {
        assertEq(fxrpB.manager.fxrp(), address(fxrp));
        assertEq(fxrpB.manager.collateralDecimals(), 6);
        assertEq(wflrB.manager.fxrp(), address(wflr)); // alias returns wFLR on the wFLR branch
        assertEq(wflrB.manager.collateralDecimals(), 18);

        (uint256 mcrF, uint256 minF,,,) = fxrpB.manager.params();
        (uint256 mcrW, uint256 minW,,,) = wflrB.manager.params();
        assertEq(mcrF, 13_000);
        assertEq(mcrW, 15_000); // wFLR has a higher MCR
        assertEq(minF, 100e18);
        assertEq(minW, 200e18); // different min debt per branch
        assertEq(fxrpB.manager.debtCeiling(), 0); // unlimited
        assertEq(wflrB.manager.debtCeiling(), Coston2Config.WFLR_DEBT_CEILING);
    }

    function test_zapOnlyOnFxrpBranch() public view {
        assertTrue(address(fxrpB.zap) != address(0), "FXRP branch has a Zap");
        assertTrue(fxrpB.manager.hasRole(fxrpB.manager.ZAP_ROLE(), address(fxrpB.zap)));
        assertEq(address(wflrB.zap), address(0), "wFLR branch has no Zap");
    }

    /// @dev The key multi-branch invariant: shared VUSD supply == sum of per-branch debt.
    function test_sharedSupplyEqualsSumOfBranchDebts() public {
        _openIn(fxrpB.manager, fxrp, address(0x111), 100e6, 100e18); // 100 FXRP @ $2.50, mint 100
        _openIn(wflrB.manager, wflr, address(0x222), 20_000e18, 200e18); // 20k wFLR @ $0.02, mint 200

        assertEq(vusd.balanceOf(address(0x111)), 100e18);
        assertEq(vusd.balanceOf(address(0x222)), 200e18);
        assertEq(
            vusd.totalSupply(),
            fxrpB.manager.totalDebt() + wflrB.manager.totalDebt(),
            "VUSD.totalSupply() == sum of branch debts"
        );
    }

    function _openIn(VaultManager m, MockERC20 tok, address user, uint256 coll, uint256 mint) internal {
        tok.mint(user, coll);
        vm.prank(user);
        tok.approve(address(m), coll);
        vm.prank(user);
        m.openVault(coll, mint, address(0), address(0));
    }
}
