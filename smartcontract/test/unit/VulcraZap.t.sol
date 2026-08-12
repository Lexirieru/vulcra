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
        zap.openVaultAndForward(100e6, 100e18, 500, dest, address(0), address(0));

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
        zap.openVaultAndForward(100e6, 100e18, 500, dest, address(0), address(0));

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
        zap.openVaultAndForward(100e6, 100e18, 500, dest, address(0), address(0));
    }

    function test_revert_belowMinDebt_bubbles() public {
        address pa = makeAddr("pa");
        fxrp.mint(pa, 100e6);
        vm.prank(pa);
        fxrp.approve(address(zap), 100e6);
        vm.prank(pa);
        vm.expectRevert(VaultManager.DebtBelowMin.selector);
        zap.openVaultAndForward(100e6, 90e18, 500, dest, address(0), address(0)); // debt 90.45 < 100
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
            data: abi.encodeCall(IVulcraZap.openVaultAndForward, (coll, mint, 500, vusdDest, address(0), address(0)))
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

    // --- openVaultAndForwardAll: read live balance, no baked collateral (Flare-admin guidance) ---

    function test_zap_openAll_sweepsLiveBalance() public {
        address pa = makeAddr("paAll");
        fxrp.mint(pa, 100e6); // the net FXRP the direct mint delivered
        vm.prank(pa);
        fxrp.approve(address(zap), type(uint256).max); // generous upper bound, not an exact amount
        vm.prank(pa);
        zap.openVaultAndForwardAll(100e18, 500, dest, address(0), address(0));

        (uint256 coll,, bool active) = mgr.getVault(pa);
        assertEq(coll, 100e6, "swept the whole live balance as collateral");
        assertTrue(active);
        assertEq(vusd.balanceOf(dest), 100e18);
        assertEq(fxrp.balanceOf(pa), 0, "no dust stranded on the PA");
        assertEq(fxrp.balanceOf(address(zap)), 0, "zap holdless");
    }

    function test_zap_openAll_sweepsUnroundedAmount() public {
        // Fee/AMG rounding can deliver an un-round amount no off-chain prediction would match; the
        // All variant simply sweeps whatever actually arrived, so nothing is stranded.
        address pa = makeAddr("paAll2");
        uint256 unround = 100_123_456; // ~100.12 FXRP, deliberately not a round figure
        fxrp.mint(pa, unround);
        vm.prank(pa);
        fxrp.approve(address(zap), type(uint256).max);
        vm.prank(pa);
        zap.openVaultAndForwardAll(100e18, 500, dest, address(0), address(0));

        (uint256 coll,, bool active) = mgr.getVault(pa);
        assertEq(coll, unround, "swept the exact live balance, whatever it rounded to");
        assertTrue(active);
        assertEq(fxrp.balanceOf(pa), 0);
    }

    function test_atomicMintAll_viaPersonalAccount() public {
        MockPersonalAccount pa = new MockPersonalAccount();
        fxrp.mint(address(pa), 100e6);

        MockPersonalAccount.Call[] memory calls = new MockPersonalAccount.Call[](2);
        calls[0] = MockPersonalAccount.Call({
            target: address(fxrp),
            value: 0,
            data: abi.encodeCall(IERC20.approve, (address(zap), type(uint256).max))
        });
        calls[1] = MockPersonalAccount.Call({
            target: address(zap),
            value: 0,
            data: abi.encodeCall(IVulcraZap.openVaultAndForwardAll, (100e18, 500, address(pa), address(0), address(0)))
        });
        pa.executeUserOp(calls);

        (uint256 coll,, bool active) = mgr.getVault(address(pa));
        assertEq(coll, 100e6);
        assertTrue(active);
        assertEq(vusd.balanceOf(address(pa)), 100e18);
        assertEq(fxrp.balanceOf(address(zap)), 0);
    }

    // --- addCollateralAll: supply side of the balance-read pattern ---

    function _openViaAll(address pa, uint256 coll) internal {
        fxrp.mint(pa, coll);
        vm.prank(pa);
        fxrp.approve(address(zap), type(uint256).max);
        vm.prank(pa);
        zap.openVaultAndForwardAll(100e18, 500, dest, address(0), address(0));
    }

    function test_zap_addCollateralAll_sweepsIntoExistingVault() public {
        address pa = makeAddr("paAdd");
        _openViaAll(pa, 100e6);
        (uint256 coll0,,) = mgr.getVault(pa);
        assertEq(coll0, 100e6);

        // fresh FXRP delivered to the PA (a later mint); sweep it into the existing vault
        fxrp.mint(pa, 40e6);
        vm.prank(pa);
        zap.addCollateralAll(address(0), address(0)); // approval is already MAX

        (uint256 coll1,, bool active) = mgr.getVault(pa);
        assertEq(coll1, 140e6, "swept the live balance into the existing vault");
        assertTrue(active);
        assertEq(fxrp.balanceOf(pa), 0, "no dust stranded");
        assertEq(fxrp.balanceOf(address(zap)), 0, "zap holdless");
    }

    function test_zap_addCollateralAll_revertsWithoutVault() public {
        address pa = makeAddr("paNoVault");
        fxrp.mint(pa, 10e6);
        vm.prank(pa);
        fxrp.approve(address(zap), type(uint256).max);
        vm.prank(pa);
        vm.expectRevert(VaultManager.NoVault.selector);
        zap.addCollateralAll(address(0), address(0));
    }

    function test_addCollateralFor_onlyZapRole() public {
        address pa = makeAddr("paRole");
        _openViaAll(pa, 100e6);
        // a caller without ZAP_ROLE cannot add collateral on someone's behalf
        vm.prank(makeAddr("attacker"));
        vm.expectRevert(); // AccessControlUnauthorizedAccount
        mgr.addCollateralFor(pa, 1e6, address(0), address(0));
    }
}
