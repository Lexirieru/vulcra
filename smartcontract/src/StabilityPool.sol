// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {VulcraMath} from "./libraries/VulcraMath.sol";

/// @title StabilityPool
/// @notice Per-branch vUSD Stability Pool (Earn): depositors provide vUSD that backs a collateral
///         branch's loans and earn vUSD rewards streamed at an on-chain reward rate. One instance
///         is deployed per collateral branch (FXRP, wFLR), all holding the one shared vUSD.
/// @dev Reward accrual is the classic rate-based accumulator: `rewardRate` (vUSD/second, 18-dec)
///      streams over a notify window ending at `periodFinish`, folded into the monotone
///      `rewardPerTokenStored` accumulator (1e18-scaled vUSD per deposited vUSD). Rewards are
///      funded from real protocol income: each branch VaultManager mints its accrued borrower
///      interest to `interestReceiver` — pointed at this pool — and a distributor rolls the
///      received surplus into the stream via {notifySurplus} (or pushes an explicit budget via
///      {notifyRewardAmount}). APR getters derive directly from the live rate and accumulator
///      history ({currentAprBps}, {trailingAprBps}) — nothing off-chain, nothing hardcoded.
///      Principal can never be paid out as rewards: only amounts accounted in `rewardsOutstanding`
///      (notified transfers / recognized surplus) are distributable, and `notifySurplus` measures
///      surplus against `totalDeposits + rewardsOutstanding`. UUPS-upgradeable (initializer,
///      storage gap, UPGRADER_ROLE-gated `_authorizeUpgrade`) like the rest of the protocol.
contract StabilityPool is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardTransient,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    uint256 internal constant SECONDS_PER_YEAR = 365 days;
    /// @dev Minimum spacing between stored accumulator checkpoints (bounds array growth).
    uint256 internal constant CHECKPOINT_INTERVAL = 1 hours;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant REWARDS_DISTRIBUTOR_ROLE = keccak256("REWARDS_DISTRIBUTOR_ROLE");

    /// @dev Timestamped snapshot of the reward accumulator, for trailing-window APR (e.g. 7d).
    struct Checkpoint {
        uint64 timestamp;
        uint256 rewardPerTokenCum; // rewardPerToken() at `timestamp` (1e18-scaled)
    }

    /// @notice The shared Vulcra USD token — both the deposit asset and the reward asset.
    IERC20 public vusd;
    /// @notice The branch VaultManager this pool backs (provenance; its interest funds rewards).
    address public vaultManager;

    /// @notice Total vUSD principal in the pool (18-dec) — the pool's TVL.
    uint256 public totalDeposits;
    /// @notice Per-depositor vUSD principal (18-dec).
    mapping(address => uint256) public deposits;

    /// @notice Current reward stream rate in vUSD (18-dec) per second. 0 when no active stream.
    uint256 public rewardRate;
    /// @notice End of the current reward stream window.
    uint64 public periodFinish;
    /// @notice Last time the accumulator was folded (never exceeds `periodFinish`).
    uint64 public lastUpdateTime;
    /// @notice Cumulative reward per deposited vUSD (1e18-scaled), folded up to `lastUpdateTime`.
    uint256 public rewardPerTokenStored;
    mapping(address => uint256) public userRewardPerTokenPaid;
    /// @notice Rewards settled to a depositor but not yet paid out (18-dec).
    mapping(address => uint256) public rewards;
    /// @notice Recognized reward funding not yet paid out: Σ notified − Σ paid. The pool balance
    ///         always covers `totalDeposits + rewardsOutstanding` minus nothing — see invariants.
    uint256 public rewardsOutstanding;
    /// @notice Accumulator history (≤ one entry per {CHECKPOINT_INTERVAL}), for trailing APR.
    Checkpoint[] public checkpoints;

    /// @dev Storage gap for future layout evolution of this contract's own state.
    uint256[39] private __gap;

    error ZeroAmount();
    error ZeroAddress();
    error ZeroDuration();
    error InsufficientDeposit();
    error RewardRateZero();
    error NoSurplus();

    event DepositProvided(address indexed depositor, uint256 amount18, uint256 newDeposit18, uint256 totalDeposits18);
    event DepositWithdrawn(address indexed depositor, uint256 amount18, uint256 newDeposit18, uint256 totalDeposits18);
    event RewardPaid(address indexed depositor, uint256 amount18);
    event RewardNotified(uint256 reward18, uint256 durationSeconds, uint256 rewardRate18, uint64 periodFinish);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param admin Granted admin/pauser/upgrader/distributor roles (protocol admin).
    /// @param vusd_ The shared vUSD token (deposit + reward asset).
    /// @param vaultManager_ The collateral-branch VaultManager whose interest funds this pool.
    function initialize(address admin, address vusd_, address vaultManager_) external initializer {
        if (admin == address(0) || vusd_ == address(0) || vaultManager_ == address(0)) revert ZeroAddress();
        __AccessControl_init();
        __Pausable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
        _grantRole(REWARDS_DISTRIBUTOR_ROLE, admin);
        vusd = IERC20(vusd_);
        vaultManager = vaultManager_;
    }

    // --- deposit / withdraw ---

    /// @notice Deposit vUSD into the pool. Any pending rewards are paid out (Liquity-style
    ///         payout-on-touch), so balances never mix principal and earnings.
    function provideToSP(uint256 amount18) external whenNotPaused nonReentrant {
        if (amount18 == 0) revert ZeroAmount();
        _updateReward(msg.sender);
        deposits[msg.sender] += amount18;
        totalDeposits += amount18;
        vusd.safeTransferFrom(msg.sender, address(this), amount18);
        _payReward(msg.sender);
        emit DepositProvided(msg.sender, amount18, deposits[msg.sender], totalDeposits);
    }

    /// @notice Withdraw vUSD principal plus any pending rewards. Never pause-gated — deposits can
    ///         always exit.
    function withdrawFromSP(uint256 amount18) external nonReentrant {
        if (amount18 == 0) revert ZeroAmount();
        uint256 current = deposits[msg.sender];
        if (amount18 > current) revert InsufficientDeposit();
        _updateReward(msg.sender);
        deposits[msg.sender] = current - amount18;
        totalDeposits -= amount18;
        vusd.safeTransfer(msg.sender, amount18);
        _payReward(msg.sender);
        emit DepositWithdrawn(msg.sender, amount18, deposits[msg.sender], totalDeposits);
    }

    /// @notice Pay out the caller's accrued rewards without touching the principal.
    function claimReward() external nonReentrant {
        _updateReward(msg.sender);
        _payReward(msg.sender);
    }

    // --- reward funding ---

    /// @notice Pull `reward18` vUSD from the caller and stream it over `durationSeconds`. Any
    ///         remainder of a still-active stream rolls into the new window (rate-based rollover).
    function notifyRewardAmount(uint256 reward18, uint256 durationSeconds)
        external
        onlyRole(REWARDS_DISTRIBUTOR_ROLE)
        nonReentrant
    {
        if (reward18 == 0) revert ZeroAmount();
        vusd.safeTransferFrom(msg.sender, address(this), reward18);
        _startStream(reward18, durationSeconds);
    }

    /// @notice Roll the pool's unaccounted vUSD surplus — interest minted straight to the pool by
    ///         the VaultManager (`interestReceiver`), or donations — into a reward stream.
    function notifySurplus(uint256 durationSeconds) external onlyRole(REWARDS_DISTRIBUTOR_ROLE) nonReentrant {
        uint256 surplus = surplusRewards();
        if (surplus == 0) revert NoSurplus();
        _startStream(surplus, durationSeconds);
    }

    function _startStream(uint256 reward18, uint256 durationSeconds) internal {
        if (durationSeconds == 0) revert ZeroDuration();
        _updateReward(address(0));
        uint256 total = reward18;
        if (block.timestamp < periodFinish) {
            total += (periodFinish - block.timestamp) * rewardRate; // leftover of the active stream
        }
        uint256 newRate = total / durationSeconds;
        if (newRate == 0) revert RewardRateZero();
        rewardRate = newRate;
        periodFinish = uint64(block.timestamp + durationSeconds);
        lastUpdateTime = uint64(block.timestamp);
        rewardsOutstanding += reward18;
        emit RewardNotified(reward18, durationSeconds, newRate, periodFinish);
    }

    // --- admin ---

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // --- views ---

    /// @notice FE-facing alias for a depositor's principal (18-dec).
    function depositOf(address account) external view returns (uint256) {
        return deposits[account];
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    /// @notice Cumulative reward per deposited vUSD (1e18-scaled), live to the current block.
    function rewardPerToken() public view returns (uint256) {
        if (totalDeposits == 0) return rewardPerTokenStored;
        return rewardPerTokenStored
            + ((lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * VulcraMath.WAD) / totalDeposits;
    }

    /// @notice A depositor's accrued, unpaid rewards (18-dec), live to the current block.
    function earned(address account) public view returns (uint256) {
        return (deposits[account] * (rewardPerToken() - userRewardPerTokenPaid[account])) / VulcraMath.WAD
            + rewards[account];
    }

    /// @notice vUSD held by the pool beyond principal and accounted rewards — interest received
    ///         from the VaultManager awaiting {notifySurplus}.
    function surplusRewards() public view returns (uint256) {
        uint256 balance = vusd.balanceOf(address(this));
        uint256 accounted = totalDeposits + rewardsOutstanding;
        return balance > accounted ? balance - accounted : 0;
    }

    /// @notice Instantaneous APR in bps implied by the live reward rate against the live TVL.
    ///         0 when the stream has ended or the pool is empty.
    function currentAprBps() public view returns (uint256) {
        if (totalDeposits == 0 || block.timestamp >= periodFinish) return 0;
        return (rewardRate * SECONDS_PER_YEAR * VulcraMath.BPS) / totalDeposits;
    }

    /// @notice Realized APR in bps over the trailing `windowSeconds` (e.g. 7 days), derived from
    ///         the on-chain accumulator history: rewards actually credited per deposited vUSD,
    ///         annualized. Falls back to the pool's full history when younger than the window, and
    ///         to {currentAprBps} when there is no elapsed history at all.
    function trailingAprBps(uint256 windowSeconds) external view returns (uint256) {
        uint256 n = checkpoints.length;
        if (n == 0) return currentAprBps();

        uint256 target = block.timestamp > windowSeconds ? block.timestamp - windowSeconds : 0;
        // Binary search: the LATEST checkpoint with timestamp <= target; the oldest one otherwise.
        uint256 lo = 0;
        uint256 hi = n - 1;
        uint256 best = 0; // falls back to the oldest checkpoint
        while (lo <= hi) {
            uint256 mid = (lo + hi) / 2;
            if (checkpoints[mid].timestamp <= target) {
                best = mid;
                lo = mid + 1;
            } else {
                if (mid == 0) break;
                hi = mid - 1;
            }
        }
        Checkpoint storage cp = checkpoints[best];
        uint256 elapsed = block.timestamp - cp.timestamp;
        if (elapsed == 0) return currentAprBps();
        return ((rewardPerToken() - cp.rewardPerTokenCum) * SECONDS_PER_YEAR * VulcraMath.BPS)
            / (elapsed * VulcraMath.WAD);
    }

    function checkpointCount() external view returns (uint256) {
        return checkpoints.length;
    }

    // --- internals ---

    function _updateReward(address account) internal {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = uint64(lastTimeRewardApplicable());
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _checkpoint();
    }

    /// @dev Push at most one accumulator snapshot per {CHECKPOINT_INTERVAL}. O(1) per write; the
    ///      trailing-APR view binary-searches the history.
    function _checkpoint() internal {
        uint256 n = checkpoints.length;
        if (n == 0 || block.timestamp >= uint256(checkpoints[n - 1].timestamp) + CHECKPOINT_INTERVAL) {
            checkpoints.push(Checkpoint({timestamp: uint64(block.timestamp), rewardPerTokenCum: rewardPerTokenStored}));
        }
    }

    /// @dev Pay out settled rewards. `rewardsOutstanding` is decremented defensively (floored at
    ///      0) so a 1-wei rounding edge can never lock withdrawals.
    function _payReward(address account) internal {
        uint256 reward = rewards[account];
        if (reward == 0) return;
        rewards[account] = 0;
        rewardsOutstanding = rewardsOutstanding > reward ? rewardsOutstanding - reward : 0;
        vusd.safeTransfer(account, reward);
        emit RewardPaid(account, reward);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
