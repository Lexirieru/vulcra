// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultTestSetup} from "../helpers/VaultTestSetup.sol";

/// @notice Fuzz coverage for liquidation math and conservation of collateral (R4/R9).
contract LiquidationMathFuzzTest is VaultTestSetup {
    address internal alice = makeAddr("alice");
    address internal liquidator = makeAddr("liquidator");

    function setUp() public {
        _deployStack();
    }

    /// @dev For any vault driven below MCR, seized + returned == collateral, seized <= collateral,
    ///      and both supply and totalDebt drop by exactly the cleared debt.
    function testFuzz_liquidationConservation(uint256 mint18, uint256 dropBps) public {
        // Open at a healthy price with generous collateral.
        uint256 openPrice = 2.5e18;
        _setPrice18(openPrice);
        mint18 = bound(mint18, 100e18, 1e21);
        uint256 fee = (mint18 * MINT_FEE_BPS) / 10_000;
        uint256 debt = mint18 + fee;
        // ~180% CR at open
        uint256 coll = (18 * debt * 1e6) / (10 * openPrice) + 1;
        _fundFxrp(alice, coll);
        vm.prank(alice);
        mgr.openVault(coll, mint18, address(0), address(0));

        // Drop price so CR falls below MCR (drop 30%..70%).
        dropBps = bound(dropBps, 3_000, 7_000);
        uint256 newPrice = (openPrice * (10_000 - dropBps)) / 10_000;
        _setPrice18(newPrice);
        vm.assume(mgr.isLiquidatable(alice));

        _seedVusd(liquidator, debt);
        uint256 supplyBefore = vusd.totalSupply();
        uint256 debtBefore = mgr.totalDebt();
        uint256 liqBefore = fxrp.balanceOf(liquidator);
        uint256 ownerBefore = fxrp.balanceOf(alice);

        vm.prank(liquidator);
        mgr.liquidate(alice);

        uint256 seized = fxrp.balanceOf(liquidator) - liqBefore;
        uint256 returned = fxrp.balanceOf(alice) - ownerBefore;
        assertLe(seized, coll, "seized <= collateral");
        assertEq(seized + returned, coll, "collateral conserved");
        assertEq(supplyBefore - vusd.totalSupply(), debt, "supply drops by debt");
        assertEq(debtBefore - mgr.totalDebt(), debt, "totalDebt drops by debt");
    }
}
