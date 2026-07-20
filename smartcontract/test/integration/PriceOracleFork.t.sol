// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {PriceOracle} from "../../src/PriceOracle.sol";

/// @notice Live Coston2 fork test — NO MOCK. Deploys PriceOracle against the real
///         FlareContractRegistry / FtsoV2 and reads the live XRP/USD feed.
/// @dev Opt-in: set `COSTON2_RPC_URL` to run (skipped otherwise so the offline suite stays green).
///      Verified live at build time: registry 0xaD67…F6019 -> FtsoV2 0xC4e9…304d,
///      feed id 0x0158…0000 returns a plausible XRP price with dynamic decimals.
contract PriceOracleForkTest is Test {
    bytes21 internal constant XRP_USD_FEED_ID =
        bytes21(0x015852502f55534400000000000000000000000000);

    function test_liveFeed_returnsPlausiblePrice() public {
        string memory rpc = vm.envOr("COSTON2_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);

        PriceOracle impl = new PriceOracle();
        PriceOracle oracle = PriceOracle(
            address(
                new ERC1967Proxy(
                    address(impl),
                    abi.encodeCall(PriceOracle.initialize, (address(this), XRP_USD_FEED_ID, 86_400))
                )
            )
        );

        uint256 price18 = oracle.xrpUsdPrice18();
        // XRP has traded well within [$0.10, $100] on testnet; a sane liveness band.
        assertGt(price18, 0.1e18, "XRP price implausibly low");
        assertLt(price18, 100e18, "XRP price implausibly high");

        uint256 oneFxrp = oracle.collateralValueUsd18(1e6);
        assertEq(oneFxrp, price18, "1 FXRP should equal one XRP price");
    }
}
