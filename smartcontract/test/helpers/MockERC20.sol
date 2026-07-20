// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Minimal mintable ERC-20 with configurable decimals — a test stand-in for FXRP (6-dec).
/// @dev Production resolves the real FXRP token via ContractRegistry -> AssetManagerFXRP.fAsset();
///      this double exists only so unit/fuzz tests can control collateral balances deterministically.
contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
        _decimals = d;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
