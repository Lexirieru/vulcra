// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VulcraTestBase} from "../helpers/VulcraTestBase.sol";
import {MockERC20} from "../helpers/MockERC20.sol";
import {VulcraDeployerBase} from "../../script/VulcraDeployerBase.sol";
import {Coston2Config} from "../../script/config/Coston2Config.sol";

/// @notice Post-deploy wiring assertions, exercising the exact shared deploy sequence the script
///         uses (VulcraDeployerBase) against a mocked FXRP/registry.
contract DeployWiringTest is VulcraTestBase, VulcraDeployerBase {
    address internal feeReceiver = makeAddr("feeReceiver");

    function test_deployWiring() public {
        vm.warp(1_800_000_000);
        MockERC20 fxrp = new MockERC20("Test FXRP", "FXRP", 6);
        _setFxrp(address(fxrp));
        _setXrpPrice(2.5e18, 18);

        Deployed memory d = _deployVulcra(address(this), feeReceiver, XRP_USD_FEED_ID, 3600, Coston2Config.params());

        // VaultManager holds MINTER_ROLE on VUSD (only path to mint/burn vUSD).
        assertTrue(d.vusd.hasRole(d.vusd.MINTER_ROLE(), address(d.manager)), "manager is minter");
        // Params match config.
        (uint256 mcr, uint256 minDebt, uint256 mintFee, uint256 liqBonus, uint256 redFee) = d.manager.params();
        assertEq(mcr, Coston2Config.MCR_BPS);
        assertEq(minDebt, Coston2Config.MIN_DEBT_18);
        assertEq(mintFee, Coston2Config.MINT_FEE_BPS);
        assertEq(liqBonus, Coston2Config.LIQ_BONUS_BPS);
        assertEq(redFee, Coston2Config.REDEMPTION_FEE_BPS);
        // Cross-wiring.
        assertEq(address(d.manager.oracle()), address(d.oracle));
        assertEq(address(d.manager.vusdToken()), address(d.vusd));
        assertEq(d.manager.fxrp(), address(fxrp));
        assertEq(address(d.zap.vaultManager()), address(d.manager));
        assertEq(address(d.zap.fxrpToken()), address(fxrp));
        // Admin roles.
        assertTrue(d.manager.hasRole(d.manager.DEFAULT_ADMIN_ROLE(), address(this)));
        assertTrue(d.oracle.hasRole(d.oracle.DEFAULT_ADMIN_ROLE(), address(this)));

        // Functional smoke test: open a vault through the freshly deployed stack.
        address user = makeAddr("user");
        fxrp.mint(user, 100e6);
        vm.prank(user);
        fxrp.approve(address(d.manager), 100e6);
        vm.prank(user);
        d.manager.openVault(100e6, 100e18, address(0), address(0));
        assertEq(d.vusd.balanceOf(user), 100e18);
        assertEq(d.vusd.totalSupply(), d.manager.totalDebt());
    }
}
