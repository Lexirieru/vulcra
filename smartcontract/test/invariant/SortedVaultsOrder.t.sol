// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {SortedVaultsHarness} from "../helpers/SortedVaultsHarness.sol";

/// @notice Random insert/remove/reInsert over a bounded actor set (no hints -> descent path).
contract SortedVaultsHandler is Test {
    SortedVaultsHarness public h;
    address[] internal actors;
    mapping(address => bool) public inList;

    constructor() {
        h = new SortedVaultsHarness();
        for (uint256 i = 0; i < 8; i++) {
            actors.push(address(uint160(0x1000 + i)));
        }
    }

    function insert(uint256 actorSeed, uint256 nicr) external {
        address id = actors[actorSeed % actors.length];
        if (inList[id]) return;
        h.insert(id, bound(nicr, 1, 1e24), address(0), address(0));
        inList[id] = true;
    }

    function remove(uint256 actorSeed) external {
        address id = actors[actorSeed % actors.length];
        if (!inList[id]) return;
        h.remove(id);
        inList[id] = false;
    }

    function reInsert(uint256 actorSeed, uint256 nicr) external {
        address id = actors[actorSeed % actors.length];
        if (!inList[id]) return;
        h.reInsert(id, bound(nicr, 1, 1e24), address(0), address(0));
    }
}

contract SortedVaultsOrderInvariant is Test {
    SortedVaultsHandler internal handler;

    function setUp() public {
        handler = new SortedVaultsHandler();
        targetContract(address(handler));
    }

    /// @dev List is always ordered (monotonic head->tail, tail = min NICR, size consistent).
    function invariant_alwaysOrdered() public view {
        assertTrue(handler.h().checkOrdered(), "sorted list order invariant broken");
    }
}
