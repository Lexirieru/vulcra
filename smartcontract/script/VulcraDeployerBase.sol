// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {PriceOracle} from "../src/PriceOracle.sol";
import {VUSD} from "../src/VUSD.sol";
import {VaultManager} from "../src/VaultManager.sol";
import {VulcraZap} from "../src/VulcraZap.sol";
import {IVaultManager} from "../src/interfaces/IVaultManager.sol";

/// @title VulcraDeployerBase
/// @notice Shared deploy-and-wire sequence for the multi-collateral ("branch per collateral") model,
///         used by both the deploy script and its wiring test so the two never drift.
/// @dev Deploy order: one shared {VUSD}, then one branch per collateral. Each branch is a
///      {PriceOracle} (configured with the branch feed id) + a {VaultManager} (configured with the
///      branch collateral token/decimals/params) granted VUSD MINTER_ROLE; the FXRP branch also gets
///      a {VulcraZap} (0xFE XRPL-native mint), other branches do not. The caller (broadcaster in the
///      script; the test contract in tests) must be `admin` so role grants succeed.
abstract contract VulcraDeployerBase {
    /// @dev A collateral branch. `zap` is address(0) for branches without XRPL-native mint.
    struct Branch {
        PriceOracle oracle;
        VaultManager manager;
        VulcraZap zap;
    }

    /// @notice Deploy the single shared vUSD token.
    function _deployVusd(address admin) internal returns (VUSD vusd) {
        vusd = VUSD(address(new ERC1967Proxy(address(new VUSD()), abi.encodeCall(VUSD.initialize, (admin)))));
    }

    /// @notice Deploy one collateral branch and grant it MINTER_ROLE on the shared vUSD.
    /// @param collateralToken Branch collateral (FXRP, wFLR, ...), pre-resolved by the caller.
    /// @param collateralDecimals Collateral decimals (6 for FXRP, 18 for wFLR).
    /// @param feedId This branch's FTSO feed id (XRP/USD, FLR/USD, ...).
    /// @param p Branch parameters (may differ per branch).
    /// @param debtCeiling Per-branch vUSD mint cap (0 = unlimited).
    /// @param deployZap Whether to deploy + wire a VulcraZap (FXRP branch only).
    function _deployBranch(
        address admin,
        VUSD vusd,
        address collateralToken,
        uint8 collateralDecimals,
        bytes21 feedId,
        uint64 staleness,
        address feeReceiver,
        IVaultManager.Params memory p,
        uint256 debtCeiling,
        IVaultManager.InterestConfig memory ic,
        bool deployZap
    ) internal returns (Branch memory b) {
        b.oracle = PriceOracle(
            address(
                new ERC1967Proxy(
                    address(new PriceOracle()), abi.encodeCall(PriceOracle.initialize, (admin, feedId, staleness))
                )
            )
        );
        b.manager = VaultManager(
            address(
                new ERC1967Proxy(
                    address(new VaultManager()),
                    abi.encodeCall(
                        VaultManager.initialize,
                        (
                            admin,
                            collateralToken,
                            collateralDecimals,
                            address(b.oracle),
                            address(vusd),
                            feeReceiver,
                            p,
                            debtCeiling,
                            ic
                        )
                    )
                )
            )
        );
        // The shared vUSD grants MINTER_ROLE to every branch VaultManager.
        vusd.grantRole(vusd.MINTER_ROLE(), address(b.manager));

        if (deployZap) {
            b.zap = VulcraZap(
                address(
                    new ERC1967Proxy(
                        address(new VulcraZap()), abi.encodeCall(VulcraZap.initialize, (admin, address(b.manager)))
                    )
                )
            );
            b.manager.grantRole(b.manager.ZAP_ROLE(), address(b.zap));
        }
    }
}
