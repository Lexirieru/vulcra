// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {VaultManager} from "../src/VaultManager.sol";

/// @title UpgradeVaultManager
/// @notice Ships a new VaultManager implementation to each branch proxy via UUPS `upgradeToAndCall`.
///         Adds `addCollateralFor(owner, amount, …)` (ZAP_ROLE) so the XRPL-native supply path can read
///         the PersonalAccount's live FXRP balance at execution — additive, storage layout unchanged.
/// @dev    VAULT_MANAGER_FXRP=0x... VAULT_MANAGER_WFLR=0x... PRIVATE_KEY=0x... \
///           forge script script/UpgradeVaultManager.s.sol --rpc-url $COSTON2_RPC_URL --broadcast
///         Either var may be omitted to upgrade a single branch. Caller must hold UPGRADER_ROLE.
contract UpgradeVaultManager is Script {
    bytes32 internal constant IMPL_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    function run() external {
        address fxrp = vm.envOr("VAULT_MANAGER_FXRP", address(0));
        address wflr = vm.envOr("VAULT_MANAGER_WFLR", address(0));
        require(fxrp != address(0) || wflr != address(0), "no VaultManager address given");

        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        if (pk != 0) {
            vm.startBroadcast(pk);
        } else {
            vm.startBroadcast();
        }

        VaultManager newImpl = new VaultManager();
        if (fxrp != address(0)) VaultManager(fxrp).upgradeToAndCall(address(newImpl), "");
        if (wflr != address(0)) VaultManager(wflr).upgradeToAndCall(address(newImpl), "");

        vm.stopBroadcast();

        console2.log("== VaultManager upgraded (UUPS) ==");
        console2.log("new implementation:", address(newImpl));
        if (fxrp != address(0)) {
            console2.log("FXRP", fxrp, "-> impl:", address(uint160(uint256(vm.load(fxrp, IMPL_SLOT)))));
        }
        if (wflr != address(0)) {
            console2.log("wFLR", wflr, "-> impl:", address(uint160(uint256(vm.load(wflr, IMPL_SLOT)))));
        }
    }
}
