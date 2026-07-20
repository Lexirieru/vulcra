// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";

import {VulcraDeployerBase} from "./VulcraDeployerBase.sol";
import {Coston2Config} from "./config/Coston2Config.sol";
import {VUSD} from "../src/VUSD.sol";

/// @title DeployVulcra
/// @notice Deploys the Vulcra multi-collateral protocol to Coston2: one shared VUSD, then an FXRP
///         branch (XRP/USD feed, 6-dec, + VulcraZap) and a wFLR branch (FLR/USD feed, 18-dec, no
///         Zap). Both branches are granted VUSD MINTER_ROLE. Collateral tokens are resolved from
///         FlareContractRegistry — nothing hardcoded.
/// @dev Simulation (no `--broadcast`) needs only an RPC that can read the live registry:
///        forge script script/DeployVulcra.s.sol --rpc-url $COSTON2_RPC_URL
///      Real broadcast additionally requires a funded deployer key (never committed):
///        PRIVATE_KEY=0x... forge script script/DeployVulcra.s.sol \
///          --rpc-url $COSTON2_RPC_URL --broadcast --verify \
///          --verifier blockscout --verifier-url https://coston2-explorer.flare.network/api
///      Optional env: FEE_RECEIVER, GUARDIAN_EXECUTOR.
contract DeployVulcra is Script, VulcraDeployerBase {
    function run() external {
        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        address deployer = pk != 0 ? vm.addr(pk) : msg.sender;
        address feeReceiver = vm.envOr("FEE_RECEIVER", deployer);
        address guardian = vm.envOr("GUARDIAN_EXECUTOR", address(0));

        if (pk != 0) {
            vm.startBroadcast(pk);
        } else {
            vm.startBroadcast();
        }

        // 1. Shared vUSD (one instance across all branches).
        VUSD vusd = _deployVusd(deployer);

        // 2. Resolve collateral tokens at runtime (zero hardcode, R8).
        address fxrp = address(ContractRegistry.getAssetManagerFXRP().fAsset());
        address wflr = address(ContractRegistry.getWNat());

        // 3. FXRP branch — XRP/USD feed, 6-dec collateral, + VulcraZap (0xFE XRPL-native mint).
        Branch memory fxrpBranch = _deployBranch(
            deployer,
            vusd,
            fxrp,
            Coston2Config.FXRP_DECIMALS,
            Coston2Config.XRP_USD_FEED_ID,
            Coston2Config.PRICE_MAX_STALENESS,
            feeReceiver,
            Coston2Config.fxrpParams(),
            Coston2Config.FXRP_DEBT_CEILING,
            true
        );

        // 4. wFLR branch — FLR/USD feed, 18-dec collateral, EVM-mode only (no Zap).
        Branch memory wflrBranch = _deployBranch(
            deployer,
            vusd,
            wflr,
            Coston2Config.WFLR_DECIMALS,
            Coston2Config.FLR_USD_FEED_ID,
            Coston2Config.PRICE_MAX_STALENESS,
            feeReceiver,
            Coston2Config.wflrParams(),
            Coston2Config.WFLR_DEBT_CEILING,
            false
        );

        // 5. Optional: grant the TEE keeper delegated-repay rights on both branches.
        if (guardian != address(0)) {
            fxrpBranch.manager.grantRole(fxrpBranch.manager.GUARDIAN_EXECUTOR_ROLE(), guardian);
            wflrBranch.manager.grantRole(wflrBranch.manager.GUARDIAN_EXECUTOR_ROLE(), guardian);
        }

        vm.stopBroadcast();

        console2.log("== Vulcra multi-collateral deployed (Coston2) ==");
        console2.log("admin/deployer      :", deployer);
        console2.log("feeReceiver         :", feeReceiver);
        console2.log("VUSD (shared)       :", address(vusd));
        console2.log("-- FXRP branch --");
        console2.log("  collateral (FXRP) :", fxrp);
        console2.log("  PriceOracle       :", address(fxrpBranch.oracle));
        console2.log("  VaultManager      :", address(fxrpBranch.manager));
        console2.log("  VulcraZap         :", address(fxrpBranch.zap));
        console2.log("-- wFLR branch --");
        console2.log("  collateral (wFLR) :", wflr);
        console2.log("  PriceOracle       :", address(wflrBranch.oracle));
        console2.log("  VaultManager      :", address(wflrBranch.manager));
    }
}
