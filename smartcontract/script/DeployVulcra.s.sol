// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {VulcraDeployerBase} from "./VulcraDeployerBase.sol";
import {Coston2Config} from "./config/Coston2Config.sol";
import {IVaultManager} from "../src/interfaces/IVaultManager.sol";

/// @title DeployVulcra
/// @notice Deploys the Vulcra CDP contracts (4 UUPS proxies) to Coston2 and wires roles + params.
/// @dev Simulation (no `--broadcast`) requires only an RPC that can read the live
///      FlareContractRegistry (the VaultManager resolves FXRP at init):
///        forge script script/DeployVulcra.s.sol --rpc-url $COSTON2_RPC_URL
///      Real broadcast additionally requires a funded deployer key (never committed):
///        PRIVATE_KEY=0x... forge script script/DeployVulcra.s.sol \
///          --rpc-url $COSTON2_RPC_URL --broadcast --verify \
///          --verifier blockscout --verifier-url https://coston2-explorer.flare.network/api
///      Optional env: FEE_RECEIVER, GUARDIAN_EXECUTOR, ADMIN handled post-deploy by the admin.
contract DeployVulcra is Script, VulcraDeployerBase {
    function run() external {
        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        address deployer = pk != 0 ? vm.addr(pk) : msg.sender;
        address feeReceiver = vm.envOr("FEE_RECEIVER", deployer);
        address guardian = vm.envOr("GUARDIAN_EXECUTOR", address(0));

        IVaultManager.Params memory p = Coston2Config.params();

        if (pk != 0) {
            vm.startBroadcast(pk);
        } else {
            vm.startBroadcast();
        }

        Deployed memory d =
            _deployVulcra(deployer, feeReceiver, Coston2Config.XRP_USD_FEED_ID, Coston2Config.PRICE_MAX_STALENESS, p);
        if (guardian != address(0)) {
            d.manager.grantRole(d.manager.GUARDIAN_EXECUTOR_ROLE(), guardian);
        }

        vm.stopBroadcast();

        console2.log("== Vulcra deployed (Coston2) ==");
        console2.log("admin/deployer :", deployer);
        console2.log("feeReceiver    :", feeReceiver);
        console2.log("PriceOracle    :", address(d.oracle));
        console2.log("VUSD           :", address(d.vusd));
        console2.log("VaultManager   :", address(d.manager));
        console2.log("VulcraZap      :", address(d.zap));
        console2.log("FXRP (resolved):", d.manager.fxrp());
    }
}
