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

/// @title VaultManager
/// @notice Vulcra CDP core: one vUSD vault per address, backed by a single collateral token
///         (R1, R6, R7). Collateral-agnostic — multi-collateral is realized by deploying one
///         instance ("branch") per collateral (FXRP, wFLR, ...), each sharing the one vUSD token.
/// @dev UUPS-upgradeable. The collateral token + decimals and the per-branch oracle are supplied at
///      init (nothing hardcoded, R8). Mint fee is capitalized into debt so this branch's
///      `totalDebt` tracks its vUSD share exactly, and summed across branches equals
///      `VUSD.totalSupply()` (KTD5). Vaults are kept in a per-branch NICR-sorted list for O(1)
///      riskiest-vault lookup (KTD1). The external runtime ABI is identical across branches.
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

    bytes32 public constant PARAM_ADMIN_ROLE = keccak256("PARAM_ADMIN_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant GUARDIAN_EXECUTOR_ROLE = keccak256("GUARDIAN_EXECUTOR_ROLE");
    /// @dev Addresses allowed to open a vault on someone else's behalf (VulcraZap). Prevents a
    ///      griefing vector where anyone could occupy a victim's one-vault-per-address slot.
    bytes32 public constant ZAP_ROLE = keccak256("ZAP_ROLE");

    struct Vault {
        uint256 collateral6; // FXRP, 6-dec
        uint256 debt18; // vUSD, 18-dec (principal + capitalized fee)
        bool active;
    }

    IPriceOracle public oracle;
    IVUSD public vusdToken;
    /// @notice This branch's collateral token (e.g. FXRP or wFLR). Set once at init.
    IERC20 public collateralToken;
    /// @notice Decimals of {collateralToken} (e.g. FXRP 6, wFLR 18); drives USD normalization.
    uint8 public collateralDecimals;
    address public feeReceiver;
    Params public params;
    /// @notice Per-branch vUSD mint cap (debt ceiling), Enosys-style. 0 = unlimited. Configurable.
    uint256 public debtCeiling;
    /// @notice Aggregate debt across all active vaults in this branch; equals this branch's share of
    ///         vUSD supply. Summed across branches it equals VUSD.totalSupply() (KTD5).
    uint256 public totalDebt;

    mapping(address => Vault) public vaults;
    /// @notice Per-vault vUSD funder for Guardian delegated repay (U8); defaults to the owner.
    mapping(address => address) public guardianFunder;
    SortedVaults.Data internal sorted;

    uint256[41] private __gap;

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

    event VaultOpened(address indexed owner, uint256 collateral6, uint256 debt18, uint256 nicr);
    event CollateralAdded(address indexed owner, uint256 amount6, uint256 newCollateral6);
    event CollateralWithdrawn(address indexed owner, uint256 amount6, uint256 newCollateral6);
    event DebtMinted(address indexed owner, uint256 minted18, uint256 fee18, uint256 newDebt18);
    event DebtRepaid(address indexed owner, uint256 amount18, uint256 newDebt18);
    event VaultClosed(address indexed owner, uint256 collateralReturned6, uint256 debtBurned18);
    event ParamsUpdated(Params params);
    event FeeReceiverUpdated(address indexed feeReceiver);
    event DebtCeilingUpdated(uint256 debtCeiling);
    event VaultLiquidated(
        address indexed owner,
        address indexed liquidator,
        uint256 debtCleared18,
        uint256 collateralToLiquidator6,
        uint256 collateralToOwner6
    );
    event Redemption(address indexed redeemer, uint256 vusdRedeemed18, uint256 fxrpPaid6, uint256 fee6);
    event GuardianFunderSet(address indexed owner, address indexed funder);
    event DelegatedRepay(address indexed owner, address indexed funder, uint256 amount18);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initialize a branch. Collateral-agnostic: the deploy script resolves the collateral
    ///         token (FXRP via registry->AssetManagerFXRP->fAsset(); wFLR via registry->WNat) and the
    ///         per-branch oracle (holding its feed id), and passes them here — nothing is hardcoded
    ///         (R8). The external runtime ABI is identical across branches; branches differ only by
    ///         these init parameters and by whether a VulcraZap is wired.
    /// @param admin Address granted admin/param/pauser/upgrader roles.
    /// @param collateralToken_ This branch's collateral token.
    /// @param collateralDecimals_ Decimals of the collateral token (e.g. 6 for FXRP, 18 for wFLR).
    /// @param oracle_ Per-branch PriceOracle (configured with this branch's feed id).
    /// @param vusd_ The shared vUSD token (one instance across all branches).
    /// @param feeReceiver_ Mint/redemption fee recipient.
    /// @param p Branch parameters (MCR, min debt, fees, bonus).
    /// @param debtCeiling_ Per-branch vUSD mint cap (0 = unlimited).
    function initialize(
        address admin,
        address collateralToken_,
        uint8 collateralDecimals_,
        address oracle_,
        address vusd_,
        address feeReceiver_,
        Params memory p,
        uint256 debtCeiling_
    ) external initializer {
        __AccessControl_init();
        __Pausable_init();
        if (
            collateralToken_ == address(0) || oracle_ == address(0) || vusd_ == address(0) || feeReceiver_ == address(0)
        ) {
            revert ZeroAddress();
        }
        _validateParams(p);
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
    }

    // --- open ---

    /// @notice Open a vault for the caller: deposit FXRP, mint vUSD to the caller (R1).
    function openVault(uint256 collateral6, uint256 mint18, address prevHint, address nextHint)
        external
        whenNotPaused
        nonReentrant
    {
        _open(msg.sender, msg.sender, collateral6, mint18, msg.sender, prevHint, nextHint);
    }

    /// @inheritdoc IVaultManager
    function openVaultFor(
        address owner,
        uint256 collateral6,
        uint256 mint18,
        address debtRecipient,
        address prevHint,
        address nextHint
    ) external whenNotPaused nonReentrant onlyRole(ZAP_ROLE) {
        if (owner == address(0) || debtRecipient == address(0)) revert ZeroAddress();
        _open(owner, msg.sender, collateral6, mint18, debtRecipient, prevHint, nextHint);
    }

    function _open(
        address owner,
        address payer,
        uint256 collateral6,
        uint256 mint18,
        address debtRecipient,
        address prevHint,
        address nextHint
    ) internal {
        if (vaults[owner].active) revert VaultExists();
        if (collateral6 == 0 || mint18 == 0) revert ZeroAmount();
        uint256 fee = (mint18 * params.mintFeeBps) / VulcraMath.BPS;
        uint256 debt = mint18 + fee;
        if (debt < params.minDebt18) revert DebtBelowMin();
        if (debtCeiling != 0 && totalDebt + debt > debtCeiling) revert DebtCeilingExceeded();
        _requireHealthy(collateral6, debt);

        vaults[owner] = Vault({collateral6: collateral6, debt18: debt, active: true});
        totalDebt += debt;
        uint256 nicr = VulcraMath.nicr(collateral6, debt);
        sorted.insert(owner, nicr, prevHint, nextHint);

        collateralToken.safeTransferFrom(payer, address(this), collateral6);
        vusdToken.mint(debtRecipient, mint18);
        if (fee > 0) vusdToken.mint(feeReceiver, fee);

        emit VaultOpened(owner, collateral6, debt, nicr);
    }

    // --- adjust ---

    /// @notice Add FXRP collateral to the caller's vault (always CR-improving).
    function addCollateral(uint256 amount6, address prevHint, address nextHint) external whenNotPaused nonReentrant {
        Vault storage vlt = vaults[msg.sender];
        if (!vlt.active) revert NoVault();
        if (amount6 == 0) revert ZeroAmount();
        vlt.collateral6 += amount6;
        sorted.reInsert(msg.sender, VulcraMath.nicr(vlt.collateral6, vlt.debt18), prevHint, nextHint);
        collateralToken.safeTransferFrom(msg.sender, address(this), amount6);
        emit CollateralAdded(msg.sender, amount6, vlt.collateral6);
    }

    /// @notice Withdraw FXRP collateral, keeping the vault at or above MCR.
    function withdrawCollateral(uint256 amount6, address prevHint, address nextHint)
        external
        whenNotPaused
        nonReentrant
    {
        Vault storage vlt = vaults[msg.sender];
        if (!vlt.active) revert NoVault();
        if (amount6 == 0) revert ZeroAmount();
        if (amount6 > vlt.collateral6) revert InsufficientCollateral();
        uint256 newColl = vlt.collateral6 - amount6;
        _requireHealthy(newColl, vlt.debt18);
        vlt.collateral6 = newColl;
        sorted.reInsert(msg.sender, VulcraMath.nicr(newColl, vlt.debt18), prevHint, nextHint);
        collateralToken.safeTransfer(msg.sender, amount6);
        emit CollateralWithdrawn(msg.sender, amount6, newColl);
    }

    /// @notice Mint more vUSD against the caller's existing vault (R1, R6).
    function mintMore(uint256 amount18, address prevHint, address nextHint) external whenNotPaused nonReentrant {
        Vault storage vlt = vaults[msg.sender];
        if (!vlt.active) revert NoVault();
        if (amount18 == 0) revert ZeroAmount();
        uint256 fee = (amount18 * params.mintFeeBps) / VulcraMath.BPS;
        uint256 newDebt = vlt.debt18 + amount18 + fee;
        if (newDebt < params.minDebt18) revert DebtBelowMin();
        if (debtCeiling != 0 && totalDebt + amount18 + fee > debtCeiling) revert DebtCeilingExceeded();
        _requireHealthy(vlt.collateral6, newDebt);
        vlt.debt18 = newDebt;
        totalDebt += amount18 + fee;
        sorted.reInsert(msg.sender, VulcraMath.nicr(vlt.collateral6, newDebt), prevHint, nextHint);
        vusdToken.mint(msg.sender, amount18);
        if (fee > 0) vusdToken.mint(feeReceiver, fee);
        emit DebtMinted(msg.sender, amount18, fee, newDebt);
    }

    /// @notice Repay part of the caller's debt by burning vUSD. Repay-in-full is allowed;
    ///         a partial repay may not leave dust below `minDebt18`.
    function repay(uint256 amount18, address prevHint, address nextHint) external nonReentrant {
        Vault storage vlt = vaults[msg.sender];
        if (!vlt.active) revert NoVault();
        if (amount18 == 0) revert ZeroAmount();
        if (amount18 > vlt.debt18) amount18 = vlt.debt18;
        uint256 newDebt = vlt.debt18 - amount18;
        if (newDebt != 0 && newDebt < params.minDebt18) revert DebtBelowMin();
        vlt.debt18 = newDebt;
        totalDebt -= amount18;
        sorted.reInsert(msg.sender, VulcraMath.nicr(vlt.collateral6, newDebt), prevHint, nextHint);
        vusdToken.burn(msg.sender, amount18);
        emit DebtRepaid(msg.sender, amount18, newDebt);
    }

    /// @notice Fully repay debt and withdraw all collateral, closing the vault.
    function closeVault() external nonReentrant {
        Vault storage vlt = vaults[msg.sender];
        if (!vlt.active) revert NoVault();
        uint256 debt = vlt.debt18;
        uint256 coll = vlt.collateral6;
        delete vaults[msg.sender];
        totalDebt -= debt;
        sorted.remove(msg.sender);
        if (debt > 0) vusdToken.burn(msg.sender, debt);
        if (coll > 0) collateralToken.safeTransfer(msg.sender, coll);
        emit VaultClosed(msg.sender, coll, debt);
    }

    // --- liquidation (R4) ---

    /// @notice Liquidate an undercollateralized vault: the caller burns the vault's full debt in
    ///         vUSD and receives collateral worth debt + liquidation bonus (capped at the vault's
    ///         collateral); any remainder returns to the owner (R4/AE5).
    /// @dev Allowed even while paused so the peg is defensible during emergencies.
    function liquidate(address owner) external nonReentrant {
        Vault storage vlt = vaults[owner];
        if (!vlt.active) revert NoVault();
        uint256 debt = vlt.debt18;
        uint256 coll = vlt.collateral6;

        uint256 price18 = oracle.price18();
        uint256 collValue = VulcraMath.collateralValueUsd18(coll, collateralDecimals, price18);
        if (VulcraMath.crBps(collValue, debt) >= params.mcrBps) revert NotLiquidatable();

        // Collateral owed to the liquidator: debt * (1 + bonus), converted to collateral, capped at coll.
        uint256 seizeValue = (debt * (VulcraMath.BPS + params.liqBonusBps)) / VulcraMath.BPS;
        uint256 seize6 = VulcraMath.collateralForUsd18(seizeValue, collateralDecimals, price18);
        if (seize6 > coll) seize6 = coll;
        uint256 toOwner6 = coll - seize6;

        delete vaults[owner];
        totalDebt -= debt;
        sorted.remove(owner);

        vusdToken.burn(msg.sender, debt);
        collateralToken.safeTransfer(msg.sender, seize6);
        if (toOwner6 > 0) collateralToken.safeTransfer(owner, toOwner6);

        emit VaultLiquidated(owner, msg.sender, debt, seize6, toOwner6);
    }

    // --- redemption (R5) ---

    /// @notice Redeem vUSD at face value for FXRP, drawing from the riskiest vaults first (R5/AE5).
    /// @param vusdAmount18 vUSD to redeem (burned from the caller); must not exceed system debt.
    /// @param maxIterations Cap on vaults touched (0 = unbounded; fine at testnet scale).
    /// @return fxrpPaid6 FXRP paid to the redeemer (net of any redemption fee).
    /// @dev Each touched vault loses equal USD value of collateral and debt, so its CR rises — good
    ///      for remaining borrowers. The redeemer captures the peg arbitrage when vUSD < $1.
    function redeem(uint256 vusdAmount18, uint256 maxIterations) external nonReentrant returns (uint256 fxrpPaid6) {
        if (vusdAmount18 == 0) revert ZeroAmount();
        if (vusdAmount18 > totalDebt) revert ExceedsSystemDebt();

        uint256 price18 = oracle.price18();
        uint256 remaining = vusdAmount18;
        uint256 grossFxrp6;
        uint256 iterations;
        address current = sorted.getLast(); // riskiest (lowest NICR)

        while (remaining > 0 && current != address(0)) {
            if (maxIterations != 0 && iterations >= maxIterations) break;
            address nextRiskier = sorted.getPrev(current); // toward head (higher NICR)
            Vault storage vlt = vaults[current];

            uint256 portion = remaining < vlt.debt18 ? remaining : vlt.debt18;
            uint256 coll6 = VulcraMath.collateralForUsd18(portion, collateralDecimals, price18);
            if (coll6 > vlt.collateral6) coll6 = vlt.collateral6; // bad-debt safety cap

            uint256 newDebt = vlt.debt18 - portion;
            uint256 newColl = vlt.collateral6 - coll6;
            totalDebt -= portion;
            remaining -= portion;
            grossFxrp6 += coll6;

            if (newDebt == 0) {
                delete vaults[current];
                sorted.remove(current);
                if (newColl > 0) collateralToken.safeTransfer(current, newColl); // return dust to owner
            } else {
                vlt.debt18 = newDebt;
                vlt.collateral6 = newColl;
                sorted.reInsert(current, VulcraMath.nicr(newColl, newDebt), address(0), address(0));
            }
            current = nextRiskier;
            unchecked {
                ++iterations;
            }
        }

        uint256 redeemed = vusdAmount18 - remaining;
        if (redeemed == 0) revert NothingRedeemed();

        vusdToken.burn(msg.sender, redeemed);
        uint256 fee6 = (grossFxrp6 * params.redemptionFeeBps) / VulcraMath.BPS;
        fxrpPaid6 = grossFxrp6 - fee6;
        collateralToken.safeTransfer(msg.sender, fxrpPaid6);
        if (fee6 > 0) collateralToken.safeTransfer(feeReceiver, fee6);

        emit Redemption(msg.sender, redeemed, fxrpPaid6, fee6);
    }

    // --- Vault Guardian delegated repay (R15 / KTD2) ---

    /// @notice Nominate the vUSD funding address the Guardian may pull from to protect your vault.
    /// @dev address(0) (the default) means the funder is the vault owner itself. Non-custodial:
    ///      the funder must have approved this contract; only a standard allowance is ever used.
    function setGuardianFunder(address funder) external {
        guardianFunder[msg.sender] = funder;
        emit GuardianFunderSet(msg.sender, funder);
    }

    /// @notice Repay part of a vault's debt on the owner's behalf, pulling vUSD from the nominated
    ///         funder via allowance. Callable only by the TEE Guardian executor (R15/AE3/KTD2).
    /// @dev Can only DECREASE debt (strictly CR-improving) and never touches collateral, so a
    ///      compromised executor cannot grief beyond repaying debt the owner already owes. The
    ///      private protection trigger lives in the TEE and is never visible on-chain beforehand —
    ///      only the {DelegatedRepay} event fires, at execution. A repay that would strand dust
    ///      below `minDebt` is clamped up to a full repay.
    /// @param owner Vault owner to protect.
    /// @param maxAmount18 Upper bound on vUSD to repay.
    function delegatedRepay(address owner, uint256 maxAmount18, address prevHint, address nextHint)
        external
        onlyRole(GUARDIAN_EXECUTOR_ROLE)
        nonReentrant
    {
        Vault storage vlt = vaults[owner];
        if (!vlt.active) revert NoVault();
        uint256 amount = maxAmount18 >= vlt.debt18 ? vlt.debt18 : maxAmount18;
        if (amount == 0) revert ZeroAmount();
        uint256 newDebt = vlt.debt18 - amount;
        if (newDebt != 0 && newDebt < params.minDebt18) {
            amount = vlt.debt18; // clamp: repay in full rather than strand dust
            newDebt = 0;
        }

        address funder = guardianFunder[owner];
        if (funder == address(0)) funder = owner;
        if (vusdToken.balanceOf(funder) < amount || vusdToken.allowance(funder, address(this)) < amount) {
            revert FunderInsufficient();
        }

        vlt.debt18 = newDebt;
        totalDebt -= amount;
        sorted.reInsert(owner, VulcraMath.nicr(vlt.collateral6, newDebt), prevHint, nextHint);

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

    function setFeeReceiver(address newReceiver) external onlyRole(PARAM_ADMIN_ROLE) {
        if (newReceiver == address(0)) revert ZeroAddress();
        feeReceiver = newReceiver;
        emit FeeReceiverUpdated(newReceiver);
    }

    /// @notice Update this branch's vUSD mint cap (0 = unlimited). Does not retroactively affect
    ///         existing debt; only gates new mints.
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
    function getVault(address owner) external view returns (uint256 collateral6, uint256 debt18, bool active) {
        Vault storage v = vaults[owner];
        return (v.collateral6, v.debt18, v.active);
    }

    /// @notice Collateral ratio (bps) of `owner`'s vault at the current price; 0 if no vault.
    function collateralRatioBps(address owner) public view returns (uint256) {
        Vault storage v = vaults[owner];
        if (!v.active) return 0;
        return VulcraMath.crBps(_collValue(v.collateral6), v.debt18);
    }

    /// @notice Whether `owner`'s vault is below MCR and thus liquidatable.
    function isLiquidatable(address owner) public view returns (bool) {
        Vault storage v = vaults[owner];
        if (!v.active) return false;
        return VulcraMath.crBps(_collValue(v.collateral6), v.debt18) < params.mcrBps;
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

    /// @notice Riskiest active vault (lowest CR) — redemption/liquidation entry point.
    function riskiestVault() external view returns (address) {
        return sorted.getLast();
    }

    /// @notice Number of active vaults.
    function vaultCount() external view returns (uint256) {
        return sorted.getSize();
    }

    function nominalCr(address owner) external view returns (uint256) {
        return sorted.nicrOf(owner);
    }

    /// @notice Safest active vault (highest CR).
    function safestVault() external view returns (address) {
        return sorted.getFirst();
    }

    /// @notice Next vault toward the riskiest end (lower CR) — for off-chain list traversal.
    function nextVault(address owner) external view returns (address) {
        return sorted.getNext(owner);
    }

    /// @notice Next vault toward the safest end (higher CR) — for off-chain list traversal.
    function prevVault(address owner) external view returns (address) {
        return sorted.getPrev(owner);
    }

    /// @inheritdoc IVaultManager
    /// @dev Backward-compatible alias for {collateralToken} kept for the deployed ABI. On the FXRP
    ///      branch it returns FXRP; on other branches it returns that branch's collateral token.
    ///      New integrations should prefer `collateralToken()` / `collateralDecimals()`.
    function fxrp() external view returns (address) {
        return address(collateralToken);
    }

    /// @inheritdoc IVaultManager
    function vusd() external view returns (address) {
        return address(vusdToken);
    }

    // --- internals ---

    /// @dev USD value (18-dec) of a raw collateral amount at the live price, using this branch's
    ///      collateral decimals. Single place that combines the oracle price with decimals.
    function _collValue(uint256 amount) internal view returns (uint256) {
        return VulcraMath.collateralValueUsd18(amount, collateralDecimals, oracle.price18());
    }

    function _requireHealthy(uint256 collateral, uint256 debt18) internal view {
        if (VulcraMath.crBps(_collValue(collateral), debt18) < params.mcrBps) {
            revert CRTooLow();
        }
    }

    function _validateParams(Params memory p) internal pure {
        if (p.mcrBps < 10_000 || p.mcrBps > 100_000) revert InvalidParams();
        if (p.minDebt18 == 0) revert InvalidParams();
        if (p.mintFeeBps > 1_000) revert InvalidParams();
        if (p.liqBonusBps > 5_000) revert InvalidParams();
        if (p.redemptionFeeBps > 1_000) revert InvalidParams();
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
