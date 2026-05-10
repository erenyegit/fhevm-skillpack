// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

interface IConfidentialToken {
    function confidentialTransferFrom(
        address from,
        address to,
        externalEuint64 enc,
        bytes calldata proof
    ) external returns (euint64 transferred);

    function confidentialTransfer(
        address to,
        externalEuint64 enc,
        bytes calldata proof
    ) external returns (euint64 transferred);
}

/// @title ConfidentialGroupBuy — Kickstarter-style group buy with encrypted pledges.
/// @notice Backers pledge encrypted amounts in a confidential token. Per-backer
///         pledges remain private forever; only the total is revealed (and only
///         when the deadline passes and a finalisation is requested).
/// @dev Demonstrates: AP-018 (effective transferred amount), AP-010 (delete-before-effects),
///      AP-019 (finality delay), per-backer ACL granting, async-decryption pattern.
contract ConfidentialGroupBuy is ZamaEthereumConfig {
    IConfidentialToken public immutable token;
    address public immutable creator;
    uint64 public immutable goalAmount;
    uint256 public immutable deadline;

    euint64 private _totalRaised;
    mapping(address => euint64) private _contributions;

    uint256 public finalizationRequestId;
    uint256 public scheduledRevealBlock;        // block at which reveal becomes legal (finality delay)
    uint256 public constant FINALITY_BLOCKS = 12;  // Sepolia post-merge finality buffer
    bool public finalized;
    bool public goalMet;
    uint64 public revealedTotal;

    event Pledged(address indexed backer, bytes32 transferredHandle);
    event FinalizationRequested(uint256 requestId, bytes32 totalHandle);
    event Finalized(bool goalMet, uint64 total);

    constructor(IConfidentialToken _token, uint64 _goal, uint256 _deadline) {
        require(_deadline > block.timestamp, "deadline in past");
        require(_goal > 0, "goal=0");
        token = _token;
        creator = msg.sender;
        goalAmount = _goal;
        deadline = _deadline;
    }

    /// @notice Pledge an encrypted amount towards the goal.
    /// @dev Uses the *effective* transferred amount (AP-018) — silent transfer
    ///      failures (insufficient balance) result in 0-pledge, not over-pledge.
    /// fhe-lint-disable-next-line AP-006,AP-021
    /// AP-006: encAmount/proof are delegated unchanged to token.confidentialTransferFrom which
    ///         does its own FHE.fromExternal validation. The encryption MUST be bound to
    ///         the token address on the frontend (`contractAddress: token.address`).
    /// AP-021: pulls funds from msg.sender via confidentialTransferFrom, which already enforces
    ///         caller ownership of the source balance — no separate caller-binding needed.
    function pledge(externalEuint64 encAmount, bytes calldata proof) external {
        require(block.timestamp < deadline, "deadline passed");
        require(!finalized, "finalized");

        euint64 transferred = token.confidentialTransferFrom(msg.sender, address(this), encAmount, proof);

        _contributions[msg.sender] = FHE.add(_contributions[msg.sender], transferred);
        _totalRaised = FHE.add(_totalRaised, transferred);

        FHE.allowThis(_contributions[msg.sender]);
        FHE.allow(_contributions[msg.sender], msg.sender);
        FHE.allowThis(_totalRaised);

        emit Pledged(msg.sender, euint64.unwrap(transferred));
    }

    /// @notice After the deadline, mark `_totalRaised` publicly decryptable so
    ///         the relayer can fetch and report the cleartext via callback.
    /// @dev Uses a monotonic-ish nonzero request id (AP-017 defense — never the
    ///      ciphertext handle bytes).
    /// @notice Schedule the reveal — fixes block.number; the actual disclosure
    ///         is gated by `FINALITY_BLOCKS` to defeat reorg-based outcome flips
    ///         (OpenZeppelin Fabry vulnerability #6, AP-019).
    function scheduleFinalization() external {
        require(block.timestamp >= deadline, "ongoing");
        require(scheduledRevealBlock == 0, "scheduled");
        scheduledRevealBlock = block.number;
    }

    /// @notice After the finality delay, mark the encrypted total publicly
    ///         decryptable so the relayer can fetch and report cleartext.
    /// @dev    Uses a monotonic-ish nonzero request id (AP-017 defense).
    function requestFinalization() external {
        require(scheduledRevealBlock != 0, "not scheduled");
        require(block.number >= scheduledRevealBlock + FINALITY_BLOCKS, "wait for finality");
        require(finalizationRequestId == 0, "requested");
        uint256 id = uint256(keccak256(abi.encode(block.number, address(this)))) | 1;
        finalizationRequestId = id;
        FHE.makePubliclyDecryptable(_totalRaised);
        emit FinalizationRequested(id, euint64.unwrap(_totalRaised));
    }

    /// @notice Relayer calls back with the decrypted total + KMS signatures.
    /// @dev (1) match request id, (2) flip `finalized = true` BEFORE any external
    ///      effect (AP-010), (3) verify signatures, (4) record outcome.
    function finalizeCallback(uint256 requestId, uint64 totalCleartext, bytes[] calldata sigs) external {
        require(requestId != 0 && requestId == finalizationRequestId, "bad id");
        require(!finalized, "done");
        finalized = true;                     // (1) replay defense BEFORE effects
        finalizationRequestId = 0;

        FHE.checkSignatures(totalCleartext, sigs); // (2) KMS quorum verification

        revealedTotal = totalCleartext;
        goalMet = totalCleartext >= goalAmount;

        if (goalMet) {
            // creator can decrypt the total off-chain via user-decrypt
            FHE.allow(_totalRaised, creator);
        }

        emit Finalized(goalMet, totalCleartext);
    }

    /// @notice After successful finalisation, creator pulls the cleartext total
    ///         in the underlying confidential token to their wallet.
    function withdrawToCreator(externalEuint64 encAmount, bytes calldata proof) external {
        require(msg.sender == creator, "only creator");
        require(finalized && goalMet, "not funded");
        token.confidentialTransfer(creator, encAmount, proof);
    }

    /// fhe-lint-disable-next-line AP-011
    /// AP-011 OK: pledge() granted FHE.allow(_contributions[msg.sender], msg.sender) per write.
    function getMyContribution() external view returns (euint64) {
        return _contributions[msg.sender];
    }

    /// fhe-lint-disable-next-line AP-011
    /// AP-011 OK: pre-finalisation the handle is opaque (no allow); post-finalisation FHE.allow
    /// to creator was granted in finalizeCallback. View access is only useful in those windows.
    function getEncryptedTotal() external view returns (euint64) {
        return _totalRaised;
    }
}
