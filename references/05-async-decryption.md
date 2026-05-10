# 05 — Async decryption (modern v0.11 pattern)

## Contents
- Why async
- Three-step flow
- Full example with replay defense
- Two-step finality delay
- Common bugs

## Why async

There is no synchronous `decrypt()` on-chain. The KMS lives off-chain; a
relayer fetches the plaintext, gets it signed by a KMS quorum, and submits
it back to the contract via a callback. The contract verifies the signatures
with `FHE.checkSignatures(plaintext, sigs)`.

## Three-step flow

```
   ┌─────────────┐     1. mark handle decryptable     ┌─────────────┐
   │             │ ─────────────────────────────────► │             │
   │  Contract   │                                    │   Relayer   │
   │             │ ◄───── 3. callback(plain, sigs) ── │ + KMS quorum│
   └─────────────┘                                    └─────────────┘
                          2. KMS signs plaintext off-chain
```

## Full example

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract Vault is ZamaEthereumConfig {
    struct Request { address to; }
    mapping(uint256 => Request) private _pending;
    uint256 private _nextId;
    mapping(address => euint64) private _balances;

    event WithdrawRequested(uint256 indexed id, bytes32 handle);
    event WithdrawFulfilled(uint256 indexed id, address indexed to, uint64 amount);

    function requestWithdraw() external {
        euint64 bal = _balances[msg.sender];
        require(FHE.isSenderAllowed(bal), "no access");
        FHE.makePubliclyDecryptable(bal);
        uint256 id = ++_nextId;
        _pending[id] = Request({to: msg.sender});
        emit WithdrawRequested(id, euint64.unwrap(bal));
    }

    function fulfillWithdraw(
        uint256 id,
        uint64 amountClear,
        bytes[] calldata signatures
    ) external {
        Request memory r = _pending[id];
        require(r.to != address(0), "unknown id");
        delete _pending[id];                          // (A) replay defense

        FHE.checkSignatures(amountClear, signatures); // (B) KMS quorum

        // (C) effects
        (bool ok,) = r.to.call{value: amountClear}("");
        require(ok, "transfer fail");

        emit WithdrawFulfilled(id, r.to, amountClear);
    }
}
```

Three invariants enforced in order: **delete pending → verify signatures →
external effects.** Violating any is a known bug class.

## Two-step finality delay (reorg defense)

For *information-as-product* releases (auction winner, sealed-bid reveal,
prediction-market outcome), the relayer can complete its loop within a
block or two — but a reorg can still flip the underlying chain state.
Losers who already decrypted retain the plaintext.

Use a two-step ritual:

```solidity
uint256 private _scheduledBlock;
uint256 private constant FINALITY_BLOCKS = 12;   // Sepolia

function scheduleReveal() external {
    require(block.timestamp > AUCTION_END);
    require(_scheduledBlock == 0, "already scheduled");
    _scheduledBlock = block.number;
}

function reveal() external {
    require(_scheduledBlock != 0, "not scheduled");
    require(block.number >= _scheduledBlock + FINALITY_BLOCKS, "wait for finality");
    FHE.makePubliclyDecryptable(_winningBid);
    FHE.makePubliclyDecryptable(_winner);
}
```

For mainnet use `FINALITY_BLOCKS = 64` (post-merge finality boundary).

## Common bugs

- **Skipping `delete _pending[id]` before effects** (AP-010). Allows relayer
  to replay the callback with the same `id`, draining the contract.
- **Using the ciphertext handle (`bytes32`) as the request ID** (AP-017).
  Handle ids can collide under ACL rotation; use a monotonic counter.
- **Calling `FHE.checkSignatures` after external call.** Always verify before
  state-modifying effects.
- **Disclosing immediately on time-lock expiry** (AP-019). Add finality
  delay if information is valuable.
- **Forgetting to grant ACL before requesting decryption.** The handle must
  have `allow(_, address(this))` or `makePubliclyDecryptable` set or the
  relayer cannot read it.
