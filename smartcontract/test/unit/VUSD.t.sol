// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {VUSD} from "../../src/VUSD.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

contract VUSDTest is Test {
    VUSD internal vusd;
    address internal admin = makeAddr("admin");
    address internal minter = makeAddr("minter"); // stands in for VaultManager
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    function setUp() public {
        vm.warp(1_800_000_000);
        VUSD impl = new VUSD();
        vusd = VUSD(address(new ERC1967Proxy(address(impl), abi.encodeCall(VUSD.initialize, (admin)))));
        bytes32 minterRole = vusd.MINTER_ROLE();
        vm.prank(admin);
        vusd.grantRole(minterRole, minter);
    }

    function test_metadata() public view {
        assertEq(vusd.name(), "Vulcra USD");
        assertEq(vusd.symbol(), "vUSD");
        assertEq(vusd.decimals(), 18);
    }

    function test_mint_byMinter() public {
        vm.prank(minter);
        vusd.mint(alice, 1000e18);
        assertEq(vusd.balanceOf(alice), 1000e18);
        assertEq(vusd.totalSupply(), 1000e18);
    }

    function test_burn_byMinter() public {
        vm.prank(minter);
        vusd.mint(alice, 1000e18);
        vm.prank(minter);
        vusd.burn(alice, 400e18);
        assertEq(vusd.balanceOf(alice), 600e18);
        assertEq(vusd.totalSupply(), 600e18);
    }

    function test_revert_mint_notMinter() public {
        vm.expectRevert();
        vm.prank(alice);
        vusd.mint(alice, 1e18);
    }

    function test_revert_burn_notMinter() public {
        vm.prank(minter);
        vusd.mint(alice, 1e18);
        vm.expectRevert();
        vm.prank(bob);
        vusd.burn(alice, 1e18);
    }

    function test_permit_setsAllowance() public {
        (address owner, uint256 pk) = makeAddrAndKey("permitOwner");
        uint256 value = 500e18;
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = vusd.nonces(owner);

        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, bob, value, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", vusd.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);

        vusd.permit(owner, bob, value, deadline, v, r, s);
        assertEq(vusd.allowance(owner, bob), value);
        assertEq(vusd.nonces(owner), nonce + 1);
    }

    function test_revert_permit_expiredDeadline() public {
        (address owner, uint256 pk) = makeAddrAndKey("permitOwner2");
        uint256 deadline = block.timestamp - 1;
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, bob, 1e18, vusd.nonces(owner), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", vusd.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        vm.expectRevert();
        vusd.permit(owner, bob, 1e18, deadline, v, r, s);
    }

    function test_permitAndAuthorizationNoncesIndependent() public {
        // EIP-2612 uses a sequential nonce; EIP-3009 uses a separate random-nonce mapping.
        (address owner,) = makeAddrAndKey("permitOwner");
        assertEq(vusd.nonces(owner), 0);
        // A random 3009 nonce is unused regardless of the permit nonce.
        assertEq(vusd.authorizationState(owner, keccak256("random")), false);
    }
}
