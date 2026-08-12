// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {VulcraZap} from "../src/VulcraZap.sol";

/// @title UpgradeVulcraZap
/// @notice Ships a new VulcraZap implementation to the proxy via UUPS `upgradeToAndCall` — the
///         "fixes are an upgrade, never a redeploy" path. Adds `openVaultAndForwardAll` (reads the
///         caller's live FXRP balance at execution instead of a baked-in collateral amount) without
///         changing the proxy address or any stored state.
/// @dev    VULCRA_ZAP=0x... PRIVATE_KEY=0x... \
///           forge script script/UpgradeVulcraZap.s.sol --rpc-url $COSTON2_RPC_URL \
///             --broadcast --verify --verifier blockscout \
///             --verifier-url https://coston2-explorer.flare.network/api
///         The caller must hold UPGRADER_ROLE on the proxy.
contract UpgradeVulcraZap is Script {
    bytes32 internal constant IMPL_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    function run() external {
        address zap = vm.envAddress("VULCRA_ZAP");
        require(zap != address(0), "VULCRA_ZAP not set");

        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        if (pk != 0) {
            vm.startBroadcast(pk);
        } else {
            vm.startBroadcast();
        }

        VulcraZap newImpl = new VulcraZap();
        VulcraZap(zap).upgradeToAndCall(address(newImpl), "");

        vm.stopBroadcast();

        console2.log("== VulcraZap upgraded (UUPS) ==");
        console2.log("new implementation:", address(newImpl));
        console2.log("proxy", zap, "-> impl:", address(uint160(uint256(vm.load(zap, IMPL_SLOT)))));
    }
}
