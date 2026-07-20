// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {TestFtsoV2Interface} from "@flarenetwork/flare-periphery-contracts/coston2/TestFtsoV2Interface.sol";
import {FtsoV2Interface} from "@flarenetwork/flare-periphery-contracts/coston2/FtsoV2Interface.sol";
import {IAssetManager} from "@flarenetwork/flare-periphery-contracts/coston2/IAssetManager.sol";

/// @dev Gate-0 build verification: proves the Flare Coston2 periphery, OZ upgradeable,
/// and forge-std all compile together under solc 0.8.28 / evm_version=cancun / via_ir.
/// No network access; purely a compile + type-resolution check.
contract Gate0BuildTest is Test {
    // XRP/USD block-latency feed id (category 0x01 crypto + "XRP/USD" utf8, right-padded to 21 bytes).
    bytes21 internal constant XRP_USD_FEED_ID =
        bytes21(0x015852502f55534400000000000000000000000000);

    function test_peripheryTypesResolve() public pure {
        // Type-level references only; no on-chain calls.
        bytes4 sel = TestFtsoV2Interface.getFeedById.selector;
        bytes4 selPayable = FtsoV2Interface.getFeedById.selector;
        bytes4 fAssetSel = IAssetManager.fAsset.selector;
        assertEq(sel, selPayable, "getFeedById selector should match across interfaces");
        assertTrue(fAssetSel != bytes4(0), "fAsset selector present");
    }

    function test_registryAddressConstant() public pure {
        assertEq(
            ContractRegistry.FLARE_CONTRACT_REGISTRY_ADDRESS,
            0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019
        );
    }

    function test_feedIdEncoding() public pure {
        // "XRP/USD" == 0x58 52 50 2f 55 53 44
        assertEq(XRP_USD_FEED_ID[0], bytes1(0x01), "category byte");
        assertEq(XRP_USD_FEED_ID[1], bytes1(0x58), "X");
        assertEq(XRP_USD_FEED_ID[7], bytes1(0x44), "D");
    }
}
