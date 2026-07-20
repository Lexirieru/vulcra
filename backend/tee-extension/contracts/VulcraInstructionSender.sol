// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @title Minimal interface of Flare's TeeExtensionRegistry (from
/// flare-smart-contracts-v2). This is the ONLY path to submit instructions to a
/// registered extension; the registry rejects any sendInstructions call whose
/// msg.sender is not the InstructionSender bound to the extension at registration.
interface ITeeExtensionRegistry {
    struct TeeInstructionParams {
        bytes32 opType;
        bytes32 opCommand;
        bytes message;
        address[] cosigners;
        uint64 cosignersThreshold;
        address claimBackAddress;
    }

    function sendInstructions(address[] calldata teeIds, TeeInstructionParams calldata params)
        external
        payable
        returns (bytes32 instructionId);
}

/// @title Minimal interface of Flare's TeeMachineRegistry. getRandomTeeIds picks
/// the TEE machine addresses serving an extension (count > 1 fans out).
interface ITeeMachineRegistry {
    function getRandomTeeIds(uint256 extensionId, uint256 count)
        external
        view
        returns (address[] memory);
}

/// @title VulcraInstructionSender
/// @notice The on-chain entry point for the Vulcra confidential extension. It
/// forwards Keeper and Vault-Guardian instructions to the TeeExtensionRegistry.
/// This contract's deployed address is what you register the extension with, so
/// it is the only address allowed to submit instructions for it.
///
/// @dev OPType/OPCommand bytes32 constants MUST match internal/config/config.go
/// and the Go router (teeutils.ToHash) exactly. bytes32("...") holds <= 31 bytes,
/// so all identifiers are kept short.
contract VulcraInstructionSender {
    // ---- OP identifiers (three-layer contract) ----------------------------
    bytes32 public constant OP_TYPE_KEEPER = bytes32("KEEPER");
    bytes32 public constant OP_COMMAND_SCAN = bytes32("SCAN");

    bytes32 public constant OP_TYPE_GUARDIAN = bytes32("GUARDIAN");
    bytes32 public constant OP_COMMAND_REGISTER = bytes32("REGISTER");
    bytes32 public constant OP_COMMAND_EVALUATE = bytes32("EVALUATE");

    // ---- wiring -----------------------------------------------------------
    ITeeExtensionRegistry public immutable registry;
    ITeeMachineRegistry public immutable machines;

    address public owner;
    uint256 public extensionId; // set once, after registration
    bool public extensionIdSet;

    /// @notice How many TEE machines to fan a single instruction out to.
    uint256 public teeCount = 1;

    event InstructionSent(bytes32 indexed opType, bytes32 indexed opCommand, bytes32 instructionId);
    event ExtensionIdSet(uint256 extensionId);

    error NotOwner();
    error ExtensionIdAlreadySet();
    error NoTeeMachines();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(ITeeExtensionRegistry _registry, ITeeMachineRegistry _machines) {
        registry = _registry;
        machines = _machines;
        owner = msg.sender;
    }

    /// @notice Cache this extension's id (set once), matching the scaffold's
    /// setExtensionId() pattern used to look up serving TEE machines.
    function setExtensionId(uint256 _extensionId) external onlyOwner {
        if (extensionIdSet) revert ExtensionIdAlreadySet();
        extensionId = _extensionId;
        extensionIdSet = true;
        emit ExtensionIdSet(_extensionId);
    }

    /// @notice Optional: fan an instruction out to more than one TEE.
    function setTeeCount(uint256 _count) external onlyOwner {
        require(_count >= 1, "teeCount >= 1");
        teeCount = _count;
    }

    // ---- one send function per action -------------------------------------

    /// @notice KEEPER/SCAN — trigger a liquidation scan. `message` is the
    /// (JSON) KeeperScanRequest payload; candidate owners may be empty (the
    /// enclave re-reads authoritative state regardless).
    function sendKeeperScan(bytes calldata message)
        external
        payable
        returns (bytes32 instructionId)
    {
        return _send(OP_TYPE_KEEPER, OP_COMMAND_SCAN, message);
    }

    /// @notice GUARDIAN/REGISTER — register a PRIVATE protection rule. The
    /// `ciphertext` is the ECIES-encrypted (address owner, uint256 triggerCRBps,
    /// uint256 maxRepay18) tuple, encrypted to the extension public key. Nothing
    /// about the rule is on-chain; only the returned termsCommitment
    /// (keccak256(abi.encode(owner, triggerCRBps, maxRepay18))) becomes public.
    function sendGuardianRegister(bytes calldata ciphertext)
        external
        payable
        returns (bytes32 instructionId)
    {
        return _send(OP_TYPE_GUARDIAN, OP_COMMAND_REGISTER, ciphertext);
    }

    /// @notice GUARDIAN/EVALUATE — evaluate a vault against its stored private
    /// rule; if inside the protection window the enclave calls
    /// VaultManager.delegatedRepay(owner, amount) via the TEE keeper wallet
    /// (GUARDIAN_EXECUTOR_ROLE). `message` is the (JSON) GuardianEvaluateRequest
    /// carrying the termsCommitment.
    function sendGuardianEvaluate(bytes calldata message)
        external
        payable
        returns (bytes32 instructionId)
    {
        return _send(OP_TYPE_GUARDIAN, OP_COMMAND_EVALUATE, message);
    }

    // ---- internal ---------------------------------------------------------

    /// @dev Resolve serving TEE machines, build params, forward msg.value. The
    /// registry charges a per-instruction fee, so this contract is payable and
    /// forwards the entire msg.value.
    function _send(bytes32 opType, bytes32 opCommand, bytes calldata message)
        internal
        returns (bytes32 instructionId)
    {
        address[] memory teeIds = machines.getRandomTeeIds(extensionId, teeCount);
        if (teeIds.length == 0) revert NoTeeMachines();

        address[] memory cosigners = new address[](0);
        ITeeExtensionRegistry.TeeInstructionParams memory params = ITeeExtensionRegistry
            .TeeInstructionParams({
            opType: opType,
            opCommand: opCommand,
            message: message,
            cosigners: cosigners,
            cosignersThreshold: 0,
            claimBackAddress: msg.sender
        });

        instructionId = registry.sendInstructions{value: msg.value}(teeIds, params);
        emit InstructionSent(opType, opCommand, instructionId);
    }
}
