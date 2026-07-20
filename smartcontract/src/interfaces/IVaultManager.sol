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

    /// @notice Open a vault on behalf of `owner`, pulling collateral from the caller.
    /// @dev Used by VulcraZap in the XRPL atomic-mint flow: the vault is owned by `owner`
    ///      (the PersonalAccount) while collateral is pulled from the caller (the Zap), and vUSD
    ///      is delivered to `debtRecipient`.
    function openVaultFor(
        address owner,
        uint256 collateral6,
        uint256 mint18,
        address debtRecipient,
        address prevHint,
        address nextHint
    ) external;

    /// @notice Preview the debt, collateral ratio, and gating checks for a prospective open.
    function previewOpen(uint256 collateral6, uint256 mint18)
        external
        view
        returns (uint256 debt18, uint256 crBps, bool meetsMcr, bool meetsMinDebt);

    /// @notice Current vault state for `owner`.
    function getVault(address owner) external view returns (uint256 collateral6, uint256 debt18, bool active);

    /// @notice The FXRP collateral token (resolved from ContractRegistry at init).
    function fxrp() external view returns (address);

    /// @notice The vUSD debt token.
    function vusd() external view returns (address);
}
