// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VulcraTestBase} from "./VulcraTestBase.sol";
import {MockERC20} from "./MockERC20.sol";
import {PriceOracle} from "../../src/PriceOracle.sol";
import {VUSD} from "../../src/VUSD.sol";
import {VaultManager} from "../../src/VaultManager.sol";
import {IVaultManager} from "../../src/interfaces/IVaultManager.sol";

/// @notice Deploys the full Vulcra stack (PriceOracle + VUSD + VaultManager) behind proxies with a
///         mocked FXRP token and FTSO feed. Shared by U5–U8 tests.
abstract contract VaultTestSetup is VulcraTestBase {
    PriceOracle internal oracle;
    VUSD internal vusd;
    VaultManager internal mgr;
    MockERC20 internal fxrp;

    address internal admin = makeAddr("admin");
    address internal feeReceiver = makeAddr("feeReceiver");

    // Default parameters (R7): MCR 130%, minDebt 100 vUSD, mint fee 0.5%, liq bonus 10%, redemption 0.
    uint256 internal constant MCR_BPS = 13_000;
    uint256 internal constant MIN_DEBT = 100e18;
    uint256 internal constant MINT_FEE_BPS = 50;
    uint256 internal constant LIQ_BONUS_BPS = 1_000;

    function _deployStack() internal {
        vm.warp(1_800_000_000);
        fxrp = new MockERC20("Test FXRP", "FXRP", 6);
        _setFxrp(address(fxrp));
        _setXrpPrice(2.5e18, 18); // $2.50 / XRP

        oracle = PriceOracle(
            _deployProxy(
                address(new PriceOracle()),
                abi.encodeCall(PriceOracle.initialize, (admin, XRP_USD_FEED_ID, 3600))
            )
        );
        vusd = VUSD(
            _deployProxy(address(new VUSD()), abi.encodeCall(VUSD.initialize, (admin)))
        );
        IVaultManager.Params memory p = IVaultManager.Params({
            mcrBps: MCR_BPS,
            minDebt18: MIN_DEBT,
            mintFeeBps: MINT_FEE_BPS,
            liqBonusBps: LIQ_BONUS_BPS,
            redemptionFeeBps: 0
        });
        mgr = VaultManager(
            _deployProxy(
                address(new VaultManager()),
                abi.encodeCall(
                    VaultManager.initialize,
                    (admin, address(oracle), address(vusd), feeReceiver, p)
                )
            )
        );
        bytes32 minterRole = vusd.MINTER_ROLE();
        vm.prank(admin);
        vusd.grantRole(minterRole, address(mgr));
    }

    /// @notice Mint FXRP to `user` and set unlimited approval to the manager.
    function _fundFxrp(address user, uint256 amount6) internal {
        fxrp.mint(user, amount6);
        vm.prank(user);
        fxrp.approve(address(mgr), type(uint256).max);
    }

    /// @notice Open a vault as `user` (funds + approves first). No hints (descent path).
    function _openVault(address user, uint256 collateral6, uint256 mint18) internal {
        _fundFxrp(user, collateral6);
        vm.prank(user);
        mgr.openVault(collateral6, mint18, address(0), address(0));
    }

    /// @notice Update the XRP price (fresh timestamp) mid-test.
    function _setPrice18(uint256 price18) internal {
        _setFeed(price18, 18, uint64(block.timestamp));
    }
}
