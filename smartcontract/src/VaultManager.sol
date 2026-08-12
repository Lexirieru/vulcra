// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPriceOracle} from "./interfaces/IPriceOracle.sol";
import {IVUSD} from "./interfaces/IVUSD.sol";
import {IVaultManager} from "./interfaces/IVaultManager.sol";
import {VulcraMath} from "./libraries/VulcraMath.sol";
import {SortedVaults} from "./libraries/SortedVaults.sol";

/// @title VaultManager (V2 — user-set interest rates)
/// @notice Vulcra CDP core: one vUSD vault per address, backed by a single collateral token, with a
///         borrower-chosen annual interest rate (Liquity-V2 style). Collateral-agnostic — one
///         instance per collateral ("branch"), all sharing the one vUSD.
/// @dev Interest accrues continuously without looping over vaults, using an aggregate model:
///      `totalDebt` is the recorded (realized) debt, `aggWeightedDebtSum = Σ recordedDebt·rate`, and
///      `pendingAggInterest = aggWeightedDebtSum · dt / year` is the interest owed since the last
///      settle. Every state-changing op first settles (mints pending interest to `interestReceiver`
///      and folds it into `totalDebt`) so that `VUSD.totalSupply() == Σ_branches totalDebt` holds
///      continuously, and `== Σ vault entireDebt` after settling. The sorted list is keyed by
///      ANNUAL INTEREST RATE (ascending): redemptions hit the lowest-rate vaults first. Liquidation
///      is by CR (per-vault check). UUPS-upgradeable.
contract VaultManager is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardTransient,
    UUPSUpgradeable,
    IVaultManager
{
    using SafeERC20 for IERC20;
    using SortedVaults for SortedVaults.Data;

    uint256 internal constant SECONDS_PER_YEAR = 365 days;

    bytes32 public constant PARAM_ADMIN_ROLE = keccak256("PARAM_ADMIN_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant GUARDIAN_EXECUTOR_ROLE = keccak256("GUARDIAN_EXECUTOR_ROLE");
    bytes32 public constant ZAP_ROLE = keccak256("ZAP_ROLE");

    struct Vault {
        uint256 collateral6; // collateral in raw token units
        uint256 debt18; // RECORDED debt (18-dec): principal + fee + interest folded at last update
        uint256 annualInterestRateBps; // borrower-chosen rate; also the sorted-list key
        uint64 lastUpdateTime; // when debt18 was last folded to current
        bool active;
    }

    IPriceOracle public oracle;
    IVUSD public vusdToken;
    IERC20 public collateralToken;
    uint8 public collateralDecimals;
    address public feeReceiver;
    Params public params;
    uint256 public debtCeiling;

    /// @notice Aggregate RECORDED debt (realized). `getEntireSystemDebt()` adds pending interest.
    ///         `VUSD.totalSupply() == Σ_branches totalDebt` at all times.
    uint256 public totalDebt;
    /// @notice Σ over active vaults of (recordedDebt · annualInterestRateBps). Drives accrual.
    uint256 public aggWeightedDebtSum;
    /// @notice Timestamp of the last aggregate interest settlement.
    uint64 public lastAggUpdateTime;

    // --- interest config ---
    address public interestReceiver;
    uint256 public minInterestRateBps;
    uint256 public maxInterestRateBps;
    /// @notice Rate applied to XRPL-native (Zap) opens so the 1-payment UX needs no rate choice.
    uint256 public defaultInterestRateBps;

    mapping(address => Vault) public vaults;
    mapping(address => address) public guardianFunder;
    SortedVaults.Data internal sorted;

    uint256[34] private __gap;

    error VaultExists();
    error NoVault();
    error ZeroAmount();
    error DebtBelowMin();
    error CRTooLow();
    error InvalidParams();
    error InsufficientCollateral();
    error ZeroAddress();
    error NotLiquidatable();
    error ExceedsSystemDebt();
    error NothingRedeemed();
    error FunderInsufficient();
    error DebtCeilingExceeded();
    error InterestRateOutOfBounds();

    event VaultOpened(address indexed owner, uint256 collateral6, uint256 debt18, uint256 annualInterestRateBps);
    event CollateralAdded(address indexed owner, uint256 amount6, uint256 newCollateral6);
    event CollateralWithdrawn(address indexed owner, uint256 amount6, uint256 newCollateral6);
    event DebtMinted(address indexed owner, uint256 minted18, uint256 fee18, uint256 newDebt18);
    event DebtRepaid(address indexed owner, uint256 amount18, uint256 newDebt18);
    event VaultClosed(address indexed owner, uint256 collateralReturned6, uint256 debtBurned18);
    event InterestRateAdjusted(address indexed owner, uint256 newAnnualInterestRateBps, uint256 newDebt18);
    event AggInterestMinted(uint256 amount18);
    event ParamsUpdated(Params params);
    event FeeReceiverUpdated(address indexed feeReceiver);
    event InterestConfigUpdated(
        uint256 minRateBps, uint256 maxRateBps, uint256 defaultRateBps, address interestReceiver
    );
    event DebtCeilingUpdated(uint256 debtCeiling);
    event VaultLiquidated(
        address indexed owner,
        address indexed liquidator,
        uint256 debtCleared18,
        uint256 collateralToLiquidator6,
        uint256 collateralToOwner6
    );
    event Redemption(address indexed redeemer, uint256 vusdRedeemed18, uint256 collateralPaid6, uint256 fee6);
    event GuardianFunderSet(address indexed owner, address indexed funder);
    event DelegatedRepay(address indexed owner, address indexed funder, uint256 amount18);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address collateralToken_,
        uint8 collateralDecimals_,
        address oracle_,
        address vusd_,
        address feeReceiver_,
        Params memory p,
        uint256 debtCeiling_,
        InterestConfig memory ic
    ) external initializer {
        __AccessControl_init();
        __Pausable_init();
        if (
            collateralToken_ == address(0) || oracle_ == address(0) || vusd_ == address(0) || feeReceiver_ == address(0)
                || ic.interestReceiver == address(0)
        ) {
            revert ZeroAddress();
        }
        _validateParams(p);
        _validateInterestConfig(ic);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PARAM_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
        oracle = IPriceOracle(oracle_);
        vusdToken = IVUSD(vusd_);
        collateralToken = IERC20(collateralToken_);
        collateralDecimals = collateralDecimals_;
        feeReceiver = feeReceiver_;
        params = p;
        debtCeiling = debtCeiling_;
        interestReceiver = ic.interestReceiver;
        minInterestRateBps = ic.minInterestRateBps;
        maxInterestRateBps = ic.maxInterestRateBps;
        defaultInterestRateBps = ic.defaultInterestRateBps;
        lastAggUpdateTime = uint64(block.timestamp);
    }

    // --- interest accounting (aggregate model) ---

    /// @notice Interest accrued system-wide since the last settlement (not yet minted).
    function pendingAggInterest() public view returns (uint256) {
        uint256 dt = block.timestamp - lastAggUpdateTime;
        if (dt == 0) return 0;
        return (aggWeightedDebtSum * dt) / (SECONDS_PER_YEAR * VulcraMath.BPS);
    }

    /// @notice Entire current system debt = recorded + pending interest. Right after any op this
    ///         equals both `totalDebt` and the sum of all vaults' entire debts.
    function getEntireSystemDebt() public view returns (uint256) {
        return totalDebt + pendingAggInterest();
    }

    /// @notice Interest accrued by one vault since its last update (not yet folded).
    function _troveAccruedInterest(Vault storage v) internal view returns (uint256) {
        uint256 dt = block.timestamp - v.lastUpdateTime;
        if (dt == 0) return 0;
        return (v.debt18 * v.annualInterestRateBps * dt) / (SECONDS_PER_YEAR * VulcraMath.BPS);
    }

    /// @notice A vault's ENTIRE current debt including accrued interest.
    function getTroveEntireDebt(address owner) public view returns (uint256) {
        Vault storage v = vaults[owner];
        if (!v.active) return 0;
        return v.debt18 + _troveAccruedInterest(v);
    }

    /// @notice Settle aggregate interest: mint the pending interest to `interestReceiver` and fold it
    ///         into recorded debt. Keeps `VUSD.totalSupply() == Σ totalDebt`. Permissionless via
    ///         {mintInterest}; also called at the start of every state-changing op.
    function _settleAggInterest() internal {
        uint256 pending = pendingAggInterest();
        if (pending != 0) {
            totalDebt += pending;
            vusdToken.mint(interestReceiver, pending);
            emit AggInterestMinted(pending);
        }
        lastAggUpdateTime = uint64(block.timestamp);
    }

    /// @notice Permissionless poke to realize accrued interest into vUSD supply.
    function mintInterest() external {
        _settleAggInterest();
    }

    /// @dev Fold a vault's accrued interest into its recorded debt (does NOT touch `totalDebt` — the
    ///      interest is already captured by the preceding {_settleAggInterest}). Returns the vault's
    ///      pre-fold weighted debt (`recordedDebt·rate`) currently reflected in `aggWeightedDebtSum`,
    ///      so the caller can rebalance the aggregate after its own debt/rate changes.
    function _accrue(Vault storage v) internal returns (uint256 oldWeighted) {
        oldWeighted = v.debt18 * v.annualInterestRateBps;
        uint256 accrued = _troveAccruedInterest(v);
        if (accrued != 0) v.debt18 += accrued;
        v.lastUpdateTime = uint64(block.timestamp);
    }

    // --- open ---

    /// @notice Open a vault for the caller with a chosen annual interest rate (V2). NEW ABI:
    ///         `annualInterestRateBps` sits between `mint18` and the hints.
    function openVault(
        uint256 collateral6,
        uint256 mint18,
        uint256 annualInterestRateBps,
        address prevHint,
        address nextHint
    ) external whenNotPaused nonReentrant {
        _open(msg.sender, msg.sender, collateral6, mint18, annualInterestRateBps, msg.sender, prevHint, nextHint);
    }

    /// @inheritdoc IVaultManager
    function openVaultFor(
        address owner,
        uint256 collateral6,
        uint256 mint18,
        uint256 annualInterestRateBps,
        address debtRecipient,
        address prevHint,
        address nextHint
    ) external whenNotPaused nonReentrant onlyRole(ZAP_ROLE) {
        if (owner == address(0) || debtRecipient == address(0)) revert ZeroAddress();
        _open(owner, msg.sender, collateral6, mint18, annualInterestRateBps, debtRecipient, prevHint, nextHint);
    }

    function _open(
        address owner,
        address payer,
        uint256 collateral6,
        uint256 mint18,
        uint256 rateBps,
        address debtRecipient,
        address prevHint,
        address nextHint
    ) internal {
        if (vaults[owner].active) revert VaultExists();
        if (collateral6 == 0 || mint18 == 0) revert ZeroAmount();
        _requireRateInBounds(rateBps);
        uint256 fee = (mint18 * params.mintFeeBps) / VulcraMath.BPS;
        uint256 debt = mint18 + fee;
        if (debt < params.minDebt18) revert DebtBelowMin();

        _settleAggInterest();
        if (debtCeiling != 0 && totalDebt + debt > debtCeiling) revert DebtCeilingExceeded();
        _requireHealthy(collateral6, debt);

        vaults[owner] = Vault({
            collateral6: collateral6,
            debt18: debt,
            annualInterestRateBps: rateBps,
            lastUpdateTime: uint64(block.timestamp),
            active: true
        });
        totalDebt += debt;
        aggWeightedDebtSum += debt * rateBps;
        sorted.insert(owner, rateBps, prevHint, nextHint);

        collateralToken.safeTransferFrom(payer, address(this), collateral6);
        vusdToken.mint(debtRecipient, mint18);
        if (fee > 0) vusdToken.mint(feeReceiver, fee);

        emit VaultOpened(owner, collateral6, debt, rateBps);
    }

    // --- adjust ---

    /// @notice Add collateral to the caller's vault. (Hints are vestigial — the sorted list is keyed
    ///         by interest rate, which collateral changes do not affect.)
    function addCollateral(uint256 amount6, address, address) external whenNotPaused nonReentrant {
        Vault storage v = vaults[msg.sender];
        if (!v.active) revert NoVault();
        if (amount6 == 0) revert ZeroAmount();
        _settleAggInterest();
        uint256 oldWeighted = _accrue(v);
        aggWeightedDebtSum = aggWeightedDebtSum + v.debt18 * v.annualInterestRateBps - oldWeighted;
        v.collateral6 += amount6;
        collateralToken.safeTransferFrom(msg.sender, address(this), amount6);
        emit CollateralAdded(msg.sender, amount6, v.collateral6);
    }

    /// @notice Add collateral to `owner`'s vault, pulling the FXRP from the caller (the Zap). Lets the
    ///         XRPL-native supply path read the PersonalAccount's live FXRP balance at execution instead
    ///         of a predicted amount (the 0xFE memo commits the userOp before the mint). ZAP_ROLE-gated,
    ///         mirroring {openVaultFor}; identical accounting to {addCollateral}.
    function addCollateralFor(address owner, uint256 amount6, address, address)
        external
        whenNotPaused
        nonReentrant
        onlyRole(ZAP_ROLE)
    {
        Vault storage v = vaults[owner];
        if (!v.active) revert NoVault();
        if (amount6 == 0) revert ZeroAmount();
        _settleAggInterest();
        uint256 oldWeighted = _accrue(v);
        aggWeightedDebtSum = aggWeightedDebtSum + v.debt18 * v.annualInterestRateBps - oldWeighted;
        v.collateral6 += amount6;
        collateralToken.safeTransferFrom(msg.sender, address(this), amount6);
        emit CollateralAdded(owner, amount6, v.collateral6);
    }

    /// @notice Withdraw collateral, keeping the vault at or above MCR (against entire debt).
    function withdrawCollateral(uint256 amount6, address, address) external whenNotPaused nonReentrant {
        Vault storage v = vaults[msg.sender];
        if (!v.active) revert NoVault();
        if (amount6 == 0) revert ZeroAmount();
        if (amount6 > v.collateral6) revert InsufficientCollateral();
        _settleAggInterest();
        uint256 oldWeighted = _accrue(v);
        aggWeightedDebtSum = aggWeightedDebtSum + v.debt18 * v.annualInterestRateBps - oldWeighted;
        uint256 newColl = v.collateral6 - amount6;
        _requireHealthy(newColl, v.debt18);
        v.collateral6 = newColl;
        collateralToken.safeTransfer(msg.sender, amount6);
        emit CollateralWithdrawn(msg.sender, amount6, newColl);
    }

    /// @notice Mint more vUSD against the caller's existing vault.
    function mintMore(uint256 amount18, address, address) external whenNotPaused nonReentrant {
        Vault storage v = vaults[msg.sender];
        if (!v.active) revert NoVault();
        if (amount18 == 0) revert ZeroAmount();
        uint256 fee = (amount18 * params.mintFeeBps) / VulcraMath.BPS;

        _settleAggInterest();
        uint256 oldWeighted = _accrue(v);
        v.debt18 += amount18 + fee;
        totalDebt += amount18 + fee;
        if (v.debt18 < params.minDebt18) revert DebtBelowMin();
        if (debtCeiling != 0 && totalDebt > debtCeiling) revert DebtCeilingExceeded();
        _requireHealthy(v.collateral6, v.debt18);
        aggWeightedDebtSum = aggWeightedDebtSum + v.debt18 * v.annualInterestRateBps - oldWeighted;

        vusdToken.mint(msg.sender, amount18);
        if (fee > 0) vusdToken.mint(feeReceiver, fee);
        emit DebtMinted(msg.sender, amount18, fee, v.debt18);
    }

    /// @notice Repay part of the caller's debt (incl. accrued interest) by burning vUSD.
    function repay(uint256 amount18, address, address) external nonReentrant {
        Vault storage v = vaults[msg.sender];
        if (!v.active) revert NoVault();
        if (amount18 == 0) revert ZeroAmount();
        _settleAggInterest();
        uint256 oldWeighted = _accrue(v);
        if (amount18 > v.debt18) amount18 = v.debt18;
        uint256 newDebt = v.debt18 - amount18;
        if (newDebt != 0 && newDebt < params.minDebt18) revert DebtBelowMin();
        v.debt18 = newDebt;
        totalDebt -= amount18;
        aggWeightedDebtSum = aggWeightedDebtSum + v.debt18 * v.annualInterestRateBps - oldWeighted;
        vusdToken.burn(msg.sender, amount18);
        emit DebtRepaid(msg.sender, amount18, newDebt);
    }

    /// @notice Fully repay debt (incl. accrued interest) and withdraw all collateral, closing.
    function closeVault() external nonReentrant {
        Vault storage v = vaults[msg.sender];
        if (!v.active) revert NoVault();
        _settleAggInterest();
        uint256 oldWeighted = _accrue(v);
        uint256 debt = v.debt18;
        uint256 coll = v.collateral6;
        aggWeightedDebtSum -= oldWeighted;
        totalDebt -= debt;
        delete vaults[msg.sender];
        sorted.remove(msg.sender);
        if (debt > 0) vusdToken.burn(msg.sender, debt);
        if (coll > 0) collateralToken.safeTransfer(msg.sender, coll);
        emit VaultClosed(msg.sender, coll, debt);
    }

    /// @notice Change the caller's vault interest rate (moves it in the redemption queue).
    function adjustInterestRate(uint256 newAnnualInterestRateBps, address prevHint, address nextHint)
        external
        whenNotPaused
        nonReentrant
    {
        Vault storage v = vaults[msg.sender];
        if (!v.active) revert NoVault();
        _requireRateInBounds(newAnnualInterestRateBps);
        _settleAggInterest();
        uint256 oldWeighted = _accrue(v);
        v.annualInterestRateBps = newAnnualInterestRateBps;
        aggWeightedDebtSum = aggWeightedDebtSum + v.debt18 * newAnnualInterestRateBps - oldWeighted;
        sorted.reInsert(msg.sender, newAnnualInterestRateBps, prevHint, nextHint);
        emit InterestRateAdjusted(msg.sender, newAnnualInterestRateBps, v.debt18);
    }

    // --- liquidation (by CR) ---

    /// @notice Liquidate an undercollateralized vault (CR < MCR against its ENTIRE debt): the caller
    ///         burns the entire debt in vUSD and receives collateral worth debt + bonus (capped);
    ///         any remainder returns to the owner.
    function liquidate(address owner) external nonReentrant {
        Vault storage v = vaults[owner];
        if (!v.active) revert NoVault();
        _settleAggInterest();
        uint256 oldWeighted = _accrue(v);
        uint256 debt = v.debt18;
        uint256 coll = v.collateral6;

        uint256 price18 = oracle.price18();
        uint256 collValue = VulcraMath.collateralValueUsd18(coll, collateralDecimals, price18);
        if (VulcraMath.crBps(collValue, debt) >= params.mcrBps) revert NotLiquidatable();

        uint256 seizeValue = (debt * (VulcraMath.BPS + params.liqBonusBps)) / VulcraMath.BPS;
        uint256 seize6 = VulcraMath.collateralForUsd18(seizeValue, collateralDecimals, price18);
        if (seize6 > coll) seize6 = coll;
        uint256 toOwner6 = coll - seize6;

        aggWeightedDebtSum -= oldWeighted;
        totalDebt -= debt;
        delete vaults[owner];
        sorted.remove(owner);

        vusdToken.burn(msg.sender, debt);
        collateralToken.safeTransfer(msg.sender, seize6);
        if (toOwner6 > 0) collateralToken.safeTransfer(owner, toOwner6);

        emit VaultLiquidated(owner, msg.sender, debt, seize6, toOwner6);
    }

    // --- redemption (by interest rate — lowest first) ---

    /// @notice Redeem vUSD at face value for collateral, drawing from the LOWEST interest-rate vaults
    ///         first (Liquity-V2 "redeemable before you"). Burns vUSD from the caller.
    /// @param vusdAmount18 vUSD to redeem; must not exceed the entire system debt.
    /// @param maxIterations Cap on vaults touched (0 = unbounded).
    /// @return collateralPaid6 Collateral paid to the redeemer (net of any redemption fee).
    function redeem(uint256 vusdAmount18, uint256 maxIterations)
        external
        nonReentrant
        returns (uint256 collateralPaid6)
    {
        if (vusdAmount18 == 0) revert ZeroAmount();
        _settleAggInterest();
        if (vusdAmount18 > totalDebt) revert ExceedsSystemDebt();

        uint256 price18 = oracle.price18();
        uint256 remaining = vusdAmount18;
        uint256 grossColl;
        uint256 iterations;
        address current = sorted.getLast(); // lowest rate

        while (remaining > 0 && current != address(0)) {
            if (maxIterations != 0 && iterations >= maxIterations) break;
            address nextHigherRate = sorted.getPrev(current);
            Vault storage v = vaults[current];
            uint256 oldWeighted = _accrue(v); // fold -> v.debt18 = entire debt

            uint256 portion = remaining < v.debt18 ? remaining : v.debt18;
            uint256 coll = VulcraMath.collateralForUsd18(portion, collateralDecimals, price18);
            if (coll > v.collateral6) coll = v.collateral6; // bad-debt safety cap

            v.debt18 -= portion;
            v.collateral6 -= coll;
            totalDebt -= portion;
            remaining -= portion;
            grossColl += coll;

            if (v.debt18 == 0) {
                aggWeightedDebtSum -= oldWeighted;
                uint256 dust = v.collateral6;
                delete vaults[current];
                sorted.remove(current);
                if (dust > 0) collateralToken.safeTransfer(current, dust);
            } else {
                // rate unchanged -> sorted position unchanged; only rebalance the weighted sum
                aggWeightedDebtSum = aggWeightedDebtSum + v.debt18 * v.annualInterestRateBps - oldWeighted;
            }
            current = nextHigherRate;
            unchecked {
                ++iterations;
            }
        }

        uint256 redeemed = vusdAmount18 - remaining;
        if (redeemed == 0) revert NothingRedeemed();

        vusdToken.burn(msg.sender, redeemed);
        uint256 fee6 = (grossColl * params.redemptionFeeBps) / VulcraMath.BPS;
        collateralPaid6 = grossColl - fee6;
        collateralToken.safeTransfer(msg.sender, collateralPaid6);
        if (fee6 > 0) collateralToken.safeTransfer(feeReceiver, fee6);

        emit Redemption(msg.sender, redeemed, collateralPaid6, fee6);
    }

    // --- Vault Guardian delegated repay ---

    function setGuardianFunder(address funder) external {
        guardianFunder[msg.sender] = funder;
        emit GuardianFunderSet(msg.sender, funder);
    }

    /// @notice Repay part of a vault's debt (incl. accrued interest) from the nominated funder via
    ///         allowance. GUARDIAN_EXECUTOR_ROLE only; strictly CR-improving.
    function delegatedRepay(address owner, uint256 maxAmount18, address, address)
        external
        onlyRole(GUARDIAN_EXECUTOR_ROLE)
        nonReentrant
    {
        Vault storage v = vaults[owner];
        if (!v.active) revert NoVault();
        _settleAggInterest();
        uint256 oldWeighted = _accrue(v);
        uint256 amount = maxAmount18 >= v.debt18 ? v.debt18 : maxAmount18;
        if (amount == 0) revert ZeroAmount();
        uint256 newDebt = v.debt18 - amount;
        if (newDebt != 0 && newDebt < params.minDebt18) {
            amount = v.debt18;
            newDebt = 0;
        }

        address funder = guardianFunder[owner];
        if (funder == address(0)) funder = owner;
        if (vusdToken.balanceOf(funder) < amount || vusdToken.allowance(funder, address(this)) < amount) {
            revert FunderInsufficient();
        }

        v.debt18 = newDebt;
        totalDebt -= amount;
        aggWeightedDebtSum = aggWeightedDebtSum + v.debt18 * v.annualInterestRateBps - oldWeighted;

        vusdToken.transferFrom(funder, address(this), amount);
        vusdToken.burn(address(this), amount);

        emit DelegatedRepay(owner, funder, amount);
    }

    // --- admin ---

    function setParams(Params memory p) external onlyRole(PARAM_ADMIN_ROLE) {
        _validateParams(p);
        params = p;
        emit ParamsUpdated(p);
    }

    function setInterestConfig(InterestConfig memory ic) external onlyRole(PARAM_ADMIN_ROLE) {
        if (ic.interestReceiver == address(0)) revert ZeroAddress();
        _validateInterestConfig(ic);
        interestReceiver = ic.interestReceiver;
        minInterestRateBps = ic.minInterestRateBps;
        maxInterestRateBps = ic.maxInterestRateBps;
        defaultInterestRateBps = ic.defaultInterestRateBps;
        emit InterestConfigUpdated(
            ic.minInterestRateBps, ic.maxInterestRateBps, ic.defaultInterestRateBps, ic.interestReceiver
        );
    }

    function setFeeReceiver(address newReceiver) external onlyRole(PARAM_ADMIN_ROLE) {
        if (newReceiver == address(0)) revert ZeroAddress();
        feeReceiver = newReceiver;
        emit FeeReceiverUpdated(newReceiver);
    }

    function setDebtCeiling(uint256 newCeiling) external onlyRole(PARAM_ADMIN_ROLE) {
        debtCeiling = newCeiling;
        emit DebtCeilingUpdated(newCeiling);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // --- views ---

    /// @inheritdoc IVaultManager
    /// @dev `debt18` is the ENTIRE current debt including accrued interest (V2).
    function getVault(address owner) external view returns (uint256 collateral6, uint256 debt18, bool active) {
        Vault storage v = vaults[owner];
        return (v.collateral6, getTroveEntireDebt(owner), v.active);
    }

    /// @notice The vault's chosen annual interest rate (bps).
    function annualInterestRateBpsOf(address owner) external view returns (uint256) {
        return vaults[owner].annualInterestRateBps;
    }

    /// @notice Collateral ratio (bps) of `owner`'s vault at the current price, against ENTIRE debt.
    function collateralRatioBps(address owner) public view returns (uint256) {
        Vault storage v = vaults[owner];
        if (!v.active) return 0;
        return VulcraMath.crBps(_collValue(v.collateral6), getTroveEntireDebt(owner));
    }

    /// @notice Whether `owner`'s vault is below MCR (against ENTIRE debt) and thus liquidatable.
    function isLiquidatable(address owner) public view returns (bool) {
        Vault storage v = vaults[owner];
        if (!v.active) return false;
        return VulcraMath.crBps(_collValue(v.collateral6), getTroveEntireDebt(owner)) < params.mcrBps;
    }

    /// @inheritdoc IVaultManager
    function previewOpen(uint256 collateral6, uint256 mint18)
        external
        view
        returns (uint256 debt18, uint256 crBps, bool meetsMcr, bool meetsMinDebt)
    {
        uint256 fee = (mint18 * params.mintFeeBps) / VulcraMath.BPS;
        debt18 = mint18 + fee;
        crBps = VulcraMath.crBps(_collValue(collateral6), debt18);
        meetsMcr = crBps >= params.mcrBps;
        meetsMinDebt = debt18 >= params.minDebt18;
    }

    /// @notice Head of the redemption queue: the lowest-interest-rate vault (redeemed first).
    function redemptionQueueHead() external view returns (address) {
        return sorted.getLast();
    }

    /// @notice Number of active vaults.
    function vaultCount() external view returns (uint256) {
        return sorted.getSize();
    }

    /// @notice Lowest-rate active vault (first redemption target). Same as {redemptionQueueHead}.
    function lowestRateVault() external view returns (address) {
        return sorted.getLast();
    }

    /// @notice Highest-rate active vault.
    function highestRateVault() external view returns (address) {
        return sorted.getFirst();
    }

    /// @notice Next vault toward lower rate (redemption order) — for off-chain traversal.
    function nextVault(address owner) external view returns (address) {
        return sorted.getNext(owner);
    }

    /// @notice Next vault toward higher rate — for off-chain traversal.
    function prevVault(address owner) external view returns (address) {
        return sorted.getPrev(owner);
    }

    // --- deprecated V1 aliases (kept for ABI compatibility; semantics now rate-based) ---

    /// @dev Deprecated: the list is now keyed by interest rate. Returns the lowest-rate vault (the
    ///      first redemption target). Prefer {lowestRateVault} / {redemptionQueueHead}.
    function riskiestVault() external view returns (address) {
        return sorted.getLast();
    }

    /// @dev Deprecated: returns the highest-rate vault. Prefer {highestRateVault}.
    function safestVault() external view returns (address) {
        return sorted.getFirst();
    }

    /// @dev Deprecated: the sorted-list key is now the annual interest rate (bps), not NICR.
    ///      Prefer {annualInterestRateBpsOf}.
    function nominalCr(address owner) external view returns (uint256) {
        return sorted.nicrOf(owner);
    }

    /// @inheritdoc IVaultManager
    function fxrp() external view returns (address) {
        return address(collateralToken);
    }

    /// @inheritdoc IVaultManager
    function vusd() external view returns (address) {
        return address(vusdToken);
    }

    // --- internals ---

    function _collValue(uint256 amount) internal view returns (uint256) {
        return VulcraMath.collateralValueUsd18(amount, collateralDecimals, oracle.price18());
    }

    function _requireHealthy(uint256 collateral, uint256 debt18) internal view {
        if (VulcraMath.crBps(_collValue(collateral), debt18) < params.mcrBps) {
            revert CRTooLow();
        }
    }

    function _requireRateInBounds(uint256 rateBps) internal view {
        if (rateBps < minInterestRateBps || rateBps > maxInterestRateBps) revert InterestRateOutOfBounds();
    }

    function _validateParams(Params memory p) internal pure {
        if (p.mcrBps < 10_000 || p.mcrBps > 100_000) revert InvalidParams();
        if (p.minDebt18 == 0) revert InvalidParams();
        if (p.mintFeeBps > 1_000) revert InvalidParams();
        if (p.liqBonusBps > 5_000) revert InvalidParams();
        if (p.redemptionFeeBps > 1_000) revert InvalidParams();
    }

    function _validateInterestConfig(InterestConfig memory ic) internal pure {
        // Cap max at 1000% APR; min <= default <= max.
        if (ic.maxInterestRateBps > 100_000) revert InvalidParams();
        if (ic.minInterestRateBps > ic.maxInterestRateBps) revert InvalidParams();
        if (ic.defaultInterestRateBps < ic.minInterestRateBps || ic.defaultInterestRateBps > ic.maxInterestRateBps) {
            revert InvalidParams();
        }
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
