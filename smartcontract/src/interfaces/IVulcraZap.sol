// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IVulcraZap
/// @notice Single-target helper for the XRPL-native atomic mint (Smart Accounts 0xFE flow, R10).
interface IVulcraZap {
    /// @notice Pull FXRP from the caller, open a vault owned by the caller, and deliver vUSD.
    /// @dev Designed as the second call of a 2-call `executeUserOp` batch run by a PersonalAccount:
    ///      `Call[0] = FXRP.approve(zap, collateral6)`, `Call[1] = zap.openVaultAndForward(...)`.
    ///      The vault is owned by the caller (the PersonalAccount) so the XRPL user keeps control;
    ///      vUSD is sent to `vusdDestination`. Any revert bubbles up so the whole direct-mint tx
    ///      rolls back and no FXRP is minted (R10/AE4).
    function openVaultAndForward(
        uint256 collateral6,
        uint256 mint18,
        address vusdDestination,
        address prevHint,
        address nextHint
    ) external;

    /// @notice Preview the resulting debt / CR / gating for a prospective atomic mint (R12).
    function previewOpen(uint256 collateral6, uint256 mint18)
        external
        view
        returns (uint256 debt18, uint256 crBps, bool meetsMcr, bool meetsMinDebt);
}
