// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {SortedVaultsHarness} from "../helpers/SortedVaultsHarness.sol";
import {SortedVaults} from "../../src/libraries/SortedVaults.sol";

contract SortedVaultsTest is Test {
    SortedVaultsHarness internal h;

    address internal a = address(0xA);
    address internal b = address(0xB);
    address internal c = address(0xC);
    address internal d = address(0xD);

    function setUp() public {
        h = new SortedVaultsHarness();
    }

    function _z() internal pure returns (address) {
        return address(0);
    }

    function test_insertOrdersByNicr() public {
        // insert out of order; expect head=max NICR, tail=min NICR
        h.insert(a, 200e18, _z(), _z());
        h.insert(b, 100e18, _z(), _z());
        h.insert(c, 300e18, _z(), _z());
        h.insert(d, 150e18, _z(), _z());

        assertEq(h.size(), 4);
        assertEq(h.first(), c, "head = highest NICR");
        assertEq(h.last(), b, "tail = lowest NICR");
        assertTrue(h.checkOrdered());

        // head->tail order: c(300) a(200) d(150) b(100)
        assertEq(h.next(c), a);
        assertEq(h.next(a), d);
        assertEq(h.next(d), b);
        assertEq(h.next(b), _z());
    }

    function test_singleElement() public {
        h.insert(a, 200e18, _z(), _z());
        assertEq(h.first(), a);
        assertEq(h.last(), a);
        assertEq(h.next(a), _z());
        assertEq(h.prev(a), _z());
        assertTrue(h.checkOrdered());
    }

    function test_duplicateNicrTieBreak() public {
        h.insert(a, 100e18, _z(), _z());
        h.insert(b, 100e18, _z(), _z()); // equal NICR -> inserted after a (toward tail)
        h.insert(c, 100e18, _z(), _z());
        assertEq(h.first(), a);
        assertEq(h.next(a), b);
        assertEq(h.next(b), c);
        assertEq(h.last(), c);
        assertTrue(h.checkOrdered());
    }

    function test_reInsert_moves() public {
        h.insert(a, 200e18, _z(), _z());
        h.insert(b, 100e18, _z(), _z());
        h.insert(c, 300e18, _z(), _z());
        // move b from lowest to highest
        h.reInsert(b, 400e18, _z(), _z());
        assertEq(h.first(), b, "b now highest");
        assertEq(h.last(), a, "a now lowest");
        assertTrue(h.checkOrdered());
    }

    function test_removeHeadTailMiddle() public {
        h.insert(a, 200e18, _z(), _z());
        h.insert(b, 100e18, _z(), _z());
        h.insert(c, 300e18, _z(), _z());
        // list: c(head) a b(tail)
        h.remove(a); // middle
        assertEq(h.next(c), b);
        assertEq(h.prev(b), c);
        assertTrue(h.checkOrdered());
        h.remove(c); // head
        assertEq(h.first(), b);
        assertEq(h.prev(b), _z());
        assertTrue(h.checkOrdered());
        h.remove(b); // tail (last remaining)
        assertTrue(h.isEmpty());
        assertEq(h.first(), _z());
        assertEq(h.last(), _z());
    }

    function test_validHintFastPath() public {
        h.insert(a, 300e18, _z(), _z());
        h.insert(b, 100e18, _z(), _z());
        // insert c=200 between a(300) and b(100) with exact hints
        h.insert(c, 200e18, a, b);
        assertEq(h.next(a), c);
        assertEq(h.next(c), b);
        assertTrue(h.checkOrdered());
    }

    function test_staleHintFallsBack() public {
        h.insert(a, 300e18, _z(), _z());
        h.insert(b, 100e18, _z(), _z());
        // bogus hints referencing non-members -> library falls back to descent and still orders
        h.insert(c, 200e18, address(0xdead), address(0xbeef));
        assertEq(h.next(a), c);
        assertEq(h.next(c), b);
        assertTrue(h.checkOrdered());
    }

    function test_revert_insertExisting() public {
        h.insert(a, 100e18, _z(), _z());
        vm.expectRevert(SortedVaults.AlreadyInList.selector);
        h.insert(a, 200e18, _z(), _z());
    }

    function test_revert_removeMissing() public {
        vm.expectRevert(SortedVaults.NotInList.selector);
        h.remove(a);
    }

    function test_revert_insertZeroId() public {
        vm.expectRevert(SortedVaults.ZeroId.selector);
        h.insert(address(0), 100e18, _z(), _z());
    }

    function test_revert_reInsertMissing() public {
        vm.expectRevert(SortedVaults.NotInList.selector);
        h.reInsert(a, 100e18, _z(), _z());
    }
}
