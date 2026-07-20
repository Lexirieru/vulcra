// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SortedVaults} from "../../src/libraries/SortedVaults.sol";

/// @notice Thin external wrapper exposing the {SortedVaults} library for testing.
contract SortedVaultsHarness {
    using SortedVaults for SortedVaults.Data;

    SortedVaults.Data internal list;

    function insert(address id, uint256 nicr, address prev, address next) external {
        list.insert(id, nicr, prev, next);
    }

    function remove(address id) external {
        list.remove(id);
    }

    function reInsert(address id, uint256 nicr, address prev, address next) external {
        list.reInsert(id, nicr, prev, next);
    }

    function contains(address id) external view returns (bool) {
        return list.contains(id);
    }

    function isEmpty() external view returns (bool) {
        return list.isEmpty();
    }

    function size() external view returns (uint256) {
        return list.getSize();
    }

    function first() external view returns (address) {
        return list.getFirst();
    }

    function last() external view returns (address) {
        return list.getLast();
    }

    function next(address id) external view returns (address) {
        return list.getNext(id);
    }

    function prev(address id) external view returns (address) {
        return list.getPrev(id);
    }

    function nicrOf(address id) external view returns (uint256) {
        return list.nicrOf(id);
    }

    /// @notice Walk head->tail; assert NICR is non-increasing and the node count matches size.
    function checkOrdered() external view returns (bool) {
        uint256 count;
        address cur = list.getFirst();
        uint256 lastNicr = type(uint256).max;
        address prevNode = address(0);
        while (cur != address(0)) {
            uint256 n = list.nicrOf(cur);
            if (n > lastNicr) return false; // must be non-increasing head->tail
            if (list.getPrev(cur) != prevNode) return false; // back-link consistency
            lastNicr = n;
            prevNode = cur;
            cur = list.getNext(cur);
            count++;
            if (count > list.getSize() + 1) return false; // cycle guard
        }
        if (count != list.getSize()) return false;
        if (prevNode != list.getLast()) return false; // last visited must be the tail
        return true;
    }
}
