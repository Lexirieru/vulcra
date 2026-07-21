// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {StabilityPool} from "../src/StabilityPool.sol";
import {VaultManager} from "../src/VaultManager.sol";
import {VUSD} from "../src/VUSD.sol";
import {IVaultManager} from "../src/interfaces/IVaultManager.sol";

/// @title SeedStabilityPool
/// @notice Seeds the Earn Stability Pools with vUSD liquidity and a live reward stream so TVL and
///         APR are real on-chain state from day one, then routes each branch's borrower-interest
///         mint (`interestReceiver`) to its pool so future yield is protocol income.
/// @dev The deployer is the vUSD DEFAULT_ADMIN: it self-grants MINTER_ROLE for the seed mint
///      (testnet-only treasury path — collateral faucets can't reach demo-scale TVL), deposits via
///      the public {StabilityPool.provideToSP}, funds the stream via {notifyRewardAmount}, and
///      REVOKES the role in the same broadcast — afterwards only VaultManagers can mint again.
///      Env (all optional): SEED_FXRP_DEPOSIT18, SEED_WFLR_DEPOSIT18, SEED_FXRP_REWARD18,
///      SEED_WFLR_REWARD18, SEED_REWARD_DURATION.
///        STABILITY_POOL_FXRP=0x... STABILITY_POOL_WFLR=0x... PRIVATE_KEY=0x... \
///        forge script script/SeedStabilityPool.s.sol --rpc-url $COSTON2_RPC_URL --broadcast
contract SeedStabilityPool is Script {
    function run() external {
        string memory json = vm.readFile("deployments/coston2.json");
        VUSD vusd = VUSD(vm.parseJsonAddress(json, ".shared.VUSD"));
        VaultManager vmFxrp = VaultManager(vm.parseJsonAddress(json, ".collaterals.FXRP.VaultManager"));
        VaultManager vmWflr = VaultManager(vm.parseJsonAddress(json, ".collaterals.wFLR.VaultManager"));
        StabilityPool fxrpPool = StabilityPool(vm.envAddress("STABILITY_POOL_FXRP"));
        StabilityPool wflrPool = StabilityPool(vm.envAddress("STABILITY_POOL_WFLR"));

        uint256 fxrpDeposit = vm.envOr("SEED_FXRP_DEPOSIT18", uint256(3_200_000e18));
        uint256 wflrDeposit = vm.envOr("SEED_WFLR_DEPOSIT18", uint256(850_000e18));
        uint256 fxrpReward = vm.envOr("SEED_FXRP_REWARD18", uint256(58_000e18));
        uint256 wflrReward = vm.envOr("SEED_WFLR_REWARD18", uint256(21_000e18));
        uint256 duration = vm.envOr("SEED_REWARD_DURATION", uint256(60 days));

        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        address deployer = pk != 0 ? vm.addr(pk) : msg.sender;

        if (pk != 0) {
            vm.startBroadcast(pk);
        } else {
            vm.startBroadcast();
        }

        // 1. Testnet treasury mint (self-granted, revoked below — see @dev).
        bytes32 minterRole = vusd.MINTER_ROLE();
        vusd.grantRole(minterRole, deployer);
        vusd.mint(deployer, fxrpDeposit + wflrDeposit + fxrpReward + wflrReward);

        // 2. Seed both pools through the public deposit path, then start the reward streams.
        vusd.approve(address(fxrpPool), fxrpDeposit + fxrpReward);
        fxrpPool.provideToSP(fxrpDeposit);
        fxrpPool.notifyRewardAmount(fxrpReward, duration);

        vusd.approve(address(wflrPool), wflrDeposit + wflrReward);
        wflrPool.provideToSP(wflrDeposit);
        wflrPool.notifyRewardAmount(wflrReward, duration);

        // 3. Route each branch's borrower-interest mint to its pool (real protocol yield; rolled
        //    into the stream later via notifySurplus). Rate bounds stay as deployed.
        vmFxrp.setInterestConfig(
            IVaultManager.InterestConfig({
                minInterestRateBps: vmFxrp.minInterestRateBps(),
                maxInterestRateBps: vmFxrp.maxInterestRateBps(),
                defaultInterestRateBps: vmFxrp.defaultInterestRateBps(),
                interestReceiver: address(fxrpPool)
            })
        );
        vmWflr.setInterestConfig(
            IVaultManager.InterestConfig({
                minInterestRateBps: vmWflr.minInterestRateBps(),
                maxInterestRateBps: vmWflr.maxInterestRateBps(),
                defaultInterestRateBps: vmWflr.defaultInterestRateBps(),
                interestReceiver: address(wflrPool)
            })
        );

        // 4. Close the treasury path: vUSD minting is once again VaultManager-only.
        vusd.revokeRole(minterRole, deployer);

        vm.stopBroadcast();

        console2.log("== Stability Pools seeded (Coston2) ==");
        console2.log("FXRP pool TVL (18-dec):", fxrpPool.totalDeposits());
        console2.log("FXRP pool APR (bps)   :", fxrpPool.currentAprBps());
        console2.log("wFLR pool TVL (18-dec):", wflrPool.totalDeposits());
        console2.log("wFLR pool APR (bps)   :", wflrPool.currentAprBps());
        console2.log("deployer vUSD leftover:", vusd.balanceOf(deployer));
    }
}
