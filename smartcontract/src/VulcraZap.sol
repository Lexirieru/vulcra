// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IVaultManager} from "./interfaces/IVaultManager.sol";
import {IVulcraZap} from "./interfaces/IVulcraZap.sol";

/// @title VulcraZap
/// @notice Stateless, hold-free helper that lets an XRPL user mint FXRP -> open a vault -> receive
///         vUSD atomically in one Flare transaction via the Smart Accounts 0xFE custom instruction.
/// @dev UUPS-upgradeable. It is the single call target from the PersonalAccount in the atomic mint
///      batch. It never holds funds across a call: FXRP flows caller -> Zap -> VaultManager, vUSD is
///      minted straight to the destination. Any inner revert bubbles up so the direct-mint tx rolls
///      back and no FXRP is minted (R10/AE4).
contract VulcraZap is Initializable, AccessControlUpgradeable, ReentrancyGuardTransient, UUPSUpgradeable, IVulcraZap {
    using SafeERC20 for IERC20;

    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    IVaultManager public vaultManager;
    IERC20 public fxrpToken;

    uint256[50] private __gap;

    error ZeroAddress();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address vaultManager_) external initializer {
        __AccessControl_init();
        if (vaultManager_ == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
        vaultManager = IVaultManager(vaultManager_);
        fxrpToken = IERC20(IVaultManager(vaultManager_).fxrp());
    }

    /// @inheritdoc IVulcraZap
    function openVaultAndForward(
        uint256 collateral6,
        uint256 mint18,
        uint256 annualInterestRateBps,
        address vusdDestination,
        address prevHint,
        address nextHint
    ) external nonReentrant {
        // Pull the freshly minted FXRP from the caller (PersonalAccount approved it in Call[0]).
        fxrpToken.safeTransferFrom(msg.sender, address(this), collateral6);
        fxrpToken.forceApprove(address(vaultManager), collateral6);
        // Vault owned by the caller (PersonalAccount); vUSD delivered to the destination.
        vaultManager.openVaultFor(
            msg.sender, collateral6, mint18, annualInterestRateBps, vusdDestination, prevHint, nextHint
        );
    }

    /// @inheritdoc IVulcraZap
    function openVaultAndForwardAll(
        uint256 mint18,
        uint256 annualInterestRateBps,
        address vusdDestination,
        address prevHint,
        address nextHint
    ) external nonReentrant {
        // Read the caller's ENTIRE FXRP balance at execution time instead of trusting an amount
        // baked into the userOp. The 0xFE memo commits keccak256(userOp) BEFORE the direct mint, so
        // any collateral figure in the calldata is only a prediction — and the net minted is the
        // amount after `feeBIPS`, rounded to AMG granularity, minus `executorFeeUBA`. Pulling the
        // live balance makes fee/rounding changes unable to strand a mint (Flare-admin guidance).
        uint256 collateral6 = fxrpToken.balanceOf(msg.sender);
        fxrpToken.safeTransferFrom(msg.sender, address(this), collateral6);
        fxrpToken.forceApprove(address(vaultManager), collateral6);
        // Vault owned by the caller (PersonalAccount); vUSD delivered to the destination.
        vaultManager.openVaultFor(
            msg.sender, collateral6, mint18, annualInterestRateBps, vusdDestination, prevHint, nextHint
        );
    }

    /// @inheritdoc IVulcraZap
    function previewOpen(uint256 collateral6, uint256 mint18)
        external
        view
        returns (uint256 debt18, uint256 crBps, bool meetsMcr, bool meetsMinDebt)
    {
        return vaultManager.previewOpen(collateral6, mint18);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
