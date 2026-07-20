// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {VaultTestSetup} from "../helpers/VaultTestSetup.sol";
import {VaultManager} from "../../src/VaultManager.sol";
import {VUSD} from "../../src/VUSD.sol";
import {MockERC20} from "../helpers/MockERC20.sol";

/// @notice Random open/adjust/repay/close across a fixed actor set at a constant price.
contract SupplyDebtHandler is Test {
    VaultManager internal mgr;
    VUSD internal vusd;
    MockERC20 internal fxrp;
    address[] public actors;

    constructor(VaultManager _mgr, VUSD _vusd, MockERC20 _fxrp) {
        mgr = _mgr;
        vusd = _vusd;
        fxrp = _fxrp;
        for (uint256 i; i < 5; i++) {
            address a = address(uint160(0x5000 + i));
            actors.push(a);
            fxrp.mint(a, 1e15);
            vm.prank(a);
            fxrp.approve(address(mgr), type(uint256).max);
        }
    }

    function actorsList() external view returns (address[] memory) {
        return actors;
    }

    function _a(uint256 s) internal view returns (address) {
        return actors[s % actors.length];
    }

    function open(uint256 s, uint256 coll, uint256 mint) external {
        address a = _a(s);
        (,, bool active) = mgr.getVault(a);
        if (active) return;
        coll = bound(coll, 1e9, 1e13); // 1k - 10M FXRP
        mint = bound(mint, 100e18, 1e21);
        vm.prank(a);
        try mgr.openVault(coll, mint, 500, address(0), address(0)) {} catch {}
    }

    function addColl(uint256 s, uint256 amt) external {
        address a = _a(s);
        (,, bool active) = mgr.getVault(a);
        if (!active) return;
        amt = bound(amt, 1e6, 1e12);
        vm.prank(a);
        try mgr.addCollateral(amt, address(0), address(0)) {} catch {}
    }

    function withdraw(uint256 s, uint256 amt) external {
        address a = _a(s);
        (uint256 coll,, bool active) = mgr.getVault(a);
        if (!active || coll == 0) return;
        amt = bound(amt, 1, coll);
        vm.prank(a);
        try mgr.withdrawCollateral(amt, address(0), address(0)) {} catch {}
    }

    function mintMore(uint256 s, uint256 amt) external {
        address a = _a(s);
        (,, bool active) = mgr.getVault(a);
        if (!active) return;
        amt = bound(amt, 1e18, 1e20);
        vm.prank(a);
        try mgr.mintMore(amt, address(0), address(0)) {} catch {}
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

    function close(uint256 s) external {
        address a = _a(s);
        (, uint256 debt, bool active) = mgr.getVault(a);
        if (!active) return;
        if (vusd.balanceOf(a) < debt) return; // needs principal + fee
        vm.prank(a);
        try mgr.closeVault() {} catch {}
    }
}

contract SupplyEqualsDebtInvariant is VaultTestSetup {
    SupplyDebtHandler internal handler;

    function setUp() public {
        _deployStack();
        handler = new SupplyDebtHandler(mgr, vusd, fxrp);
        targetContract(address(handler));
    }

    /// @dev The core protocol invariant: every vUSD in existence is backed by recorded debt.
    function invariant_supplyEqualsDebt() public view {
        assertEq(vusd.totalSupply(), mgr.totalDebt(), "totalSupply != totalDebt");
    }

    /// @dev Aggregate `totalDebt` equals the sum of per-vault debts.
    function invariant_totalDebtIsSumOfVaults() public view {
        address[] memory actors = handler.actorsList();
        uint256 sum;
        for (uint256 i; i < actors.length; i++) {
            (, uint256 debt,) = mgr.getVault(actors[i]);
            sum += debt;
        }
        assertEq(sum, mgr.totalDebt(), "sum(vault.debt) != totalDebt");
    }
}
