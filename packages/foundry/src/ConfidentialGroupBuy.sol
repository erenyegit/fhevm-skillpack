// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @notice Slim confidential-token interface this demo uses. Differs from
///         ERC-7984 in one important way: transfers take an already-validated
///         `euint64` handle rather than `(externalEuint64, bytes proof)` —
///         this avoids cross-contract proof-binding ambiguity. The pledger's
///         FHE.fromExternal validation happens in this contract.
interface IConfidentialToken {
    function transferFromValidated(address from, address to, euint64 amount) external returns (euint64 transferred);

    function transferValidated(address to, euint64 amount) external returns (euint64 transferred);
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
    uint256 public scheduledRevealBlock; // block at which reveal becomes legal (finality delay)
    uint256 public constant FINALITY_BLOCKS = 12; // Sepolia post-merge finality buffer
    bool public finalized;
    bool public goalMet;
    uint64 public revealedTotal;

    event Pledged(address indexed backer, bytes32 transferredHandle);
    event FinalizationRequested(uint256 requestId, bytes32 totalHandle);
    event Finalized(bool goalMet, uint64 total);

    /// @notice Returns the handle the relayer must decrypt, so off-chain
    ///         services can find what to sign without parsing storage.
    function getTotalHandle() external view returns (bytes32) {
        return euint64.unwrap(_totalRaised);
    }

    constructor(IConfidentialToken _token, uint64 _goal, uint256 _deadline) {
        require(_deadline > block.timestamp, "deadline in past");
        require(_goal > 0, "goal=0");
        token = _token;
        creator = msg.sender;
        goalAmount = _goal;
        deadline = _deadline;
        // AP-023 defense: seed _totalRaised with a real ciphertext handle so
        // requestFinalization never sends the zero-handle sentinel to the KMS
        // (which would silently ignore it and lock the contract forever).
        _totalRaised = FHE.asEuint64(0);
        FHE.allowThis(_totalRaised);
    }

    /// @notice Pledge an encrypted amount towards the goal.
    /// @dev Uses the *effective* transferred amount (AP-018) — silent transfer
    ///      failures (insufficient balance) result in 0-pledge, not over-pledge.
    /// fhe-lint-disable-next-line AP-021
    /// AP-021 OK: the encrypted input is bound to (this contract, msg.sender) by
    /// FHE.fromExternal; transferFromValidated then pulls from msg.sender's balance
    /// at the token. A 3rd-party caller cannot replay because the proof binding
    /// would mismatch the new caller, and the token's transfer would attribute the
    /// debit to the new msg.sender (the attacker), not the original encrypter.
    function pledge(externalEuint64 encAmount, bytes calldata proof) external {
        // AP-024 defense: once a reveal is scheduled, mutating _totalRaised
        // would change its ciphertext id and silently desync the relayer's
        // pending decryption. Lock pledges from `scheduleFinalization` onward.
        // (Checked first because schedule implies deadline-passed; this gives
        //  callers a more specific error than the generic deadline check.)
        require(scheduledRevealBlock == 0, "FinalizationScheduled");
        require(!finalized, "finalized");
        require(block.timestamp < deadline, "deadline passed");

        // Validate the encrypted input ourselves. Encryption MUST target this
        // contract's address on the frontend.
        euint64 amount = FHE.fromExternal(encAmount, proof);
        // Hand the validated handle to the token via transient ACL.
        FHE.allowTransient(amount, address(token));
        euint64 transferred = token.transferFromValidated(msg.sender, address(this), amount);

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

    /// @notice Relayer calls back with the decrypted total + KMS proof.
    /// @dev (1) match request id, (2) flip `finalized = true` BEFORE any external
    ///      effect (AP-010 — replay defense), (3) verify the KMS-signed proof
    ///      via `FHE.checkSignatures(handles, abi.encode(cleartexts), proof)`,
    ///      (4) record outcome.
    function finalizeCallback(uint256 requestId, uint256[] calldata cleartexts, bytes calldata decryptionProof)
        external
    {
        require(requestId != 0 && requestId == finalizationRequestId, "bad id");
        require(!finalized, "done");
        require(cleartexts.length == 1, "bad payload");
        finalized = true; // (1) replay defense BEFORE verify
        finalizationRequestId = 0;

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = euint64.unwrap(_totalRaised);
        FHE.checkSignatures(handles, abi.encode(cleartexts), decryptionProof); // (2) KMS quorum

        uint64 totalCleartext = uint64(cleartexts[0]);
        revealedTotal = totalCleartext;
        goalMet = totalCleartext >= goalAmount;

        if (goalMet) {
            // creator can decrypt the total off-chain via user-decrypt
            FHE.allow(_totalRaised, creator);
        }

        emit Finalized(goalMet, totalCleartext);
    }

    /// @notice After successful finalisation, creator pulls the funds.
    /// @dev Uses revealedTotal as the plaintext amount — at this point the
    ///      total is publicly known anyway. Encrypts the value as a euint64
    ///      via trivial encrypt and transfers.
    function withdrawToCreator() external {
        require(msg.sender == creator, "only creator");
        require(finalized && goalMet, "not funded");
        euint64 total = FHE.asEuint64(revealedTotal);
        FHE.allowTransient(total, address(token));
        token.transferValidated(creator, total);
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
