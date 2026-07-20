// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultTestSetup} from "../helpers/VaultTestSetup.sol";
import {VulcraTestBase} from "../helpers/VulcraTestBase.sol";
import {VaultManager} from "../../src/VaultManager.sol";
import {VUSD} from "../../src/VUSD.sol";
import {MockERC20} from "../helpers/MockERC20.sol";

/// @notice Full-protocol handler: open/adjust/repay + price moves + liquidation + redemption +
///         delegated repay across a fixed actor set. Actor 0 is a whale that holds vUSD to fund
///         liquidations/redemptions and stays safest.
contract ProtocolHandler is VulcraTestBase {
    VaultManager internal mgr;
    VUSD internal vusd;
    MockERC20 internal fxrp;
    address internal guardian;
    address[] public actors;
    uint256 public price18 = 2.5e18;

    constructor(VaultManager _mgr, VUSD _vusd, MockERC20 _fxrp, address _guardian) {
        mgr = _mgr;
        vusd = _vusd;
        fxrp = _fxrp;
        guardian = _guardian;
        for (uint256 i; i < 6; i++) {
            address a = address(uint160(0x8000 + i));
            actors.push(a);
            fxrp.mint(a, 1e16);
            vm.prank(a);
            fxrp.approve(address(mgr), type(uint256).max);
            vm.prank(a);
            vusd.approve(address(mgr), type(uint256).max); // allow guardian delegated repay
        }
        // whale (actor 0): huge over-collateralized vault -> lots of vUSD, always safest
        vm.prank(actors[0]);
        mgr.openVault(1e14, 1_000_000e18, address(0), address(0));
    }

    function actorsList() external view returns (address[] memory) {
        return actors;
    }

    function _a(uint256 s) internal view returns (address) {
        return actors[1 + (s % (actors.length - 1))]; // exclude whale
    }

    function movePrice(uint256 p) external {
        price18 = bound(p, 0.5e18, 5e18);
        _setFeed(price18, 18, uint64(block.timestamp));
    }

    function open(uint256 s, uint256 mint) external {
        address a = _a(s);
        (,, bool active) = mgr.getVault(a);
        if (active) return;
        mint = bound(mint, 100e18, 1e21);
        uint256 coll = (mint * 12) / 1e13; // ~healthy at $2.5
        vm.prank(a);
        try mgr.openVault(coll, mint, address(0), address(0)) {} catch {}
    }

    function addColl(uint256 s, uint256 amt) external {
        address a = _a(s);
        amt = bound(amt, 1e6, 1e12);
        vm.prank(a);
        try mgr.addCollateral(amt, address(0), address(0)) {} catch {}
    }

    function repay(uint256 s, uint256 amt) external {
        address a = _a(s);
        uint256 bal = vusd.balanceOf(a);
        if (bal == 0) return;
        amt = bound(amt, 1, bal);
        vm.prank(a);
        try mgr.repay(amt, address(0), address(0)) {} catch {}
    }

    function liquidate(uint256 s) external {
        address a = _a(s);
        if (!mgr.isLiquidatable(a)) return;
        vm.prank(actors[0]); // whale liquidates using its vUSD
        try mgr.liquidate(a) {} catch {}
    }

    function redeem(uint256 amt) external {
        uint256 td = mgr.totalDebt();
        uint256 bal = vusd.balanceOf(actors[0]);
        if (td == 0 || bal == 0) return;
        uint256 cap = bal < td ? bal : td;
        amt = bound(amt, 1, cap);
        vm.prank(actors[0]);
        try mgr.redeem(amt, 0) {} catch {}
    }

    function delegatedRepay(uint256 s, uint256 amt) external {
        address a = _a(s);
        amt = bound(amt, 1e18, 1e21);
        vm.prank(guardian);
        try mgr.delegatedRepay(a, amt, address(0), address(0)) {} catch {}
    }
}

contract ProtocolInvariants is VaultTestSetup {
    ProtocolHandler internal handler;
    address internal guardian = makeAddr("guardianExec");

    function setUp() public {
        _deployStack();
        // Never let price go stale during the randomized run.
        vm.prank(admin);
        oracle.setMaxStalenessSeconds(type(uint64).max);
        bytes32 role = mgr.GUARDIAN_EXECUTOR_ROLE();
        vm.prank(admin);
        mgr.grantRole(role, guardian);

        handler = new ProtocolHandler(mgr, vusd, fxrp, guardian);
        targetContract(address(handler));
    }

    /// @dev Every vUSD in existence is backed by recorded vault debt (KTD5).
    function invariant_supplyEqualsDebt() public view {
        assertEq(vusd.totalSupply(), mgr.totalDebt(), "supply != debt");
    }

    /// @dev The vault list stays NICR-ordered under all operations.
    function invariant_listOrdered() public view {
        address cur = mgr.safestVault();
        uint256 lastNicr = type(uint256).max;
        uint256 count;
        uint256 size = mgr.vaultCount();
        while (cur != address(0)) {
            uint256 n = mgr.nominalCr(cur);
            assertLe(n, lastNicr, "NICR non-increasing safest->riskiest");
            lastNicr = n;
            cur = mgr.nextVault(cur);
            count++;
            require(count <= size + 1, "cycle");
        }
        assertEq(count, size, "count == size");
    }

    /// @dev When no vault carries bad debt (all CR >= 100%), aggregate collateral value covers all
    ///      debt — the protocol is overcollateralized.
    function invariant_solventWhenNoBadDebt() public view {
        address[] memory actors = handler.actorsList();
        uint256 totalCollValue;
        bool anyBadDebt;
        for (uint256 i; i < actors.length; i++) {
            (uint256 coll,, bool active) = mgr.getVault(actors[i]);
            if (!active) continue;
            totalCollValue += oracle.collateralValueUsd18(coll);
            if (mgr.collateralRatioBps(actors[i]) < 10_000) anyBadDebt = true;
        }
        if (!anyBadDebt) {
            assertGe(totalCollValue, mgr.totalDebt(), "undercollateralized while solvent");
        }
    }
}
