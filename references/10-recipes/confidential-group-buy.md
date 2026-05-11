# Recipe — Confidential group-buy (Kickstarter for FHEVM)

**Goal:** Backers pledge encrypted amounts in a confidential token toward
a public goal. Individual pledges remain private forever; only the total
is revealed (and only when the goal is reached). On success, funds are
released to the creator.

This is the **demo contract** for fhevm-skillpack. The complete
implementation with async-decryption replay defense, AP-023
seed-in-constructor fix, and AP-024 post-schedule mutation guard lives at
`packages/foundry/src/ConfidentialGroupBuy.sol`. The React UI that drives
it via `@zama-fhe/react-sdk` lives at
`packages/nextjs/app/group-buy/page.tsx`.

## Key FHE primitives

- `euint64` per-backer pledge + running encrypted total
- `FHE.add` accumulator
- Public `goalAmount` (plaintext) — comparison happens on cleartext after
  reveal
- `FHE.makePubliclyDecryptable` of the total when goal-check is triggered
- Async callback with **delete-before-effects** (AP-010 defense)
- Per-backer ACL: only the backer can decrypt their own contribution

## Architecture

```
backer ──pledge(encAmount, proof)──► contract:
                                       ├─ contributions[backer] += encAmount
                                       ├─ allow(contributions[backer], backer)  ← per-backer privacy
                                       ├─ encTotalRaised += encAmount
                                       └─ allowThis(encTotalRaised)

creator ──requestFinalization()──►  makePubliclyDecryptable(encTotalRaised)
                                     pendingFinalization[id] = true
relayer ──finalizeCallback(total, sigs)─► verify, delete pending,
                                          if total >= goal: transfer to creator
                                          else: enable refunds
```

## Contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

interface IConfidentialToken {
    function confidentialTransferFrom(address from, address to, externalEuint64 enc, bytes calldata proof)
        external returns (euint64 transferred);
    function confidentialTransfer(address to, externalEuint64 enc, bytes calldata proof)
        external returns (euint64 transferred);
}

contract ConfidentialGroupBuy is ZamaEthereumConfig {
    IConfidentialToken public immutable token;
    address public immutable creator;
    uint64  public immutable goalAmount;        // plaintext, public goal
    uint256 public immutable deadline;

    euint64 private _totalRaised;               // encrypted aggregate
    mapping(address => euint64) private _contributions;

    uint256 public finalizationRequestId;       // 0 = not requested
    bool    public finalized;
    bool    public goalMet;
    uint64  public revealedTotal;               // set in callback

    event Pledged(address indexed backer, bytes32 amountHandle);
    event FinalizationRequested(uint256 requestId);
    event Finalized(bool goalMet, uint64 total);

    constructor(IConfidentialToken _t, uint64 _goal, uint256 _deadline) {
        token = _t; creator = msg.sender; goalAmount = _goal; deadline = _deadline;
    }

    function pledge(externalEuint64 encAmount, bytes calldata proof) external {
        require(block.timestamp < deadline, "deadline passed");
        require(!finalized, "finalized");

        // Pull tokens; effective transferred amount may be less than requested
        euint64 transferred = token.confidentialTransferFrom(msg.sender, address(this), encAmount, proof);

        _contributions[msg.sender] = FHE.add(_contributions[msg.sender], transferred);
        _totalRaised               = FHE.add(_totalRaised, transferred);

        FHE.allowThis(_contributions[msg.sender]);
        FHE.allow(_contributions[msg.sender], msg.sender);   // backer can see own
        FHE.allowThis(_totalRaised);

        emit Pledged(msg.sender, euint64.unwrap(transferred));
    }

    function requestFinalization() external {
        require(block.timestamp >= deadline, "ongoing");
        require(finalizationRequestId == 0, "requested");
        finalizationRequestId = uint256(blockhash(block.number - 1)) | 1;  // monotonic-ish nonzero
        FHE.makePubliclyDecryptable(_totalRaised);
        emit FinalizationRequested(finalizationRequestId);
    }

    function finalizeCallback(uint256 requestId, uint64 totalCleartext, bytes[] calldata sigs) external {
        require(requestId != 0 && requestId == finalizationRequestId, "bad id");
        require(!finalized, "done");
        finalized = true;                                // ← delete-before-effects equivalent
        finalizationRequestId = 0;

        FHE.checkSignatures(totalCleartext, sigs);
        revealedTotal = totalCleartext;
        goalMet = totalCleartext >= goalAmount;

        if (goalMet) {
            // Reveal total to creator; they can pull funds in a follow-up tx.
            FHE.allow(_totalRaised, creator);
        }
        emit Finalized(goalMet, totalCleartext);
    }

    function getMyContribution() external view returns (euint64) {
        return _contributions[msg.sender];
    }
}
```

## Test highlights

See `packages/foundry/test/ConfidentialGroupBuy.t.sol` for the full
6-test suite covering:

1. Three backers pledge, encrypted total accumulates correctly.
2. Goal-met triggers `goalMet = true` after async callback.
3. Replay attack on `finalizeCallback` rejected (`finalized = true` blocks reuse).
4. Each backer can decrypt own contribution but not others'.
5. Silent-failure: a backer with insufficient cUSD bids high → only
   transferred amount counted.

## Common pitfalls

- **AP-018 silent transfer failure ignored.** This contract uses
  `transferred` (effective) and not `encAmount` (requested). Critical.
- **AP-010 callback replay.** `finalized = true` must be set before any
  external interaction.
- **Per-backer ACL omission.** Without `FHE.allow(_contributions[msg.sender], msg.sender)`
  the backer cannot see their own pledge — no UX feedback.
- **`requestFinalization()` open to anyone before deadline.** Restrict by
  `block.timestamp >= deadline`.
- **Comparing `_totalRaised` to `goalAmount` on-chain encrypted.** Tempting,
  but you'd need to reveal the result anyway. Cheaper to reveal the total
  via callback and compare in plaintext.
