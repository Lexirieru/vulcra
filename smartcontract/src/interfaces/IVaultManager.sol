// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IVaultManager
/// @notice External surface of the Vulcra CDP core that other contracts (VulcraZap) depend on.
interface IVaultManager {
    /// @notice Protocol parameters (R7). All ratios/fees in basis points; minDebt in 18-dec vUSD.
    struct Params {
        uint256 mcrBps; // minimum collateral ratio (e.g. 13000 = 130%)
        uint256 minDebt18; // minimum vault debt (e.g. 100e18)
        uint256 mintFeeBps; // one-time minting fee (e.g. 50 = 0.5%)
        uint256 liqBonusBps; // liquidation bonus (e.g. 1000 = 10%)
        uint256 redemptionFeeBps; // redemption fee (e.g. 0 = face value)
    }

    /// @notice Interest configuration (V2). Rates in bps/year; borrower picks a rate in [min,max].
    struct InterestConfig {
        uint256 minInterestRateBps; // e.g. 50 = 0.5%/yr
        uint256 maxInterestRateBps; // e.g. 25000 = 250%/yr
        uint256 defaultInterestRateBps; // used for XRPL-native (Zap) opens
        address interestReceiver; // recipient of minted accrued interest (yield)
    }

    /// @notice Open a vault on behalf of `owner`, pulling collateral from the caller (V2: with rate).
    /// @dev Used by VulcraZap in the XRPL atomic-mint flow: the vault is owned by `owner`
    ///      (the PersonalAccount) while collateral is pulled from the caller (the Zap), and vUSD
    ///      is delivered to `debtRecipient`. `annualInterestRateBps` must be within [min,max].
    function openVaultFor(
        address owner,
        uint256 collateral6,
        uint256 mint18,
        uint256 annualInterestRateBps,
        address debtRecipient,
        address prevHint,
        address nextHint
    ) external;

    /// @notice Preview the debt, collateral ratio, and gating checks for a prospective open.
    function previewOpen(uint256 collateral6, uint256 mint18)
        external
        view
        returns (uint256 debt18, uint256 crBps, bool meetsMcr, bool meetsMinDebt);

    /// @notice Current vault state for `owner`. `debt18` is the ENTIRE current debt including
    ///         accrued interest (V2).
    function getVault(address owner) external view returns (uint256 collateral6, uint256 debt18, bool active);

    /// @notice Default annual interest rate (bps) used by the XRPL-native (Zap) open path.
    function defaultInterestRateBps() external view returns (uint256);

    /// @notice Decimals of this branch's collateral token (e.g. 6 for FXRP, 18 for wFLR).
    function collateralDecimals() external view returns (uint8);

    /// @notice Backward-compatible alias for the collateral token (deployed ABI).
    function fxrp() external view returns (address);

    /// @notice The vUSD debt token (shared across all branches).
    function vusd() external view returns (address);
}
