# 03 — ACL decision tree

## Contents
- TL;DR rule table
- Decision flowchart
- Lifecycle: transient vs persistent vs public
- Lateral-leak scenario (OpenZeppelin Fabry guide)
- Common mistakes

## TL;DR

| Situation | Call |
|---|---|
| Storing an encrypted handle to contract storage | `FHE.allowThis(handle)` |
| Returning an encrypted handle to `msg.sender` for off-chain decryption | `FHE.allow(handle, msg.sender)` |
| Passing handle to a helper contract for ONE call in this tx | `FHE.allowTransient(handle, helper)` |
| Passing handle to a helper contract that needs persistent access | `FHE.allow(handle, helper)` — audit twice |
| Result is truly public (auction outcome, vote tally, after finality) | `FHE.makePubliclyDecryptable(handle)` — **irreversible** |
| You received a handle and want to use it | `require(FHE.isSenderAllowed(handle));` first |
| Account-abstraction wallet finishing a user op | `FHE.cleanTransientStorage();` at end |

## Decision flowchart

```
Did you just write an encrypted value to storage?
└── YES → FHE.allowThis(handle).  Done.
└── NO  → continue
Are you returning the handle or putting it in a per-user mapping?
└── YES → caller will decrypt off-chain → FHE.allow(handle, recipient)
└── NO  → continue
Are you handing it to another contract for computation?
└── YES, one tx only → FHE.allowTransient(handle, helper)
└── YES, persistent → FHE.allow(handle, helper)  ⚠ audit for lateral leaks
└── NO  → continue
Is the value genuinely public (finalized auction winner, vote tally)?
└── YES → FHE.makePubliclyDecryptable(handle).  IRREVERSIBLE — re-confirm.
```

## Lifecycle

### Transient (`allowTransient`)
- Stored in EIP-1153 transient storage
- Wiped at end of transaction
- **Cheapest** — prefer for helper-contract calls within one tx
- Cleared automatically; but in account abstraction (multiple user ops per tx),
  call `FHE.cleanTransientStorage()` between user ops to avoid leakage
  (see AP-020 in catalog)

### Persistent (`allow`)
- Stored in dedicated ACL contract storage
- Survives across transactions until contract or grantee revokes
- **Expensive** and high-risk — every persistent grant is an attack surface
  for ACL exfiltration through compromised helper contracts

### `allowThis`
- Sugar for `allow(handle, address(this))`
- Required after every storage write because reading the handle next tx
  requires `address(this)` to have ACL access to itself

### `makePubliclyDecryptable`
- Grants global decryption ability — permanent and irrevocable
- Use only for genuinely public outcomes
- Combine with a **finality delay** for time-sensitive disclosures (see
  reorg-disclosure anti-pattern AP-019)

## Lateral-leak scenario

Adapted from the OpenZeppelin Fabry security guide.

A confidential token (cWETH) transfers an encrypted balance to a fee helper:

```solidity
// VULNERABLE
function _transferWithFee(address to, euint64 amount) internal {
    FHE.allow(amount, address(feeHandler));        // PERSISTENT — never expires
    euint64 fee = feeHandler.calculateFee(amount);
    // ... use fee
}
```

`feeHandler` retains ACL access to `amount` forever. If a different transaction
later calls `feeHandler.calculateFee(amount)` from an attacker context, the
attacker now reads a value originally meant for an internal helper.

**Fix:** scope to the single tx.

```solidity
function _transferWithFee(address to, euint64 amount) internal {
    FHE.allowTransient(amount, address(feeHandler));  // expires end of tx
    euint64 fee = feeHandler.calculateFee(amount);
}
```

## Receive-side validation

When your contract receives an encrypted handle from another contract or
caller, the ACL grant on its own is not enough. Always verify the caller
was allowed to hand you that handle:

```solidity
function processBid(euint64 bid) external {
    require(FHE.isSenderAllowed(bid), "Not authorized for this ciphertext");
    // safe to use bid
}
```

Without this check, an attacker who picks up a stale ciphertext handle from
events can replay it into your contract.

## Common mistakes

- Forgetting `allowThis` after `storage[k] = FHE.add(...)` — next read returns
  zero handle and the contract appears to silently lose state.
- Granting `FHE.allow` (persistent) when `allowTransient` would suffice.
- Calling `makePubliclyDecryptable` without a finality delay — Sepolia reorgs
  can swap the underlying value after losers decrypt.
- Granting `FHE.allow` to `tx.origin` thinking it's safer than `msg.sender` —
  `tx.origin` is meaningless under account abstraction.
- Missing `FHE.isSenderAllowed` check on functions that consume external handles.
