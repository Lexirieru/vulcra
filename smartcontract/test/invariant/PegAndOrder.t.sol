// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {VaultTestSetup} from "../helpers/VaultTestSetup.sol";
import {VaultManager} from "../../src/VaultManager.sol";
import {VUSD} from "../../src/VUSD.sol";
import {MockERC20} from "../helpers/MockERC20.sol";

/// @notice Random open/redeem/repay/adjust at a constant price; checks ordering + peg accounting.
contract PegOrderHandler is Test {
    VaultManager internal mgr;
    VUSD internal vusd;
    MockERC20 internal fxrp;
    address[] public actors;

    constructor(VaultManager _mgr, VUSD _vusd, MockERC20 _fxrp) {
        mgr = _mgr;
        vusd = _vusd;
        fxrp = _fxrp;
        for (uint256 i; i < 6; i++) {
            address a = address(uint160(0x7000 + i));
            actors.push(a);
            fxrp.mint(a, 1e15);
            vm.prank(a);
            fxrp.approve(address(mgr), type(uint256).max);
        }
    }

    function _a(uint256 s) internal view returns (address) {
        return actors[s % actors.length];
    }

    function open(uint256 s, uint256 mint) external {
        address a = _a(s);
        (,, bool active) = mgr.getVault(a);
        if (active) return;
        mint = bound(mint, 100e18, 1e20);
        uint256 coll = (mint * 10) / 1e13; // ~248% CR at $2.50
        vm.prank(a);
        try mgr.openVault(coll, mint, 500, address(0), address(0)) {} catch {}
    }

    function redeem(uint256 s, uint256 amt) external {
        address a = _a(s);
        uint256 bal = vusd.balanceOf(a);
        uint256 td = mgr.totalDebt();
        if (bal == 0 || td == 0) return;
        uint256 cap = bal < td ? bal : td;
        amt = bound(amt, 1, cap);
        vm.prank(a);
        try mgr.redeem(amt, 0) {} catch {}
    }

    function repay(uint256 s, uint256 amt) external {
        address a = _a(s);
        (,, bool active) = mgr.getVault(a);
        if (!active) return;
        uint256 bal = vusd.balanceOf(a);
        if (bal == 0) return;
        amt = bound(amt, 1, bal);
        vm.prank(a);
        try mgr.repay(amt, address(0), address(0)) {} catch {}
    }

    function addColl(uint256 s, uint256 amt) external {
        address a = _a(s);
        (,, bool active) = mgr.getVault(a);
        if (!active) return;
        amt = bound(amt, 1e6, 1e11);
        vm.prank(a);
        try mgr.addCollateral(amt, address(0), address(0)) {} catch {}
    }
}

contract PegAndOrderInvariant is VaultTestSetup {
    PegOrderHandler internal handler;

    function setUp() public {
        _deployStack();
        handler = new PegOrderHandler(mgr, vusd, fxrp);
        targetContract(address(handler));
    }

    function invariant_supplyEqualsDebt() public view {
        assertEq(vusd.totalSupply(), mgr.totalDebt());
    }

    /// @dev The manager's vault list is always ordered: NICR non-increasing safest->riskiest,
    ///      and the riskiest (tail) has the minimum NICR.
    function invariant_listOrdered() public view {
        address cur = mgr.safestVault();
        uint256 lastNicr = type(uint256).max;
        uint256 count;
        uint256 size = mgr.vaultCount();
        while (cur != address(0)) {
            uint256 n = mgr.nominalCr(cur);
            assertLe(n, lastNicr, "NICR must be non-increasing safest->riskiest");
            lastNicr = n;
            cur = mgr.nextVault(cur);
            count++;
            require(count <= size + 1, "cycle detected");
        }
        assertEq(count, size, "walked count == vault count");
    }
}
