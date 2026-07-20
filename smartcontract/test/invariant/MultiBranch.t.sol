// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VulcraTestBase} from "../helpers/VulcraTestBase.sol";
import {VulcraDeployerBase} from "../../script/VulcraDeployerBase.sol";
import {Coston2Config} from "../../script/config/Coston2Config.sol";
import {MockERC20} from "../helpers/MockERC20.sol";
import {VUSD} from "../../src/VUSD.sol";
import {VaultManager} from "../../src/VaultManager.sol";

/// @notice Randomized operations across TWO branches (FXRP 6-dec + wFLR 18-dec) sharing one vUSD,
///         including price moves, liquidation, and redemption on each branch.
contract MultiBranchHandler is VulcraTestBase {
    VaultManager internal fxrpMgr;
    VaultManager internal wflrMgr;
    VUSD internal vusd;
    MockERC20 internal fxrp;
    MockERC20 internal wflr;
    address[] internal actors;

    uint256 internal xrpPrice18 = 2.5e18;
    uint256 internal flrPrice18 = 0.02e18;

    constructor(VaultManager _fxrpMgr, VaultManager _wflrMgr, VUSD _vusd, MockERC20 _fxrp, MockERC20 _wflr) {
        fxrpMgr = _fxrpMgr;
        wflrMgr = _wflrMgr;
        vusd = _vusd;
        fxrp = _fxrp;
        wflr = _wflr;
        for (uint256 i; i < 5; i++) {
            address a = address(uint160(0xA000 + i));
            actors.push(a);
            fxrp.mint(a, 1e15); // 1e9 FXRP
            wflr.mint(a, 1e27); // 1e9 wFLR
            vm.startPrank(a);
            fxrp.approve(address(fxrpMgr), type(uint256).max);
            wflr.approve(address(wflrMgr), type(uint256).max);
            vm.stopPrank();
        }
        // whale (actor 0) opens a large vault in each branch to hold vUSD for liq/redeem
        vm.prank(actors[0]);
        fxrpMgr.openVault(1e13, 100_000e18, address(0), address(0)); // 10M FXRP
        vm.prank(actors[0]);
        wflrMgr.openVault(1e25, 100_000e18, address(0), address(0)); // 10M wFLR @ $0.02 = $200k
    }

    function _a(uint256 s) internal view returns (address) {
        return actors[1 + (s % (actors.length - 1))];
    }

    function movePriceXrp(uint256 p) external {
        xrpPrice18 = bound(p, 0.5e18, 5e18);
        _setFeedById(XRP_USD_FEED_ID, xrpPrice18, 18, uint64(block.timestamp));
    }

    function movePriceFlr(uint256 p) external {
        flrPrice18 = bound(p, 0.005e18, 0.1e18);
        // express via an 8-dec feed value: raw = price18 / 10^(18-8)
        _setFeedById(FLR_USD_FEED_ID, flrPrice18 / 1e10, 8, uint64(block.timestamp));
    }

    function openFxrp(uint256 s, uint256 mint) external {
        address a = _a(s);
        (,, bool active) = fxrpMgr.getVault(a);
        if (active) return;
        mint = bound(mint, 100e18, 1e21);
        vm.prank(a);
        try fxrpMgr.openVault((mint * 20) / 1e13, mint, address(0), address(0)) {} catch {}
    }

    function openWflr(uint256 s, uint256 mint) external {
        address a = _a(s);
        (,, bool active) = wflrMgr.getVault(a);
        if (active) return;
        mint = bound(mint, 200e18, 1e21);
        vm.prank(a);
        try wflrMgr.openVault(mint * 300, mint, address(0), address(0)) {} catch {} // generous coll
    }

    function repayFxrp(uint256 s, uint256 amt) external {
        address a = _a(s);
        uint256 bal = vusd.balanceOf(a);
        if (bal == 0) return;
        vm.prank(a);
        try fxrpMgr.repay(bound(amt, 1, bal), address(0), address(0)) {} catch {}
    }

    function repayWflr(uint256 s, uint256 amt) external {
        address a = _a(s);
        uint256 bal = vusd.balanceOf(a);
        if (bal == 0) return;
        vm.prank(a);
        try wflrMgr.repay(bound(amt, 1, bal), address(0), address(0)) {} catch {}
    }

    function liquidateFxrp(uint256 s) external {
        address a = _a(s);
        if (!fxrpMgr.isLiquidatable(a)) return;
        vm.prank(actors[0]);
        try fxrpMgr.liquidate(a) {} catch {}
    }

    function liquidateWflr(uint256 s) external {
        address a = _a(s);
        if (!wflrMgr.isLiquidatable(a)) return;
        vm.prank(actors[0]);
        try wflrMgr.liquidate(a) {} catch {}
    }

    function redeemFxrp(uint256 amt) external {
        uint256 td = fxrpMgr.totalDebt();
        uint256 bal = vusd.balanceOf(actors[0]);
        if (td == 0 || bal == 0) return;
        vm.prank(actors[0]);
        try fxrpMgr.redeem(bound(amt, 1, bal < td ? bal : td), 0) {} catch {}
    }

    function redeemWflr(uint256 amt) external {
        uint256 td = wflrMgr.totalDebt();
        uint256 bal = vusd.balanceOf(actors[0]);
        if (td == 0 || bal == 0) return;
        vm.prank(actors[0]);
        try wflrMgr.redeem(bound(amt, 1, bal < td ? bal : td), 0) {} catch {}
    }
}

contract MultiBranchInvariant is VulcraTestBase, VulcraDeployerBase {
    VUSD internal vusd;
    Branch internal fxrpB;
    Branch internal wflrB;
    MultiBranchHandler internal handler;

    function setUp() public {
        vm.warp(1_800_000_000);
        MockERC20 fxrp = new MockERC20("Test FXRP", "FXRP", 6);
        MockERC20 wflr = new MockERC20("Wrapped C2FLR", "WC2FLR", 18);
        _setFeedById(XRP_USD_FEED_ID, 2.5e18, 18, uint64(block.timestamp));
        _setFeedById(FLR_USD_FEED_ID, 2_000_000, 8, uint64(block.timestamp)); // $0.02

        vusd = _deployVusd(address(this));
        fxrpB = _deployBranch(
            address(this),
            vusd,
            address(fxrp),
            6,
            XRP_USD_FEED_ID,
            3600,
            makeAddr("fee"),
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
            makeAddr("fee"),
            Coston2Config.wflrParams(),
            0, // unlimited ceiling for the invariant run
            false
        );
        // never let either feed go stale during the randomized run
        vm.prank(address(this));
        fxrpB.oracle.setMaxStalenessSeconds(type(uint64).max);
        vm.prank(address(this));
        wflrB.oracle.setMaxStalenessSeconds(type(uint64).max);

        handler = new MultiBranchHandler(fxrpB.manager, wflrB.manager, vusd, fxrp, wflr);
        targetContract(address(handler));
    }

    /// @dev THE key multi-collateral invariant: one shared vUSD, backed by the sum of every branch's
    ///      recorded debt. Holds across price moves, liquidation, and redemption on both branches.
    function invariant_sharedSupplyEqualsSumOfBranchDebts() public view {
        assertEq(
            vusd.totalSupply(),
            fxrpB.manager.totalDebt() + wflrB.manager.totalDebt(),
            "VUSD.totalSupply() != FXRP debt + wFLR debt"
        );
    }
}
