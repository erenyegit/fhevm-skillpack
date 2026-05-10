# Recipe — Confidential vote (private ballot, public tally)

**Goal:** N voters submit an encrypted choice (1 = yes, 0 = no). The
contract computes an encrypted tally; only the final tally is revealed.

## Key FHE primitives
- `euint8` per vote, `euint32` running tally
- `FHE.add` for accumulation
- `FHE.makePubliclyDecryptable` after voting closes + finality delay
- `mapping(address => bool) hasVoted` plaintext to prevent double-voting

## Contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint8, euint32, externalEuint8} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract ConfidentialVote is ZamaEthereumConfig {
    uint256 public immutable closeTime;
    euint32 private _yesTally;
    mapping(address => bool) public hasVoted;
    uint256 private _scheduledBlock;
    uint256 private constant FINALITY_BLOCKS = 12;

    constructor(uint256 _close) { closeTime = _close; }

    function vote(externalEuint8 encChoice, bytes calldata proof) external {
        require(block.timestamp < closeTime, "closed");
        require(!hasVoted[msg.sender], "voted");
        hasVoted[msg.sender] = true;

        euint8 choice = FHE.fromExternal(encChoice, proof);   // 0 or 1 (caller-attested)
        euint32 wide  = FHE.asEuint32(choice);
        _yesTally     = FHE.add(_yesTally, wide);
        FHE.allowThis(_yesTally);
    }

    function scheduleReveal() external {
        require(block.timestamp >= closeTime, "open");
        require(_scheduledBlock == 0, "scheduled");
        _scheduledBlock = block.number;
    }

    function reveal() external {
        require(_scheduledBlock != 0 && block.number >= _scheduledBlock + FINALITY_BLOCKS, "wait");
        FHE.makePubliclyDecryptable(_yesTally);
    }

    function getTally() external view returns (euint32) { return _yesTally; }
}
```

## Test
```solidity
function test_voteHidesIndividualBallot() public {
    (externalEuint8 e1, bytes memory p1) = encryptUint8(1, alice, address(vote));
    vm.prank(alice); vote.vote(e1, p1);
    // Alice's individual ballot is NOT decryptable by anyone — no allow grant.
    bytes memory sig = signUserDecrypt(BOB_PK, address(vote));
    vm.expectRevert();
    userDecrypt(euint32.unwrap(vote.getTally()), bob, address(vote), sig);
}
```

## Common pitfalls
- **No clamp on choice.** A malicious voter could encrypt `255` instead of
  `0/1`. Defense: `FHE.select(FHE.gt(choice, 1), 1, choice)` to clamp.
- **AP-019:** reveal immediately on closeTime is reorg-vulnerable.
- **Voting weight via `euint*`:** if weighted (token-weighted vote), use
  `FHE.mul(weight, choice)` and apply AP-009 overflow guard.
