// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title EIP3009Upgradeable
/// @notice EIP-3009 `transferWithAuthorization` / `receiveWithAuthorization` / `cancelAuthorization`.
/// @dev Not part of OpenZeppelin. Reuses the EIP-712 domain from the token's permit base (single
///      shared {EIP712Upgradeable} instance via C3 linearization — initialized once by the token's
///      `__ERC20Permit_init`). Authorization nonces are **random 32-byte values** tracked in a
///      dedicated mapping, independent of the sequential EIP-2612 permit nonce (R2). Concrete tokens
///      implement {_executeTransfer} to move value through their ERC-20 `_transfer`.
abstract contract EIP3009Upgradeable is Initializable, EIP712Upgradeable {
    // keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        keccak256(
            "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
        );
    // keccak256("ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH =
        keccak256(
            "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
        );
    // keccak256("CancelAuthorization(address authorizer,bytes32 nonce)")
    bytes32 public constant CANCEL_AUTHORIZATION_TYPEHASH =
        keccak256("CancelAuthorization(address authorizer,bytes32 nonce)");

    /// @dev authorizer => nonce => used-or-canceled.
    mapping(address => mapping(bytes32 => bool)) private _authorizationStates;

    /// @dev Storage gap for future layout evolution of this module.
    uint256[49] private __gap;

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce);

    error AuthorizationNotYetValid();
    error AuthorizationExpired();
    error AuthorizationAlreadyUsed();
    error InvalidAuthorizationSigner();
    error CallerNotPayee();

    /// @notice Whether an authorization nonce has been used or canceled.
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
        return _authorizationStates[authorizer][nonce];
    }

    /// @notice Execute a transfer authorized off-chain by `from` (EIP-3009).
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        _validateWindow(validAfter, validBefore);
        _requireUnused(from, nonce);
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce
            )
        );
        _requireSigner(from, structHash, v, r, s);
        _markUsed(from, nonce);
        _executeTransfer(from, to, value);
    }

    /// @notice Like {transferWithAuthorization} but only the intended payee (`to`) may submit it,
    ///         preventing front-running of the transfer into a contract that reacts on receipt.
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (to != msg.sender) revert CallerNotPayee();
        _validateWindow(validAfter, validBefore);
        _requireUnused(from, nonce);
        bytes32 structHash = keccak256(
            abi.encode(
                RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce
            )
        );
        _requireSigner(from, structHash, v, r, s);
        _markUsed(from, nonce);
        _executeTransfer(from, to, value);
    }

    /// @notice Cancel an unused authorization, signed by the authorizer.
    function cancelAuthorization(address authorizer, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)
        external
    {
        _requireUnused(authorizer, nonce);
        bytes32 structHash = keccak256(abi.encode(CANCEL_AUTHORIZATION_TYPEHASH, authorizer, nonce));
        _requireSigner(authorizer, structHash, v, r, s);
        _authorizationStates[authorizer][nonce] = true;
        emit AuthorizationCanceled(authorizer, nonce);
    }

    function _validateWindow(uint256 validAfter, uint256 validBefore) private view {
        if (block.timestamp < validAfter) revert AuthorizationNotYetValid();
        if (block.timestamp >= validBefore) revert AuthorizationExpired();
    }

    function _requireUnused(address authorizer, bytes32 nonce) private view {
        if (_authorizationStates[authorizer][nonce]) revert AuthorizationAlreadyUsed();
    }

    function _requireSigner(address expected, bytes32 structHash, uint8 v, bytes32 r, bytes32 s)
        private
        view
    {
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), v, r, s);
        if (signer != expected) revert InvalidAuthorizationSigner();
    }

    function _markUsed(address authorizer, bytes32 nonce) private {
        _authorizationStates[authorizer][nonce] = true;
        emit AuthorizationUsed(authorizer, nonce);
    }

    /// @dev Move `value` from `from` to `to` through the concrete token's ERC-20 transfer.
    function _executeTransfer(address from, address to, uint256 value) internal virtual;
}
