// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {VUSD} from "../../src/VUSD.sol";
import {EIP3009Upgradeable} from "../../src/modules/EIP3009Upgradeable.sol";

/// @notice EIP-3009 authorization suite: transfer / receive / cancel, windows, replay (R2).
contract VUSDAuthorizationTest is Test {
    VUSD internal vusd;
    address internal admin = makeAddr("admin");
    address internal minter = makeAddr("minter");

    address internal from;
    uint256 internal fromPk;
    address internal to = makeAddr("to");

    function setUp() public {
        vm.warp(1_800_000_000);
        VUSD impl = new VUSD();
        vusd = VUSD(address(new ERC1967Proxy(address(impl), abi.encodeCall(VUSD.initialize, (admin)))));
        bytes32 minterRole = vusd.MINTER_ROLE();
        vm.prank(admin);
        vusd.grantRole(minterRole, minter);
        (from, fromPk) = makeAddrAndKey("from");
        vm.prank(minter);
        vusd.mint(from, 1000e18);
    }

    function _digest(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", vusd.DOMAIN_SEPARATOR(), structHash));
    }

    function _signTransfer(
        uint256 pk,
        address _from,
        address _to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash = keccak256(
            abi.encode(vusd.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), _from, _to, value, validAfter, validBefore, nonce)
        );
        (v, r, s) = vm.sign(pk, _digest(structHash));
    }

    function test_transferWithAuthorization() public {
        bytes32 nonce = keccak256("n1");
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(fromPk, from, to, 250e18, 0, block.timestamp + 1 hours, nonce);

        vusd.transferWithAuthorization(from, to, 250e18, 0, block.timestamp + 1 hours, nonce, v, r, s);

        assertEq(vusd.balanceOf(to), 250e18);
        assertEq(vusd.balanceOf(from), 750e18);
        assertTrue(vusd.authorizationState(from, nonce));
    }

    function test_revert_replay() public {
        bytes32 nonce = keccak256("n2");
        uint256 vb = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(fromPk, from, to, 100e18, 0, vb, nonce);
        vusd.transferWithAuthorization(from, to, 100e18, 0, vb, nonce, v, r, s);

        vm.expectRevert(EIP3009Upgradeable.AuthorizationAlreadyUsed.selector);
        vusd.transferWithAuthorization(from, to, 100e18, 0, vb, nonce, v, r, s);
    }

    function test_revert_notYetValid() public {
        bytes32 nonce = keccak256("n3");
        uint256 va = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(fromPk, from, to, 100e18, va, block.timestamp + 2 hours, nonce);
        vm.expectRevert(EIP3009Upgradeable.AuthorizationNotYetValid.selector);
        vusd.transferWithAuthorization(from, to, 100e18, va, block.timestamp + 2 hours, nonce, v, r, s);
    }

    function test_revert_expired() public {
        bytes32 nonce = keccak256("n4");
        uint256 vb = block.timestamp; // validBefore == now => expired (strict <)
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(fromPk, from, to, 100e18, 0, vb, nonce);
        vm.expectRevert(EIP3009Upgradeable.AuthorizationExpired.selector);
        vusd.transferWithAuthorization(from, to, 100e18, 0, vb, nonce, v, r, s);
    }

    function test_validAtExactValidAfterBound() public {
        bytes32 nonce = keccak256("n5");
        uint256 va = block.timestamp; // exactly validAfter is allowed (>=)
        uint256 vb = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(fromPk, from, to, 10e18, va, vb, nonce);
        vusd.transferWithAuthorization(from, to, 10e18, va, vb, nonce, v, r, s);
        assertEq(vusd.balanceOf(to), 10e18);
    }

    function test_revert_wrongSigner() public {
        bytes32 nonce = keccak256("n6");
        (, uint256 wrongPk) = makeAddrAndKey("wrong");
        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(wrongPk, from, to, 100e18, 0, block.timestamp + 1 hours, nonce);
        vm.expectRevert(EIP3009Upgradeable.InvalidAuthorizationSigner.selector);
        vusd.transferWithAuthorization(from, to, 100e18, 0, block.timestamp + 1 hours, nonce, v, r, s);
    }

    function test_receiveWithAuthorization_requiresPayee() public {
        bytes32 nonce = keccak256("n7");
        uint256 vb = block.timestamp + 1 hours;
        bytes32 structHash =
            keccak256(abi.encode(vusd.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), from, to, 50e18, uint256(0), vb, nonce));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(fromPk, _digest(structHash));

        // Wrong caller (not the payee) reverts.
        vm.expectRevert(EIP3009Upgradeable.CallerNotPayee.selector);
        vusd.receiveWithAuthorization(from, to, 50e18, 0, vb, nonce, v, r, s);

        // Payee submits successfully.
        vm.prank(to);
        vusd.receiveWithAuthorization(from, to, 50e18, 0, vb, nonce, v, r, s);
        assertEq(vusd.balanceOf(to), 50e18);
    }

    function test_cancelAuthorization_thenUseReverts() public {
        bytes32 nonce = keccak256("n8");
        uint256 vb = block.timestamp + 1 hours;

        bytes32 cancelHash = keccak256(abi.encode(vusd.CANCEL_AUTHORIZATION_TYPEHASH(), from, nonce));
        (uint8 cv, bytes32 cr, bytes32 cs) = vm.sign(fromPk, _digest(cancelHash));
        vusd.cancelAuthorization(from, nonce, cv, cr, cs);
        assertTrue(vusd.authorizationState(from, nonce));

        (uint8 v, bytes32 r, bytes32 s) = _signTransfer(fromPk, from, to, 100e18, 0, vb, nonce);
        vm.expectRevert(EIP3009Upgradeable.AuthorizationAlreadyUsed.selector);
        vusd.transferWithAuthorization(from, to, 100e18, 0, vb, nonce, v, r, s);
    }
}
