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
    /// @param annualInterestRateBps Interest rate for the new vault. For the smoothest XRPL 1-payment
    ///        UX, pass the VaultManager's `defaultInterestRateBps()`; a custom rate is also accepted.
    function openVaultAndForward(
        uint256 collateral6,
        uint256 mint18,
        uint256 annualInterestRateBps,
        address vusdDestination,
        address prevHint,
        address nextHint
    ) external;

    /// @notice Like {openVaultAndForward} but reads the caller's live FXRP balance at execution time
    ///         instead of taking a collateral amount, so no off-chain prediction can strand the mint.
    /// @dev The 0xFE memo commits keccak256(userOp) BEFORE the mint, so a baked-in collateral figure
    ///      is only a guess of (minted after feeBIPS, AMG-rounded, minus executorFeeUBA). Pair with
    ///      `Call[0] = FXRP.approve(zap, type(uint256).max)` (or a generous upper bound). The Zap
    ///      sweeps the caller's whole FXRP balance into the new vault.
    function openVaultAndForwardAll(
        uint256 mint18,
        uint256 annualInterestRateBps,
        address vusdDestination,
        address prevHint,
        address nextHint
    ) external;

    /// @notice Supply side of {openVaultAndForwardAll}: sweep the caller's live FXRP balance into their
    ///         existing vault, so the XRPL-native add-collateral path needs no predicted amount either.
    ///         Pair with `Call[0] = FXRP.approve(zap, type(uint256).max)`.
    function addCollateralAll(address prevHint, address nextHint) external;

    /// @notice Preview the resulting debt / CR / gating for a prospective atomic mint (R12).
    function previewOpen(uint256 collateral6, uint256 mint18)
        external
        view
        returns (uint256 debt18, uint256 crBps, bool meetsMcr, bool meetsMinDebt);
}
