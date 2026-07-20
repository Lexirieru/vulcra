// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {
    ERC20PermitUpgradeable
} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import {EIP3009Upgradeable} from "./modules/EIP3009Upgradeable.sol";
import {IVUSD} from "./interfaces/IVUSD.sol";

/// @title VUSD
/// @notice Vulcra USD — an 18-decimal USD-pegged ERC-20 (R2).
/// @dev UUPS-upgradeable. Combines EIP-2612 permit (sequential nonce) and EIP-3009 authorization
///      (random-nonce) over a single shared EIP-712 domain. Mint and burn are restricted to
///      MINTER_ROLE, granted only to the VaultManager at deploy — vUSD only exists as vault debt.
contract VUSD is
    Initializable,
    ERC20Upgradeable,
    ERC20PermitUpgradeable,
    EIP3009Upgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable,
    IVUSD
{
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    /// @dev Storage gap for future layout evolution of this contract's own state.
    uint256[50] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param admin Address granted admin and upgrader roles. MINTER_ROLE is granted to the
    ///        VaultManager separately (deploy script), never to an EOA.
    function initialize(address admin) external initializer {
        __ERC20_init("Vulcra USD", "vUSD");
        __ERC20Permit_init("Vulcra USD"); // EIP-712 domain: name "Vulcra USD", version "1"
        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
    }

    /// @inheritdoc IVUSD
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /// @inheritdoc IVUSD
    function burn(address from, uint256 amount) external onlyRole(MINTER_ROLE) {
        _burn(from, amount);
    }

    /// @dev EIP-3009 transfer hook -> ERC-20 `_transfer`.
    function _executeTransfer(address from, address to, uint256 value) internal override {
        _transfer(from, to, value);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
