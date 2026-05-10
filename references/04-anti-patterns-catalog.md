# 04 — Anti-patterns catalog (22 rules)

Every rule has a stable ID (`AP-XXX`) used by the bundled linter. Rules are
grouped by category. Severity legend: 🔴 error · 🟡 warning · 🔵 info.

## Contents
- AP-001 to AP-005: Branching, imports, decryption, ACL, casts
- AP-006 to AP-010: Inputs, types, division, overflow, callback replay
- AP-011 to AP-015: Views, persistent allow, hashing, frontend instance, signature storage
- AP-016 to AP-020: URL leak, request IDs, silent transfers, reorg, AA transient
- AP-021 to AP-022: 3rd-party encryption replay, arbitrary execute

---

## AP-001 🔴 Solidity branching on encrypted value
**Category:** Control flow

❌ Bad
```solidity
if (FHE.gt(a, b)) { _max = a; } else { _max = b; }
require(FHE.eq(role, FHE.asEuint8(ADMIN)), "denied");
_winner = FHE.gt(a, b) ? a : b;   // ternary still illegal
```
⚠️ Why: encrypted booleans cannot be evaluated by the EVM. The compiler
either rejects or — worse — silently truncates the encrypted bool to zero.

✅ Good
```solidity
_max = FHE.select(FHE.gt(a, b), a, b);
// For "guards" — let the wrong path produce a no-op:
ebool isAdmin = FHE.eq(role, FHE.asEuint8(ADMIN));
_balance = FHE.select(isAdmin, _balance, FHE.add(_balance, penalty));
```

---

## AP-002 🔴 Legacy TFHE import
**Category:** Import / API version

❌ Bad: `import "fhevm/lib/TFHE.sol";` · `TFHE.add(...)`
⚠️ Why: TFHE namespace was removed in v0.7→v0.11 migration.

✅ Good
```solidity
import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
```

---

## AP-003 🔴 Synchronous decryption
**Category:** Decryption flow

❌ Bad: `uint64 v = handle.decrypt();` · `TFHE.decrypt(h);` · `handle.reveal();`
⚠️ Why: synchronous on-chain decryption was removed. Plaintext is not
available in the same tx.

✅ Good: see `references/05-async-decryption.md` — `makePubliclyDecryptable`
→ relayer → callback with `checkSignatures`.

---

## AP-004 🔴 Storage write without `allowThis`
**Category:** ACL

❌ Bad
```solidity
_balance = FHE.add(_balance, amount);
// next tx: read returns zero handle, ACL silently denied
```
✅ Good
```solidity
_balance = FHE.add(_balance, amount);
FHE.allowThis(_balance);
FHE.allow(_balance, msg.sender);
```

---

## AP-005 🟡 Direct cast from encrypted handle
**Category:** Type system

❌ Bad: `uint64 plain = uint64(euint64.unwrap(handle));`
⚠️ Why: `euint64.unwrap` returns the `bytes32` handle id, not plaintext.
Casting it to `uint64` yields garbage but compiles.

✅ Good: use the async decrypt flow. If you only need the handle as bytes:
`bytes32 h = euint64.unwrap(handle);` and emit/index it.

---

## AP-006 🔴 Skipping `FHE.fromExternal`
**Category:** Input handling

❌ Bad
```solidity
function deposit(externalEuint64 enc, bytes calldata proof) external {
    _balance = FHE.add(_balance, /* enc directly */ enc);  // doesn't compile, but
                                                            // even via raw bytes32 reuse, would skip proof
}
```
✅ Good
```solidity
function deposit(externalEuint64 enc, bytes calldata proof) external {
    euint64 amount = FHE.fromExternal(enc, proof);
    _balance = FHE.add(_balance, amount);
    FHE.allowThis(_balance);
}
```

---

## AP-007 🟡 `euint256` for token balances
**Category:** Type sizing

❌ Bad: `mapping(address => euint256) _balances;`
⚠️ Why: 4–6× HCU cost for no benefit. ERC-7984 standard is `euint64`.

✅ Good: `mapping(address => euint64) _balances;`

Linter flags `euint256` when the storage variable name matches `balance`,
`balances`, `amount`, `total`, `supply`, `reserve`.

---

## AP-008 🔴 Encrypted divisor in `FHE.div` / `FHE.rem`
**Category:** Op constraints

❌ Bad: `FHE.div(amount, _bpsHandle);`
✅ Good: `FHE.div(amount, BPS_PLAIN);` (plaintext divisor only)

If you genuinely need encrypted division (rare), express it as a series of
`select` over plaintext divisor candidates, or do the division off-chain in
a decryption callback.

---

## AP-009 🔴 `mul`/`sub` without overflow guard
**Category:** Arithmetic safety (OZ Fabry vulnerability #1)

❌ Bad
```solidity
// Fee math — overflow on mul wraps the numerator to a tiny value
euint64 feeNumerator = FHE.mul(amount, FHE.asEuint64(FEE_BPS));
euint64 fee = FHE.div(feeNumerator, FEE_DENOM);
```
✅ Good
```solidity
uint64 constant MAX_SAFE = type(uint64).max / FEE_BPS;
ebool tooBig = FHE.gt(amount, FHE.asEuint64(MAX_SAFE));
euint64 capped = FHE.select(tooBig, FHE.asEuint64(MAX_SAFE), amount);
euint64 feeNumerator = FHE.mul(capped, FHE.asEuint64(FEE_BPS));
```

---

## AP-010 🔴 Async callback without `delete` before effects
**Category:** Replay defense (OZ Fabry vulnerability #4)

❌ Bad
```solidity
function fulfillWithdraw(uint256 id, uint64 amount, bytes[] calldata sigs) external {
    FHE.checkSignatures(amount, sigs);
    address to = _pending[id].to;
    (bool ok,) = to.call{value: amount}("");
    // _pending[id] not deleted — relayer can replay
}
```
✅ Good
```solidity
function fulfillWithdraw(uint256 id, uint64 amount, bytes[] calldata sigs) external {
    Request memory r = _pending[id];
    require(r.to != address(0), "unknown");
    delete _pending[id];                       // ← FIRST
    FHE.checkSignatures(amount, sigs);
    (bool ok,) = r.to.call{value: amount}("");
}
```

---

## AP-011 🟡 Returning encrypted handle from `view`
**Category:** ACL

❌ Bad: `function balanceOf(address a) external view returns (euint64) { return _b[a]; }`
⚠️ Why: a `view` cannot call `FHE.allow`, so the returned handle is unusable
to the caller. Either declare non-view and grant, or use a separate
authorisation function.

✅ Good
```solidity
function balanceOf(address a) external view returns (euint64) {
    return _b[a];  // OK only if persistent allow was already granted on write
}
function grantBalanceAccess() external {
    FHE.allow(_b[msg.sender], msg.sender);
}
```

---

## AP-012 🔴 Persistent `allow` to helper contracts (lateral leak)
**Category:** ACL (OZ Fabry vulnerability #3)

❌ Bad: `FHE.allow(amount, address(feeHandler));`
✅ Good: `FHE.allowTransient(amount, address(feeHandler));`

See lateral-leak scenario in `references/03-acl-decision-tree.md`.

---

## AP-013 🟡 Hashing `(value, proof)` for replay defense
**Category:** Replay defense

❌ Bad: using `keccak256(abi.encode(externalEuint, inputProof))` as a uniqueness
key — input proofs are malleable; the same logical input can produce different
proofs.
✅ Good: convert with `FHE.fromExternal` and key on the internal handle id,
or use a per-user nonce.

---

## AP-014 🟡 `createInstance` per render (frontend)
**Category:** Frontend perf

❌ Bad
```ts
function Component() {
    const instance = await createInstance(SepoliaConfig);  // every render
    // ...
}
```
✅ Good: create once at the provider level (`@zama-fhe/react-sdk`'s
`ZamaProvider` does this). Hooks consume the shared instance.

---

## AP-015 🟡 EIP-712 signature in `localStorage` (frontend)
**Category:** Frontend security

❌ Bad: `localStorage.setItem("fhe-sig", sig);`
⚠️ Why: any XSS reads the signature; an attacker can decrypt arbitrary handles.
✅ Good: keep the signature in a React-Query / in-memory cache. Re-prompt
on hard refresh.

---

## AP-016 🟡 Decrypted plaintext in URL or query param
**Category:** Frontend security

❌ Bad: `router.push(\`/result?value=\${decryptedBalance}\`);`
⚠️ Why: URL leaks via referer, browser history, server logs.
✅ Good: keep decrypted values in component state only.

---

## AP-017 🔴 Ciphertext handle as decryption request ID
**Category:** Async flow

❌ Bad
```solidity
_pending[euint64.unwrap(handle)] = msg.sender;
```
⚠️ Why: handle bytes are not guaranteed unique across re-encryptions; ACL
rotation can produce handle collisions.
✅ Good: use a monotonically increasing counter `uint256 nextId++`.

---

## AP-018 🔴 Silent transfer failure ignored in auction
**Category:** Logic flaw (OZ Fabry vulnerability #5)

❌ Bad
```solidity
function bid(externalEuint64 amount, bytes calldata proof) external {
    euint64 a = FHE.fromExternal(amount, proof);
    cWETH.confidentialTransferFrom(msg.sender, address(this), a);  // can silently transfer 0
    ebool isHigher = FHE.gt(a, _highestBid);
    _highestBid    = FHE.select(isHigher, a, _highestBid);
    _highestBidder = FHE.select(isHigher, FHE.asEaddress(msg.sender), _highestBidder);
}
```
✅ Good — base state changes on the *effective* transferred amount:
```solidity
euint64 effective = cWETH.confidentialTransferFrom(msg.sender, address(this), a);
ebool actuallyTransferred = FHE.gt(effective, FHE.asEuint64(0));
ebool isHigher  = FHE.gt(effective, _highestBid);
ebool isBest    = FHE.and(actuallyTransferred, isHigher);
_highestBid     = FHE.select(isBest, effective, _highestBid);
_highestBidder  = FHE.select(isBest, FHE.asEaddress(msg.sender), _highestBidder);
```

---

## AP-019 🔴 Disclosing winner without finality delay
**Category:** Reorg attack (OZ Fabry vulnerability #6)

❌ Bad
```solidity
function reveal() external {
    require(block.timestamp > END);
    FHE.makePubliclyDecryptable(_highestBid);
    FHE.makePubliclyDecryptable(_highestBidder);
}
```
⚠️ Why: a reorg after losers decrypt can flip the winner; losers retain
plaintext anyway, breaking confidentiality of the underlying asset.

✅ Good — two-step with finality delay:
```solidity
function scheduleReveal() external {
    require(block.timestamp > END);
    _disclosureScheduledBlock = block.number;
}
function reveal() external {
    require(block.number >= _disclosureScheduledBlock + FINALITY_BLOCKS);
    FHE.makePubliclyDecryptable(_highestBid);
    FHE.makePubliclyDecryptable(_highestBidder);
}
```

`FINALITY_BLOCKS = 12` on Sepolia, `64` on mainnet (post-merge finality).

---

## AP-020 🟡 AA transient-storage leak between user ops
**Category:** Account abstraction (OZ Fabry vulnerability #7)

❌ Bad: AA bundler packs multiple user ops into one tx; `FHE.allowTransient`
grants from user op #1 are still readable in user op #2.

✅ Good: call `FHE.cleanTransientStorage()` at the end of each user op handler.

---

## AP-021 🔴 3rd-party-caller external-encryption replay
**Category:** Input handling (OZ Fabry vulnerability #8)

❌ Bad: a relayer submits Alice's encrypted tuple `(externalEuint64, proof)`
to a contract that trusts `msg.sender = Alice`. An attacker can re-submit
the same tuple from their own account to learn the plaintext via a balance
side-channel.

✅ Good: either (a) include `msg.sender` as part of what the frontend
encrypts and binds to, (b) consume the tuple via an intermediate
`FHE.fromExternal` that re-validates context, or (c) use a per-user nonce
captured in the proof.

---

## AP-022 🔴 Arbitrary `execute(target, data)` allowing ACL grant
**Category:** Privilege escalation (OZ Fabry vulnerability #9)

❌ Bad
```solidity
function execute(address target, bytes calldata data) external onlyOwner {
    (bool ok,) = target.call(data);  // attacker-controlled target can call ACL
}
```
✅ Good: forbid arbitrary external calls in confidential contracts. If
necessary, whitelist targets and validate calldata selectors.
