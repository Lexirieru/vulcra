// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultTestSetup} from "../helpers/VaultTestSetup.sol";

/// @notice Fuzz coverage for vault debt/fee accounting and the supply==debt identity (R9, KTD5).
contract VaultAccountingFuzzTest is VaultTestSetup {
    address internal alice = makeAddr("alice");

    function setUp() public {
        _deployStack();
    }

    function testFuzz_openAccounting(uint256 mint18, uint256 price18) public {
        price18 = bound(price18, 1e17, 1e19); // $0.10 - $10
        mint18 = bound(mint18, 100e18, 1e24);
        _setPrice18(price18);

        uint256 fee = (mint18 * MINT_FEE_BPS) / 10_000;
        uint256 debt = mint18 + fee;
        // Target ~200% CR so the open is always healthy.
        uint256 collateral6 = (2 * debt * 1e6) / price18 + 1;

        _fundFxrp(alice, collateral6);
        vm.prank(alice);
        mgr.openVault(collateral6, mint18, address(0), address(0));

        (, uint256 vdebt,) = mgr.getVault(alice);
        assertEq(vdebt, debt, "debt == mint + fee");
        assertEq(vusd.totalSupply(), mgr.totalDebt(), "supply == totalDebt");
        assertEq(vusd.balanceOf(alice), mint18, "recipient gets principal only");
        assertEq(vusd.balanceOf(feeReceiver), fee, "feeReceiver gets fee");
        assertGe(mgr.collateralRatioBps(alice), MCR_BPS, "healthy");
    }

    function testFuzz_mintMoreKeepsIdentity(uint256 mint1, uint256 mint2) public {
        _setPrice18(2.5e18);
        mint1 = bound(mint1, 100e18, 1e21);
        mint2 = bound(mint2, 1e18, 1e21);
        // large collateral so both mints stay healthy
        uint256 coll = 1e12; // 1,000,000 FXRP => value $2.5M
        _fundFxrp(alice, coll);
        vm.prank(alice);
        mgr.openVault(coll, mint1, address(0), address(0));

        // ensure mint2 keeps CR >= MCR; if not, skip
        (uint256 debt2,, bool ok,) = mgr.previewOpen(coll, mint1 + mint2);
        vm.assume(ok && debt2 > 0);

        vm.prank(alice);
        mgr.mintMore(mint2, address(0), address(0));
        assertEq(vusd.totalSupply(), mgr.totalDebt(), "supply == totalDebt after mintMore");
    }
}
