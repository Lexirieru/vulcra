// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultTestSetup} from "../helpers/VaultTestSetup.sol";
import {VulcraZap} from "../../src/VulcraZap.sol";
import {IVulcraZap} from "../../src/interfaces/IVulcraZap.sol";
import {VaultManager} from "../../src/VaultManager.sol";
import {MockPersonalAccount} from "../helpers/MockPersonalAccount.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract VulcraZapTest is VaultTestSetup {
    VulcraZap internal zap;
    address internal dest = makeAddr("dest");

    function setUp() public {
        _deployStack();
        zap = VulcraZap(
            _deployProxy(address(new VulcraZap()), abi.encodeCall(VulcraZap.initialize, (admin, address(mgr))))
        );
        bytes32 zapRole = mgr.ZAP_ROLE();
        vm.prank(admin);
        mgr.grantRole(zapRole, address(zap));
    }

    function test_zap_direct_ownershipAndForward() public {
        address pa = makeAddr("pa");
        fxrp.mint(pa, 100e6);
        vm.prank(pa);
        fxrp.approve(address(zap), 100e6);

        vm.prank(pa);
        zap.openVaultAndForward(100e6, 100e18, dest, address(0), address(0));

        (uint256 coll,, bool active) = mgr.getVault(pa);
        assertEq(coll, 100e6);
        assertTrue(active); // vault owned by the caller (PersonalAccount)
        assertEq(vusd.balanceOf(dest), 100e18); // vUSD forwarded to destination
        assertEq(vusd.totalSupply(), mgr.totalDebt());
    }

    function test_zap_holdless() public {
        address pa = makeAddr("pa");
        fxrp.mint(pa, 100e6);
        vm.prank(pa);
        fxrp.approve(address(zap), 100e6);
        vm.prank(pa);
        zap.openVaultAndForward(100e6, 100e18, dest, address(0), address(0));

        assertEq(fxrp.balanceOf(address(zap)), 0, "zap holds no FXRP");
        assertEq(vusd.balanceOf(address(zap)), 0, "zap holds no vUSD");
    }

    function test_previewOpen_matchesManager() public view {
        (uint256 d, uint256 cr, bool mcr, bool minD) = zap.previewOpen(100e6, 100e18);
        (uint256 d2, uint256 cr2, bool mcr2, bool minD2) = mgr.previewOpen(100e6, 100e18);
        assertEq(d, d2);
        assertEq(cr, cr2);
        assertEq(mcr, mcr2);
        assertEq(minD, minD2);
    }

    function test_revert_noApproval() public {
        address pa = makeAddr("pa");
        fxrp.mint(pa, 100e6);
        // no approval to the zap
        vm.prank(pa);
        vm.expectRevert();
        zap.openVaultAndForward(100e6, 100e18, dest, address(0), address(0));
    }

    function test_revert_belowMinDebt_bubbles() public {
        address pa = makeAddr("pa");
        fxrp.mint(pa, 100e6);
        vm.prank(pa);
        fxrp.approve(address(zap), 100e6);
        vm.prank(pa);
        vm.expectRevert(VaultManager.DebtBelowMin.selector);
        zap.openVaultAndForward(100e6, 90e18, dest, address(0), address(0)); // debt 90.45 < 100
    }

    // --- integration: full atomic-mint batch via a PersonalAccount (R10/AE4) ---

    function _batch(uint256 coll, uint256 mint, address vusdDest)
        internal
        view
        returns (MockPersonalAccount.Call[] memory calls)
    {
        calls = new MockPersonalAccount.Call[](2);
        calls[0] = MockPersonalAccount.Call({
            target: address(fxrp), value: 0, data: abi.encodeCall(IERC20.approve, (address(zap), coll))
        });
        calls[1] = MockPersonalAccount.Call({
            target: address(zap),
            value: 0,
            data: abi.encodeCall(IVulcraZap.openVaultAndForward, (coll, mint, vusdDest, address(0), address(0)))
        });
    }

    function test_atomicMint_viaPersonalAccount() public {
        MockPersonalAccount pa = new MockPersonalAccount();
        fxrp.mint(address(pa), 100e6); // simulate FXRP direct-minted to the personal account

        pa.executeUserOp(_batch(100e6, 100e18, address(pa)));

        (uint256 coll,, bool active) = mgr.getVault(address(pa));
        assertEq(coll, 100e6);
        assertTrue(active); // vault owned by the PersonalAccount
        assertEq(vusd.balanceOf(address(pa)), 100e18);
        assertEq(fxrp.balanceOf(address(zap)), 0);
    }

    function test_AE4_revertRollsBackWholeBatch() public {
        MockPersonalAccount pa = new MockPersonalAccount();
        fxrp.mint(address(pa), 100e6);

        // mint below minimum -> openVaultFor reverts -> whole executeUserOp reverts
        vm.expectRevert(VaultManager.DebtBelowMin.selector);
        pa.executeUserOp(_batch(100e6, 90e18, address(pa)));

        (,, bool active) = mgr.getVault(address(pa));
        assertFalse(active); // no vault created
        assertEq(fxrp.balanceOf(address(pa)), 100e6); // FXRP untouched (recoverable at Core Vault)
        assertEq(vusd.totalSupply(), 0);
    }
}
