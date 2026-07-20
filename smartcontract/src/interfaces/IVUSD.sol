// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IVUSD
/// @notice Vulcra USD stablecoin: ERC-20 with protocol-restricted mint/burn.
/// @dev EIP-2612 permit and EIP-3009 authorization surfaces live on the concrete contract; this
///      interface exposes what the protocol (VaultManager) depends on.
interface IVUSD is IERC20 {
    /// @notice Mint `amount` to `to`. Restricted to MINTER_ROLE (VaultManager).
    function mint(address to, uint256 amount) external;

    /// @notice Burn `amount` from `from`. Restricted to MINTER_ROLE (VaultManager).
    function burn(address from, uint256 amount) external;
}
