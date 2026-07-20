// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {TestFtsoV2Interface} from "@flarenetwork/flare-periphery-contracts/coston2/TestFtsoV2Interface.sol";

/// @title VulcraTestBase
/// @notice Shared test scaffolding: proxy deployment and Flare FTSO feed injection.
/// @dev The feed is injected with `vm.mockCall` on the REAL `ContractRegistry` code path — the
///      contract under test still resolves FtsoV2 exactly as it will in production (via the
///      registry at 0xaD67…F6019), with no test-only branches in the contract. Deterministic
///      unit/fuzz tests set arbitrary (value, decimals, timestamp); a separate fork test exercises
///      the live feed. This is a Foundry cheatcode simulating an external system, not a mock baked
///      into the deployed contract.
abstract contract VulcraTestBase is Test {
    address internal constant FLARE_REGISTRY = 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019;
    address internal constant MOCK_FTSO = address(uint160(uint256(keccak256("vulcra.mock.ftso"))));
    address internal constant MOCK_ASSET_MANAGER = address(uint160(uint256(keccak256("vulcra.mock.assetmanager"))));

    /// @dev XRP/USD feed id (category 0x01 + "XRP/USD" utf8, right-padded to 21 bytes).
    bytes21 internal constant XRP_USD_FEED_ID = bytes21(0x015852502f55534400000000000000000000000000);

    /// @notice Inject an FTSO feed reading for the XRP/USD feed id, resolved through the real registry.
    function _setFeed(uint256 value, int8 decimals, uint64 timestamp) internal {
        if (FLARE_REGISTRY.code.length == 0) vm.etch(FLARE_REGISTRY, hex"fe");
        if (MOCK_FTSO.code.length == 0) vm.etch(MOCK_FTSO, hex"fe");
        vm.mockCall(
            FLARE_REGISTRY,
            abi.encodeWithSignature("getContractAddressByHash(bytes32)", keccak256(abi.encode("FtsoV2"))),
            abi.encode(MOCK_FTSO)
        );
        vm.mockCall(
            MOCK_FTSO,
            abi.encodeWithSelector(TestFtsoV2Interface.getFeedById.selector, XRP_USD_FEED_ID),
            abi.encode(value, decimals, timestamp)
        );
    }

    /// @notice Convenience: set an XRP/USD price expressed with `decimals` places, fresh timestamp.
    function _setXrpPrice(uint256 value, int8 decimals) internal {
        _setFeed(value, decimals, uint64(block.timestamp));
    }

    /// @notice Inject the FXRP token resolution: registry -> AssetManagerFXRP -> fAsset(), through
    ///         the real ContractRegistry code path (no production test hooks).
    function _setFxrp(address fxrpToken) internal {
        if (FLARE_REGISTRY.code.length == 0) vm.etch(FLARE_REGISTRY, hex"fe");
        if (MOCK_ASSET_MANAGER.code.length == 0) vm.etch(MOCK_ASSET_MANAGER, hex"fe");
        vm.mockCall(
            FLARE_REGISTRY,
            abi.encodeWithSignature("getContractAddressByHash(bytes32)", keccak256(abi.encode("AssetManagerFXRP"))),
            abi.encode(MOCK_ASSET_MANAGER)
        );
        vm.mockCall(MOCK_ASSET_MANAGER, abi.encodeWithSignature("fAsset()"), abi.encode(fxrpToken));
    }

    /// @notice Deploy an implementation behind an ERC1967 proxy with the given init calldata.
    function _deployProxy(address implementation, bytes memory initData) internal returns (address) {
        return address(new ERC1967Proxy(implementation, initData));
    }
}
