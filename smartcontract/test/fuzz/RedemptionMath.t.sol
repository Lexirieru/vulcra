// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultTestSetup} from "../helpers/VaultTestSetup.sol";

/// @notice Fuzz coverage for redemption math and conservation (R5/R9).
contract RedemptionMathFuzzTest is VaultTestSetup {
    address internal redeemer = makeAddr("redeemer");

    function setUp() public {
        _deployStack();
    }

    /// @dev Redeeming N vUSD burns exactly N, drops totalDebt by N, and pays ~N/price FXRP
    ///      (exact when no bad-debt cap applies — all vaults here are >150% CR).
    function testFuzz_redeemConservation(uint256 redeemAmt, uint8 nVaults, uint256 seed) public {
        _setPrice18(2.5e18);
        nVaults = uint8(bound(nVaults, 1, 5));
        // open healthy vaults (CR ~200-300%), debt 100.5 each
        for (uint256 i; i < nVaults; i++) {
            address v = address(uint160(0x9000 + i));
            uint256 coll = bound(uint256(keccak256(abi.encode(seed, i))), 80_000_000, 150_000_000);
            _openVault(v, coll, 100e18);
        }
        uint256 systemDebt = mgr.totalDebt();
        // redeem up to the vaults' aggregate debt (exclude whale by capping below it)
        redeemAmt = bound(redeemAmt, 1e18, systemDebt);

        _seedVusd(redeemer, redeemAmt); // whale added after systemDebt captured
        uint256 supplyBefore = vusd.totalSupply();
        uint256 debtBefore = mgr.totalDebt();

        vm.prank(redeemer);
        uint256 paid = mgr.redeem(redeemAmt, 0);

        assertEq(supplyBefore - vusd.totalSupply(), redeemAmt, "supply drops by redeemed");
        assertEq(debtBefore - mgr.totalDebt(), redeemAmt, "totalDebt drops by redeemed");
        // all vaults >150% CR so no bad-debt cap: FXRP paid == redeemAmt / price (rounding down)
        assertApproxEqAbs(paid, (redeemAmt * 1e6) / 2.5e18, 5, "fxrp ~ redeemed/price");
        assertEq(vusd.totalSupply(), mgr.totalDebt(), "supply==debt after redeem");
    }
}
