pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";


contract PsiFheTool is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    struct Batch {
        uint256 id;
        bool isOpen;
        uint256 elementCount;
        mapping(uint256 => euint32) encryptedElements; // Stores encrypted elements for this batch
    }

    uint256 public currentBatchId;
    mapping(uint256 => Batch) public batches;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    // Custom Errors
    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchClosed();
    error InvalidBatch();
    error InvalidState();
    error ReplayDetected();
    error InvalidProof();
    error NotInitialized();

    // Events
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event ContractPaused(address indexed account);
    event ContractUnpaused(address indexed account);
    event CooldownSecondsSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event ElementSubmitted(address indexed provider, uint256 indexed batchId, uint256 elementIndex);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId, bytes32 stateHash);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 intersectionSize);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier checkSubmissionCooldown() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier checkDecryptionCooldown() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        emit ProviderAdded(owner);
        cooldownSeconds = 60; // Default cooldown
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit ContractPaused(msg.sender);
    }

    function unpause() external onlyOwner {
        if (!paused) revert Paused(); // Cannot unpause if not paused
        paused = false;
        emit ContractUnpaused(msg.sender);
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        uint256 oldCooldownSeconds = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSecondsSet(oldCooldownSeconds, newCooldownSeconds);
    }

    function openBatch() external onlyOwner whenNotPaused {
        currentBatchId++;
        Batch storage newBatch = batches[currentBatchId];
        newBatch.id = currentBatchId;
        newBatch.isOpen = true;
        newBatch.elementCount = 0;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch(uint256 batchId) external onlyOwner {
        Batch storage batch = batches[batchId];
        if (batch.id == 0) revert InvalidBatch();
        if (!batch.isOpen) revert BatchClosed();
        batch.isOpen = false;
        emit BatchClosed(batchId);
    }

    function submitElement(uint256 batchId, euint32 encryptedElement) external onlyProvider whenNotPaused checkSubmissionCooldown {
        Batch storage batch = batches[batchId];
        if (batch.id == 0) revert InvalidBatch();
        if (!batch.isOpen) revert BatchClosed();

        _initIfNeeded();

        batch.encryptedElements[batch.elementCount] = encryptedElement;
        batch.elementCount++;
        lastSubmissionTime[msg.sender] = block.timestamp;
        emit ElementSubmitted(msg.sender, batchId, batch.elementCount - 1);
    }

    function requestIntersection(uint256 batchId) external onlyProvider whenNotPaused checkDecryptionCooldown {
        Batch storage batch = batches[batchId];
        if (batch.id == 0) revert InvalidBatch();
        if (batch.elementCount < 2) revert NotEnoughElements(); // Need at least 2 elements for PSI

        _initIfNeeded();

        // 1. Prepare Ciphertexts
        // For PSI, we need to compare all pairs. The final result to decrypt is the count of matches.
        // This example will compute the intersection size.
        // For a real PSI, this logic would be more complex, involving comparisons of all pairs.
        // Here, we'll just sum all elements and decrypt the sum as a placeholder for the intersection size.
        // This is a simplified example. A true PSI would require more complex FHE logic.
        euint32 memory accumulatedIntersectionSize = FHE.asEuint32(0); // Placeholder for actual PSI logic

        // Simplified PSI logic: count elements that are non-zero (assuming 0 is not a valid data element)
        // This is a placeholder. Real PSI involves comparing elements from different providers.
        for (uint256 i = 0; i < batch.elementCount; i++) {
            euint32 memory element = batch.encryptedElements[i];
            ebool memory isNonZero = element.ne(FHE.asEuint32(0));
            accumulatedIntersectionSize = accumulatedIntersectionSize.add(element.mul(isNonZero.toEuint32())); // Sum non-zero elements
        }
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = accumulatedIntersectionSize.toBytes32();

        // 2. Compute State Hash
        bytes32 stateHash = _hashCiphertexts(cts);

        // 3. Request Decryption
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        // 4. Store Context
        decryptionContexts[requestId] = DecryptionContext({ batchId: batchId, stateHash: stateHash, processed: false });
        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        emit DecryptionRequested(requestId, batchId, stateHash);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        DecryptionContext storage context = decryptionContexts[requestId];

        // a. Replay Guard
        if (context.processed) revert ReplayDetected();

        // b. State Verification
        // Rebuild cts array in the exact same order as in requestIntersection
        Batch storage batch = batches[context.batchId];
        euint32 memory accumulatedIntersectionSize; // Placeholder for actual PSI logic

        // Reconstruct the encrypted state that was hashed
        for (uint256 i = 0; i < batch.elementCount; i++) {
            euint32 memory element = batch.encryptedElements[i];
            ebool memory isNonZero = element.ne(FHE.asEuint32(0));
            accumulatedIntersectionSize = accumulatedIntersectionSize.add(element.mul(isNonZero.toEuint32()));
        }
        bytes32[] memory currentCts = new bytes32[](1);
        currentCts[0] = accumulatedIntersectionSize.toBytes32();
        bytes32 currentHash = _hashCiphertexts(currentCts);

        if (currentHash != context.stateHash) revert InvalidState();
        // Security Comment: State hash verification ensures that the contract's state (specifically, the ciphertexts
        // that were supposed to be decrypted) has not changed between the decryption request and the callback.
        // This prevents scenarios where an attacker might alter the data after a request is made but before it's processed.

        // c. Proof Verification
        if (!FHE.checkSignatures(requestId, cleartexts, proof)) revert InvalidProof();

        // d. Decode & Finalize
        // Decode cleartexts in the same order as cts
        // cleartexts is abi.encodePacked(cleartext1, cleartext2, ...)
        // Here, we only have one uint32
        uint256 intersectionSize = abi.decode(cleartexts, (uint32));

        context.processed = true;
        emit DecryptionCompleted(requestId, context.batchId, intersectionSize);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded() internal {
        if (!FHE.isInitialized()) {
            FHE.initialize();
        }
    }

    error NotEnoughElements();
}