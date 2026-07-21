// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {StabilityPool} from "../src/StabilityPool.sol";

/// @title DeployStabilityPool
/// @notice Deploys the Earn Stability Pools to Coston2: one shared UUPS implementation and one
///         ERC1967 proxy per collateral branch (FXRP, wFLR), each holding the one shared vUSD.
///         Branch addresses are read from deployments/coston2.json — nothing hardcoded.
/// @dev Simulation:  forge script script/DeployStabilityPool.s.sol --rpc-url $COSTON2_RPC_URL
///      Broadcast:   PRIVATE_KEY=0x... forge script script/DeployStabilityPool.s.sol \
///        --rpc-url $COSTON2_RPC_URL --broadcast --verify \
///        --verifier blockscout --verifier-url https://coston2-explorer.flare.network/api
///      Seeding liquidity/rewards is a separate step: script/SeedStabilityPool.s.sol.
contract DeployStabilityPool is Script {
    function run() external {
        string memory json = vm.readFile("deployments/coston2.json");
        address vusd = vm.parseJsonAddress(json, ".shared.VUSD");
        address vmFxrp = vm.parseJsonAddress(json, ".collaterals.FXRP.VaultManager");
        address vmWflr = vm.parseJsonAddress(json, ".collaterals.wFLR.VaultManager");

        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        address deployer = pk != 0 ? vm.addr(pk) : msg.sender;

        if (pk != 0) {
            vm.startBroadcast(pk);
        } else {
            vm.startBroadcast();
        }

        StabilityPool impl = new StabilityPool();
        StabilityPool fxrpPool = StabilityPool(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(StabilityPool.initialize, (deployer, vusd, vmFxrp))))
        );
        StabilityPool wflrPool = StabilityPool(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(StabilityPool.initialize, (deployer, vusd, vmWflr))))
        );

        vm.stopBroadcast();

        console2.log("== Vulcra Stability Pools deployed (Coston2) ==");
        console2.log("admin/deployer          :", deployer);
        console2.log("implementation          :", address(impl));
        console2.log("StabilityPool FXRP proxy:", address(fxrpPool));
        console2.log("StabilityPool wFLR proxy:", address(wflrPool));
    }
}
