// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {TestFtsoV2Interface} from "@flarenetwork/flare-periphery-contracts/coston2/TestFtsoV2Interface.sol";

import {IPriceOracle} from "./interfaces/IPriceOracle.sol";
import {VulcraMath} from "./libraries/VulcraMath.sol";

/// @title PriceOracle
/// @notice UUPS-upgradeable, feed-agnostic oracle wrapping an FTSOv2 block-latency feed. One
///         instance is deployed per Vulcra branch, parameterized by its `feedId` (e.g. XRP/USD for
///         the FXRP branch, FLR/USD for the wFLR branch).
/// @dev Resolves FtsoV2 at runtime via `ContractRegistry` (zero hardcoded system addresses, R8).
///      Uses `getTestFtsoV2()` — on Coston2 the block-latency view read is free (no fee), and the
///      `TestFtsoV2Interface.getFeedById` is `view`, so callers (VaultManager CR checks, previews)
///      read the price without paying a fee. This is the same live FtsoV2 contract the production
///      interface points at; there is no mock in the deployed path. Decimal normalization is
///      centralized here and in {VulcraMath} (KTD3/KTD4).
contract PriceOracle is Initializable, AccessControlUpgradeable, UUPSUpgradeable, IPriceOracle {
    bytes32 public constant PARAM_ADMIN_ROLE = keccak256("PARAM_ADMIN_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    /// @inheritdoc IPriceOracle
    bytes21 public feedId;
    /// @inheritdoc IPriceOracle
    uint64 public maxStalenessSeconds;

    /// @dev Storage gap for future upgrades of this contract's own layout.
    uint256[48] private __gap;

    error ZeroPrice();
    error StalePrice(uint64 feedTimestamp, uint256 nowTimestamp, uint64 maxStaleness);
    error InvalidStaleness();

    event MaxStalenessUpdated(uint64 oldValue, uint64 newValue);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param admin Address granted admin, param-admin, and upgrader roles.
    /// @param _feedId Block-latency FTSO feed id for this branch (e.g. XRP/USD or FLR/USD).
    /// @param _maxStalenessSeconds Maximum feed age before {StalePrice} reverts.
    function initialize(address admin, bytes21 _feedId, uint64 _maxStalenessSeconds) external initializer {
        __AccessControl_init();
        if (_maxStalenessSeconds == 0) revert InvalidStaleness();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PARAM_ADMIN_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
        feedId = _feedId;
        maxStalenessSeconds = _maxStalenessSeconds;
    }

    /// @inheritdoc IPriceOracle
    function price18() public view returns (uint256) {
        (uint256 value, int8 decimals, uint64 timestamp) = ContractRegistry.getTestFtsoV2().getFeedById(feedId);
        if (value == 0) revert ZeroPrice();
        if (block.timestamp > timestamp && block.timestamp - timestamp > maxStalenessSeconds) {
            revert StalePrice(timestamp, block.timestamp, maxStalenessSeconds);
        }
        return VulcraMath.toPrice18(value, decimals);
    }

    /// @notice Update the staleness bound (param admin only).
    function setMaxStalenessSeconds(uint64 newValue) external onlyRole(PARAM_ADMIN_ROLE) {
        if (newValue == 0) revert InvalidStaleness();
        emit MaxStalenessUpdated(maxStalenessSeconds, newValue);
        maxStalenessSeconds = newValue;
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
