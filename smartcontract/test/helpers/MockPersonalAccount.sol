// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Test double for a Flare Smart Accounts PersonalAccount's atomic `executeUserOp(Call[])`.
/// @dev Mirrors the real dispatch: each Call runs in order; if any reverts, the whole batch reverts
///      (bubbling the revert reason), matching the atomicity of `executeDirectMintingWithData`.
///      Not a production Flare-path mock — it only stands in for the external actor in tests.
contract MockPersonalAccount {
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    function executeUserOp(Call[] calldata calls) external payable {
        for (uint256 i; i < calls.length; i++) {
            (bool ok, bytes memory ret) = calls[i].target.call{value: calls[i].value}(calls[i].data);
            if (!ok) {
                assembly {
                    revert(add(ret, 0x20), mload(ret))
                }
            }
        }
    }
}
