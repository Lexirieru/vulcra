// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {StabilityPool} from "../../src/StabilityPool.sol";
import {StabilityPoolV2Mock} from "../helpers/StabilityPoolV2Mock.sol";
import {VUSD} from "../../src/VUSD.sol";

contract StabilityPoolTest is Test {
    StabilityPool internal pool;
    VUSD internal vusd;

    address internal admin = makeAddr("admin");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal stranger = makeAddr("stranger");
    address internal vaultManager = makeAddr("vaultManager");

    uint256 internal constant YEAR = 365 days;

    function setUp() public {
        vm.warp(1_800_000_000);
        vusd = VUSD(address(new ERC1967Proxy(address(new VUSD()), abi.encodeCall(VUSD.initialize, (address(this))))));
        vusd.grantRole(vusd.MINTER_ROLE(), address(this));

        pool = StabilityPool(
            address(
                new ERC1967Proxy(
                    address(new StabilityPool()),
                    abi.encodeCall(StabilityPool.initialize, (admin, address(vusd), vaultManager))
                )
            )
        );

        // Fund actors; admin doubles as the rewards distributor (role granted in initialize).
        for (uint256 i; i < 3; i++) {
            address a = [alice, bob, admin][i];
            vusd.mint(a, 1_000_000e18);
            vm.prank(a);
            vusd.approve(address(pool), type(uint256).max);
        }
    }

    // --- init & roles ---

    function test_initialize_state() public view {
        assertEq(address(pool.vusd()), address(vusd));
        assertEq(pool.vaultManager(), vaultManager);
        assertEq(pool.totalDeposits(), 0);
        assertTrue(pool.hasRole(pool.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(pool.hasRole(pool.UPGRADER_ROLE(), admin));
        assertTrue(pool.hasRole(pool.PAUSER_ROLE(), admin));
        assertTrue(pool.hasRole(pool.REWARDS_DISTRIBUTOR_ROLE(), admin));
    }

    function test_revert_reinitialize() public {
        vm.expectRevert();
        pool.initialize(admin, address(vusd), vaultManager);
    }

    function test_revert_initialize_zeroAddress() public {
        StabilityPool impl = new StabilityPool();
        vm.expectRevert(StabilityPool.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), abi.encodeCall(StabilityPool.initialize, (admin, address(0), vaultManager)));
    }

    // --- deposit / withdraw (TVL accounting) ---

    function test_provideToSP_accounting() public {
        vm.prank(alice);
        pool.provideToSP(1_000e18);
        assertEq(pool.totalDeposits(), 1_000e18);
        assertEq(pool.depositOf(alice), 1_000e18);
        assertEq(vusd.balanceOf(address(pool)), 1_000e18);

        vm.prank(bob);
        pool.provideToSP(500e18);
        assertEq(pool.totalDeposits(), 1_500e18);
        assertEq(pool.depositOf(bob), 500e18);
    }

    function test_revert_provide_zero() public {
        vm.expectRevert(StabilityPool.ZeroAmount.selector);
        vm.prank(alice);
        pool.provideToSP(0);
    }

    function test_withdrawFromSP_partial_and_full() public {
        vm.startPrank(alice);
        pool.provideToSP(1_000e18);
        pool.withdrawFromSP(400e18);
        assertEq(pool.depositOf(alice), 600e18);
        assertEq(pool.totalDeposits(), 600e18);
        pool.withdrawFromSP(600e18);
        vm.stopPrank();
        assertEq(pool.depositOf(alice), 0);
        assertEq(pool.totalDeposits(), 0);
        assertEq(vusd.balanceOf(alice), 1_000_000e18); // made whole
    }

    function test_revert_withdraw_exceedsDeposit() public {
        vm.prank(alice);
        pool.provideToSP(100e18);
        vm.expectRevert(StabilityPool.InsufficientDeposit.selector);
        vm.prank(alice);
        pool.withdrawFromSP(101e18);
    }

    function test_revert_withdraw_zero() public {
        vm.expectRevert(StabilityPool.ZeroAmount.selector);
        vm.prank(alice);
        pool.withdrawFromSP(0);
    }

    // --- reward stream & notify ---

    function test_notifyRewardAmount_setsStream() public {
        vm.prank(admin);
        pool.notifyRewardAmount(100e18, 10 days);
        assertEq(pool.rewardRate(), uint256(100e18) / 10 days);
        assertEq(pool.periodFinish(), uint64(block.timestamp + 10 days));
        assertEq(pool.rewardsOutstanding(), 100e18);
        assertEq(vusd.balanceOf(address(pool)), 100e18);
    }

    function test_revert_notify_notDistributor() public {
        vm.expectRevert();
        vm.prank(stranger);
        pool.notifyRewardAmount(100e18, 10 days);
    }

    function test_revert_notify_zeroReward() public {
        vm.expectRevert(StabilityPool.ZeroAmount.selector);
        vm.prank(admin);
        pool.notifyRewardAmount(0, 10 days);
    }

    function test_revert_notify_zeroDuration() public {
        vm.expectRevert(StabilityPool.ZeroDuration.selector);
        vm.prank(admin);
        pool.notifyRewardAmount(100e18, 0);
    }

    function test_revert_notify_rateRoundsToZero() public {
        vm.expectRevert(StabilityPool.RewardRateZero.selector);
        vm.prank(admin);
        pool.notifyRewardAmount(1, 10 days);
    }

    function test_notify_rollover_foldsLeftover() public {
        vm.prank(admin);
        pool.notifyRewardAmount(100e18, 10 days);
        uint256 firstRate = pool.rewardRate();
        skip(5 days);
        vm.prank(admin);
        pool.notifyRewardAmount(50e18, 10 days);
        // leftover ≈ 50e18 (5 of 10 days unstreamed) + 50e18 new over a fresh 10 days
        uint256 leftover = 5 days * firstRate;
        assertEq(pool.rewardRate(), (50e18 + leftover) / uint256(10 days));
        assertEq(pool.rewardsOutstanding(), 150e18);
    }

    // --- accrual & payout ---

    function test_earned_singleDepositor_and_claim() public {
        vm.prank(alice);
        pool.provideToSP(1_000e18);
        vm.prank(admin);
        pool.notifyRewardAmount(100e18, 10 days);

        skip(5 days);
        // Half the stream elapsed → ~50 vUSD (rate floor rounding only).
        assertApproxEqAbs(pool.earned(alice), 50e18, 1e6);

        uint256 before = vusd.balanceOf(alice);
        vm.prank(alice);
        pool.claimReward();
        assertApproxEqAbs(vusd.balanceOf(alice) - before, 50e18, 1e6);
        assertEq(pool.earned(alice), 0);
        // Outstanding decreases by exactly what was paid.
        assertApproxEqAbs(pool.rewardsOutstanding(), 50e18, 1e6);
    }

    function test_earned_proRata_twoDepositors() public {
        vm.prank(alice);
        pool.provideToSP(300e18);
        vm.prank(bob);
        pool.provideToSP(100e18);
        vm.prank(admin);
        pool.notifyRewardAmount(100e18, 10 days);

        skip(10 days);
        assertApproxEqAbs(pool.earned(alice), 75e18, 1e6);
        assertApproxEqAbs(pool.earned(bob), 25e18, 1e6);
    }

    function test_withdraw_paysRewards() public {
        vm.prank(alice);
        pool.provideToSP(1_000e18);
        vm.prank(admin);
        pool.notifyRewardAmount(100e18, 10 days);
        skip(10 days);

        uint256 before = vusd.balanceOf(alice);
        vm.prank(alice);
        pool.withdrawFromSP(1_000e18);
        // Principal + the full stream in one payout-on-touch withdrawal.
        assertApproxEqAbs(vusd.balanceOf(alice) - before, 1_100e18, 1e6);
        assertEq(pool.earned(alice), 0);
    }

    function test_provide_paysPendingRewards() public {
        vm.prank(alice);
        pool.provideToSP(1_000e18);
        vm.prank(admin);
        pool.notifyRewardAmount(100e18, 10 days);
        skip(10 days);

        uint256 before = vusd.balanceOf(alice);
        vm.prank(alice);
        pool.provideToSP(1e18); // touch → payout
        assertApproxEqAbs(vusd.balanceOf(alice) + 1e18 - before, 100e18, 1e6);
    }

    function test_lateDepositor_earnsNothingBeforeJoining() public {
        vm.prank(alice);
        pool.provideToSP(1_000e18);
        vm.prank(admin);
        pool.notifyRewardAmount(100e18, 10 days);
        skip(5 days);

        vm.prank(bob);
        pool.provideToSP(1_000e18);
        assertEq(pool.earned(bob), 0);
        skip(5 days);
        // Second half is split 50/50; the first half was alice's alone.
        assertApproxEqAbs(pool.earned(alice), 75e18, 1e6);
        assertApproxEqAbs(pool.earned(bob), 25e18, 1e6);
    }

    // --- APR getters ---

    function test_currentAprBps() public {
        vm.prank(alice);
        pool.provideToSP(1_000e18);
        // 100 vUSD over exactly one year on 1000 vUSD TVL → 10.00% → 1000 bps.
        vm.prank(admin);
        pool.notifyRewardAmount(100e18, YEAR);
        assertApproxEqAbs(pool.currentAprBps(), 1_000, 1);
    }

    function test_currentAprBps_zeroWhenEmptyOrFinished() public {
        assertEq(pool.currentAprBps(), 0); // empty pool, no stream
        vm.prank(alice);
        pool.provideToSP(1_000e18);
        vm.prank(admin);
        pool.notifyRewardAmount(100e18, 10 days);
        skip(10 days + 1);
        assertEq(pool.currentAprBps(), 0); // stream over
    }

    function test_trailingAprBps_matchesConstantRate() public {
        vm.prank(alice);
        pool.provideToSP(1_000e18);
        vm.prank(admin);
        pool.notifyRewardAmount(100e18, YEAR);
        skip(7 days);
        // Constant rate → the realized trailing APR equals the instantaneous APR.
        assertApproxEqAbs(pool.trailingAprBps(7 days), pool.currentAprBps(), 1);
    }

    function test_trailingAprBps_coversEndedStream() public {
        vm.prank(alice);
        pool.provideToSP(1_000e18);
        vm.prank(admin);
        pool.notifyRewardAmount(70e18, 7 days);
        skip(7 days);
        vm.prank(alice);
        pool.claimReward(); // touch → checkpoint at stream end
        skip(7 days);

        assertEq(pool.currentAprBps(), 0);
        // 14-day window saw 70 vUSD on 1000 TVL → 7% per 14d → ~182.5%/yr ≈ 18250 bps.
        assertApproxEqAbs(pool.trailingAprBps(14 days), 18_250, 30);
    }

    function test_checkpoints_throttledToInterval() public {
        vm.startPrank(alice);
        pool.provideToSP(100e18); // first checkpoint
        pool.provideToSP(100e18); // same timestamp → skipped
        skip(30 minutes);
        pool.provideToSP(100e18); // < 1h since last → skipped
        skip(31 minutes);
        pool.provideToSP(100e18); // ≥ 1h → second checkpoint
        vm.stopPrank();
        assertEq(pool.checkpointCount(), 2);
    }

    // --- surplus (interest routed straight to the pool) ---

    function test_notifySurplus_streamsDirectTransfers() public {
        vm.prank(alice);
        pool.provideToSP(1_000e18);
        // Simulate the VaultManager minting accrued interest to the pool (interestReceiver).
        vusd.mint(address(pool), 42e18);
        assertEq(pool.surplusRewards(), 42e18);

        vm.prank(admin);
        pool.notifySurplus(10 days);
        assertEq(pool.surplusRewards(), 0);
        assertEq(pool.rewardsOutstanding(), 42e18);
        assertEq(pool.rewardRate(), uint256(42e18) / 10 days);

        skip(10 days);
        assertApproxEqAbs(pool.earned(alice), 42e18, 1e6);
    }

    function test_revert_notifySurplus_none() public {
        vm.expectRevert(StabilityPool.NoSurplus.selector);
        vm.prank(admin);
        pool.notifySurplus(10 days);
    }

    // --- pause ---

    function test_pause_blocksProvide_notWithdrawOrClaim() public {
        vm.prank(alice);
        pool.provideToSP(100e18);
        vm.prank(admin);
        pool.pause();

        vm.expectRevert();
        vm.prank(alice);
        pool.provideToSP(1e18);

        vm.prank(alice);
        pool.withdrawFromSP(50e18); // exits always work
        vm.prank(alice);
        pool.claimReward();

        vm.prank(admin);
        pool.unpause();
        vm.prank(alice);
        pool.provideToSP(1e18);
    }

    function test_revert_pause_notPauser() public {
        vm.expectRevert();
        vm.prank(stranger);
        pool.pause();
    }

    // --- UUPS upgrade ---

    function test_upgrade_preservesState_and_addsBehavior() public {
        vm.prank(alice);
        pool.provideToSP(1_234e18);
        vm.prank(admin);
        pool.notifyRewardAmount(100e18, 10 days);
        uint256 rateBefore = pool.rewardRate();

        address v2 = address(new StabilityPoolV2Mock());
        vm.prank(admin);
        pool.upgradeToAndCall(v2, "");

        StabilityPoolV2Mock upgraded = StabilityPoolV2Mock(address(pool));
        assertEq(upgraded.version(), 2);
        assertEq(upgraded.totalDeposits(), 1_234e18);
        assertEq(upgraded.depositOf(alice), 1_234e18);
        assertEq(upgraded.rewardRate(), rateBefore);
        upgraded.setNewFeature(7);
        assertEq(upgraded.newFeature(), 7);

        // The pool still works post-upgrade.
        vm.prank(alice);
        pool.withdrawFromSP(234e18);
        assertEq(pool.totalDeposits(), 1_000e18);
    }

    function test_revert_upgrade_notUpgrader() public {
        address v2 = address(new StabilityPoolV2Mock());
        vm.expectRevert();
        vm.prank(stranger);
        pool.upgradeToAndCall(v2, "");
    }

    function test_revert_implementation_initialize() public {
        StabilityPool impl = new StabilityPool();
        vm.expectRevert();
        impl.initialize(admin, address(vusd), vaultManager);
    }
}
