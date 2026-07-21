// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {StabilityPool} from "../../src/StabilityPool.sol";

/// @title StabilityPoolV2Mock
/// @notice Trivial V2 for the UUPS upgrade test: inherits the full V1 layout (so storage is
///         preserved), appends one variable, and adds new behavior to prove the new code runs.
contract StabilityPoolV2Mock is StabilityPool {
    uint256 public newFeature;

    function version() external pure returns (uint256) {
        return 2;
    }

    function setNewFeature(uint256 value) external {
        newFeature = value;
    }
}
