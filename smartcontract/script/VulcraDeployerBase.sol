// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {PriceOracle} from "../src/PriceOracle.sol";
import {VUSD} from "../src/VUSD.sol";
import {VaultManager} from "../src/VaultManager.sol";
import {VulcraZap} from "../src/VulcraZap.sol";
import {IVaultManager} from "../src/interfaces/IVaultManager.sol";

/// @title VulcraDeployerBase
/// @notice Shared deploy-and-wire sequence used by both the deploy script and its wiring test, so
///         the two never drift. Deploys the four UUPS proxies and grants VUSD MINTER_ROLE to the
///         VaultManager. The caller (broadcaster in the script; the test contract in tests) must be
///         the `admin` so the role grant succeeds.
abstract contract VulcraDeployerBase {
    struct Deployed {
        PriceOracle oracle;
        VUSD vusd;
        VaultManager manager;
        VulcraZap zap;
    }

    function _deployVulcra(
        address admin,
        address feeReceiver,
        bytes21 feedId,
        uint64 staleness,
        IVaultManager.Params memory p
    ) internal returns (Deployed memory d) {
        d.oracle = PriceOracle(
            address(
                new ERC1967Proxy(
                    address(new PriceOracle()), abi.encodeCall(PriceOracle.initialize, (admin, feedId, staleness))
                )
            )
        );
        d.vusd = VUSD(address(new ERC1967Proxy(address(new VUSD()), abi.encodeCall(VUSD.initialize, (admin)))));
        d.manager = VaultManager(
            address(
                new ERC1967Proxy(
                    address(new VaultManager()),
                    abi.encodeCall(VaultManager.initialize, (admin, address(d.oracle), address(d.vusd), feeReceiver, p))
                )
            )
        );
        // Only the VaultManager may mint/burn vUSD.
        d.vusd.grantRole(d.vusd.MINTER_ROLE(), address(d.manager));

        d.zap = VulcraZap(
            address(
                new ERC1967Proxy(
                    address(new VulcraZap()), abi.encodeCall(VulcraZap.initialize, (admin, address(d.manager)))
                )
            )
        );
    }
}
