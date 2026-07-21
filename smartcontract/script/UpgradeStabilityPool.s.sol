// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {StabilityPool} from "../src/StabilityPool.sol";

/// @title UpgradeStabilityPool
/// @notice Ships a new StabilityPool implementation to every pool proxy via UUPS
///         `upgradeToAndCall` — the "fixes are an upgrade, never a redeploy" path. Also used once
///         at launch as a live rehearsal proving `_authorizeUpgrade` is wired on-chain.
/// @dev Pool proxy addresses come from env (comma-free, one per var):
///        STABILITY_POOL_FXRP=0x... STABILITY_POOL_WFLR=0x... PRIVATE_KEY=0x... \
///        forge script script/UpgradeStabilityPool.s.sol --rpc-url $COSTON2_RPC_URL \
///          --broadcast --verify --verifier blockscout \
///          --verifier-url https://coston2-explorer.flare.network/api
///      Either var may be omitted to upgrade a single pool. The caller must hold UPGRADER_ROLE.
contract UpgradeStabilityPool is Script {
    bytes32 internal constant IMPL_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    function run() external {
        address fxrpPool = vm.envOr("STABILITY_POOL_FXRP", address(0));
        address wflrPool = vm.envOr("STABILITY_POOL_WFLR", address(0));
        require(fxrpPool != address(0) || wflrPool != address(0), "no pool address given");

        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        if (pk != 0) {
            vm.startBroadcast(pk);
        } else {
            vm.startBroadcast();
        }

        StabilityPool newImpl = new StabilityPool();
        if (fxrpPool != address(0)) StabilityPool(fxrpPool).upgradeToAndCall(address(newImpl), "");
        if (wflrPool != address(0)) StabilityPool(wflrPool).upgradeToAndCall(address(newImpl), "");

        vm.stopBroadcast();

        console2.log("== StabilityPool upgraded (UUPS) ==");
        console2.log("new implementation:", address(newImpl));
        if (fxrpPool != address(0)) {
            console2.log("FXRP pool", fxrpPool, "-> impl:", address(uint160(uint256(vm.load(fxrpPool, IMPL_SLOT)))));
        }
        if (wflrPool != address(0)) {
            console2.log("wFLR pool", wflrPool, "-> impl:", address(uint160(uint256(vm.load(wflrPool, IMPL_SLOT)))));
        }
    }
}
