// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {StabilityPool} from "../../src/StabilityPool.sol";
import {VUSD} from "../../src/VUSD.sol";

/// @notice Random provide/withdraw/claim/notify/donate/time-skip across a fixed actor set.
contract StabilityPoolHandler is Test {
    StabilityPool internal pool;
    VUSD internal vusd;
    address internal distributor;
    address[] public actors;

    constructor(StabilityPool _pool, VUSD _vusd, address _distributor) {
        pool = _pool;
        vusd = _vusd;
        distributor = _distributor;
        for (uint256 i; i < 5; i++) {
            address a = address(uint160(0x6000 + i));
            actors.push(a);
            vm.prank(a);
            vusd.approve(address(pool), type(uint256).max);
        }
    }

    function actorsList() external view returns (address[] memory) {
        return actors;
    }

    function _a(uint256 s) internal view returns (address) {
        return actors[s % actors.length];
    }

    function provide(uint256 s, uint256 amt) external {
        address a = _a(s);
        amt = bound(amt, 1, 1e24);
        vusd.mint(a, amt); // funded on demand (handler holds MINTER_ROLE after setUp)
        vm.prank(a);
        try pool.provideToSP(amt) {} catch {}
    }

    function withdraw(uint256 s, uint256 amt) external {
        address a = _a(s);
        uint256 d = pool.depositOf(a);
        if (d == 0) return;
        amt = bound(amt, 1, d);
        vm.prank(a);
        try pool.withdrawFromSP(amt) {} catch {}
    }

    function claim(uint256 s) external {
        vm.prank(_a(s));
        try pool.claimReward() {} catch {}
    }

    function notify(uint256 amt, uint256 duration) external {
        amt = bound(amt, 1e18, 1e23);
        duration = bound(duration, 1 hours, 90 days);
        vusd.mint(distributor, amt);
        vm.startPrank(distributor);
        vusd.approve(address(pool), amt);
        try pool.notifyRewardAmount(amt, duration) {} catch {}
        vm.stopPrank();
    }

    function donate(uint256 amt) external {
        // Simulates the VaultManager minting accrued interest straight to the pool.
        amt = bound(amt, 1, 1e22);
        vusd.mint(address(pool), amt);
    }

    function notifySurplus(uint256 duration) external {
        duration = bound(duration, 1 hours, 90 days);
        vm.prank(distributor);
        try pool.notifySurplus(duration) {} catch {}
    }

    function skipTime(uint256 dt) external {
        dt = bound(dt, 1, 30 days);
        vm.warp(vm.getBlockTimestamp() + dt);
    }
}

/// @notice Solvency and accounting invariants for the Stability Pool reward accumulator.
contract StabilityPoolSolvencyTest is Test {
    StabilityPool internal pool;
    VUSD internal vusd;
    StabilityPoolHandler internal handler;
    address internal admin = makeAddr("admin");

    function setUp() public {
        vm.warp(1_800_000_000);
        vusd = VUSD(address(new ERC1967Proxy(address(new VUSD()), abi.encodeCall(VUSD.initialize, (address(this))))));
        vusd.grantRole(vusd.MINTER_ROLE(), address(this));
        pool = StabilityPool(
            address(
                new ERC1967Proxy(
                    address(new StabilityPool()),
                    abi.encodeCall(StabilityPool.initialize, (admin, address(vusd), makeAddr("vaultManager")))
                )
            )
        );
        handler = new StabilityPoolHandler(pool, vusd, admin);
        vusd.grantRole(vusd.MINTER_ROLE(), address(handler));

        targetContract(address(handler));
    }

    /// @dev Principal + every recognized-but-unpaid reward is always covered by the pool balance —
    ///      deposits can never be consumed to pay rewards.
    function invariant_balanceCoversPrincipalAndOutstanding() public view {
        assertGe(vusd.balanceOf(address(pool)), pool.totalDeposits() + pool.rewardsOutstanding());
    }

    /// @dev The TVL counter is exactly the sum of per-actor deposits.
    function invariant_totalDepositsEqualsSum() public view {
        address[] memory actors = handler.actorsList();
        uint256 sum;
        for (uint256 i; i < actors.length; i++) {
            sum += pool.depositOf(actors[i]);
        }
        assertEq(pool.totalDeposits(), sum);
    }

    /// @dev No one can ever be owed more than the recognized reward funding.
    function invariant_earnedNeverExceedsOutstanding() public view {
        address[] memory actors = handler.actorsList();
        uint256 sum;
        for (uint256 i; i < actors.length; i++) {
            sum += pool.earned(actors[i]);
        }
        assertLe(sum, pool.rewardsOutstanding());
    }
}
