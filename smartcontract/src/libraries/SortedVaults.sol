// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title SortedVaults
/// @notice Doubly-linked list of vaults ordered by nominal collateral ratio (NICR).
/// @dev Liquity `SortedTroves` pattern (KTD1), implemented as a library over caller-owned storage
///      so {VaultManager} remains the single storage owner. `head` holds the highest NICR (safest),
///      `tail` the lowest (riskiest); redemption and liquidation targeting read the tail. Because a
///      single price multiplies every vault, NICR ordering equals actual-CR ordering, so the list
///      only changes on vault mutations — never on a price tick. Each node stores its NICR so the
///      library is self-contained (no callback to read ratios). Insertion validates caller hints for
///      an O(1) path and falls back to a bounded descent from the head.
library SortedVaults {
    /// @dev Bounded fallback-descent cap; past it, callers must supply fresh hints.
    uint256 internal constant MAX_SEARCH_STEPS = 400;

    struct Node {
        bool exists;
        uint256 nicr;
        address prev; // toward head (higher NICR)
        address next; // toward tail (lower NICR)
    }

    struct Data {
        address head; // highest NICR
        address tail; // lowest NICR (riskiest)
        uint256 size;
        mapping(address => Node) nodes;
    }

    error AlreadyInList();
    error NotInList();
    error ZeroId();
    error BadHint();

    // --- views ---

    function contains(Data storage d, address id) internal view returns (bool) {
        return d.nodes[id].exists;
    }

    function isEmpty(Data storage d) internal view returns (bool) {
        return d.size == 0;
    }

    function getSize(Data storage d) internal view returns (uint256) {
        return d.size;
    }

    /// @notice Safest vault (highest NICR).
    function getFirst(Data storage d) internal view returns (address) {
        return d.head;
    }

    /// @notice Riskiest vault (lowest NICR) — redemption/liquidation target.
    function getLast(Data storage d) internal view returns (address) {
        return d.tail;
    }

    /// @notice Neighbour toward the tail (next-lower NICR).
    function getNext(Data storage d, address id) internal view returns (address) {
        return d.nodes[id].next;
    }

    /// @notice Neighbour toward the head (next-higher NICR).
    function getPrev(Data storage d, address id) internal view returns (address) {
        return d.nodes[id].prev;
    }

    function nicrOf(Data storage d, address id) internal view returns (uint256) {
        return d.nodes[id].nicr;
    }

    // --- mutations ---

    /// @notice Insert `id` at its NICR-ordered position.
    /// @param prevHint Suggested higher-NICR neighbour (toward head); address(0) if at head.
    /// @param nextHint Suggested lower-NICR neighbour (toward tail); address(0) if at tail.
    function insert(Data storage d, address id, uint256 nicr, address prevHint, address nextHint)
        internal
    {
        if (id == address(0)) revert ZeroId();
        if (d.nodes[id].exists) revert AlreadyInList();

        (address prev, address next) = _findInsertPosition(d, nicr, prevHint, nextHint);

        d.nodes[id] = Node({exists: true, nicr: nicr, prev: prev, next: next});
        if (prev == address(0)) {
            d.head = id;
        } else {
            d.nodes[prev].next = id;
        }
        if (next == address(0)) {
            d.tail = id;
        } else {
            d.nodes[next].prev = id;
        }
        d.size += 1;
    }

    /// @notice Remove `id` from the list.
    function remove(Data storage d, address id) internal {
        if (!d.nodes[id].exists) revert NotInList();
        Node memory n = d.nodes[id];
        if (n.prev == address(0)) {
            d.head = n.next;
        } else {
            d.nodes[n.prev].next = n.next;
        }
        if (n.next == address(0)) {
            d.tail = n.prev;
        } else {
            d.nodes[n.next].prev = n.prev;
        }
        delete d.nodes[id];
        d.size -= 1;
    }

    /// @notice Move `id` to the position implied by `newNicr` (remove + insert).
    function reInsert(
        Data storage d,
        address id,
        uint256 newNicr,
        address prevHint,
        address nextHint
    ) internal {
        if (!d.nodes[id].exists) revert NotInList();
        remove(d, id);
        insert(d, id, newNicr, prevHint, nextHint);
    }

    // --- internals ---

    function _findInsertPosition(Data storage d, uint256 nicr, address prevHint, address nextHint)
        private
        view
        returns (address, address)
    {
        // Discard hints that reference non-members (e.g. a stale or self-referential hint).
        if (prevHint != address(0) && !d.nodes[prevHint].exists) prevHint = address(0);
        if (nextHint != address(0) && !d.nodes[nextHint].exists) nextHint = address(0);

        if (_validInsertPosition(d, nicr, prevHint, nextHint)) {
            return (prevHint, nextHint);
        }
        return _descendFromHead(d, nicr);
    }

    function _validInsertPosition(Data storage d, uint256 nicr, address prev, address next)
        private
        view
        returns (bool)
    {
        if (prev == address(0) && next == address(0)) {
            return isEmpty(d);
        } else if (prev == address(0)) {
            return d.head == next && nicr >= d.nodes[next].nicr;
        } else if (next == address(0)) {
            return d.tail == prev && nicr <= d.nodes[prev].nicr;
        } else {
            return d.nodes[prev].next == next && d.nodes[prev].nicr >= nicr
                && nicr >= d.nodes[next].nicr;
        }
    }

    /// @dev Walk from head (highest NICR) toward tail until reaching the first node with a strictly
    ///      lower NICR; the new node is inserted just before it. Ties place the new node after equal
    ///      NICRs (toward tail), a stable insertion-order tie-break.
    function _descendFromHead(Data storage d, uint256 nicr) private view returns (address, address) {
        if (isEmpty(d)) return (address(0), address(0));
        address cur = d.head;
        uint256 steps;
        while (cur != address(0) && d.nodes[cur].nicr >= nicr) {
            cur = d.nodes[cur].next;
            unchecked {
                if (++steps > MAX_SEARCH_STEPS) revert BadHint();
            }
        }
        address next = cur;
        address prev = (cur == address(0)) ? d.tail : d.nodes[cur].prev;
        return (prev, next);
    }
}
