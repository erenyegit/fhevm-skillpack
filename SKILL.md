---
name: fhevm-skillpack
description: |
  Use this skill WHENEVER the user asks about Zama, FHEVM, Fully Homomorphic
  Encryption on EVM, confidential smart contracts, encrypted state, euint*,
  ebool, eaddress, FHE.add/lt/select, ACL.allow, externalEuint, input proofs,
  encrypted ERC-7984 tokens, sealed-bid auctions, confidential DeFi, or any
  Solidity contract that should keep state private on Ethereum/Sepolia. Trigger
  on .sol files importing @fhevm/solidity, foundry.toml referencing forge-fhevm,
  hardhat configs containing fhevm, frontend code importing @zama-fhe/sdk or
  @zama-fhe/react-sdk. This skill prevents the most common AI failure modes:
  using ZK instead of FHE, branching with if/else on encrypted values, calling
  deprecated TFHE.decrypt(), forgetting FHE.allowThis after assignment, treating
  encrypted overflow like Solidity 0.8+ checked arithmetic. Ships an AST-aware
  linter, auto-fix tool, MCP server, and 22 anti-pattern catalog.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
keywords: fhevm, zama, fhe, confidential, encrypted, euint, ebool, ciphertext, acl, sepolia, foundry, hardhat, forge-fhevm
---

# fhevm-skillpack

Use this skill anytime you write, review, test, or deploy a Solidity contract
that uses Fully Homomorphic Encryption on EVM (Zama Protocol, FHEVM v0.11+).
**Foundry + forge-fhevm is the primary stack.** Hardhat + `@fhevm/hardhat-plugin`
is documented as secondary because the same `@fhevm/solidity` library underlies
both.

<critical_directives priority="MAXIMUM">

These rules are non-negotiable. Violating any one of them produces a contract
that either silently fails, leaks plaintext, or is exploitable.

1. **NEVER use Solidity `if`, `require`, `revert`, `&&`, `||`, ternary `?:`, or
   any control flow on an encrypted value (`ebool`, `euint*`, `eaddress`).**
   Encrypted booleans cannot be branched on — the EVM cannot read them. Use
   `FHE.select(cond, a, b)` for conditional selection. To enforce a guard, fold
   the guard into a `select` and let the wrong path produce a no-op
   (e.g. update with `oldValue` when the condition fails).

2. **NEVER call `TFHE.decrypt()`, `.decrypt()`, `.reveal()`, or any synchronous
   decryption.** Decryption is asynchronous. The pattern is:
   `FHE.makePubliclyDecryptable(handle)` (or per-user `FHE.allow(handle, user)`)
   → relayer signs the plaintext off-chain → contract callback verifies via
   `FHE.checkSignatures(plaintext, signatures)` → state effects.

3. **EVERY encrypted value written to storage MUST be followed by
   `FHE.allowThis(handle)` in the same transaction.** Without this, the
   contract loses ACL access to its own ciphertext on the next call and reads
   silently fail.

4. **EVERY encrypted value handed to another address (return value, mapping
   indexed by user, callback to relayer) MUST have `FHE.allow(handle, recipient)`.**
   Prefer `FHE.allowTransient(handle, recipient)` for one-call helpers — it
   auto-clears at end of transaction (EIP-1153) and prevents lateral leak via
   persistent ACL grant.

5. **ENCRYPTED ARITHMETIC IS UNCHECKED.** `FHE.add` / `FHE.sub` / `FHE.mul`
   wrap on overflow with no revert. Solidity 0.8+ checked arithmetic does **not**
   apply to ciphertext. Always guard with `FHE.gt`/`FHE.lt` + `FHE.select`
   before any operation that could wrap. Pay special attention to fee math
   (`mul` then `div`) where overflow on `mul` produces tiny fee values.

6. **DO NOT reach for FHE if the use case is single-party self-proof.** Use ZK
   (Noir, Circom, RISC Zero) for "prove I know X without revealing X." FHE is
   for **computation on encrypted data from MULTIPLE parties** or persistent
   encrypted shared state (confidential balances, sealed bids, private votes).

7. **Imports & inheritance.** Always:
   ```solidity
   import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
   import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
   contract MyContract is ZamaEthereumConfig { ... }
   ```
   In **Foundry** the path resolves via soldeer remapping
   (`@fhevm/solidity/=dependencies/@fhevm-solidity-0.11.1/`). In **Hardhat** it
   resolves via npm. **NEVER** use `fhevm/lib/TFHE.sol` (deprecated v0.7 path).
   For tests in Foundry inherit `FhevmTest` from `forge-fhevm/FhevmTest.sol`.

</critical_directives>

<decision_tree>

User says... → Read this reference file:

| User intent                                                      | File                                     |
| ---------------------------------------------------------------- | ---------------------------------------- |
| "What encrypted types should I use?"                             | `references/01-types-cheatsheet.md`      |
| "Which FHE op for X? What does it cost?"                         | `references/02-operations-table.md`      |
| "Who can decrypt this? When do I call allow vs allowThis?"       | `references/03-acl-decision-tree.md`     |
| "Is this code safe? Is this an anti-pattern?"                    | `references/04-anti-patterns-catalog.md` |
| "How do I decrypt asynchronously?"                               | `references/05-async-decryption.md`      |
| "How do encrypted inputs from the frontend work?"                | `references/06-input-proofs.md`          |
| "How do I test this in Foundry / Hardhat?"                       | `references/07-testing-frameworks.md`    |
| "How do I encrypt/decrypt in the React app?"                     | `references/08-relayer-sdk-frontend.md`  |
| "Audit this for security issues"                                 | `references/09-security-checklist.md`    |
| "Build me a [token / auction / vote / oracle / DCA / group buy]" | `references/10-recipes/<recipe>.md`      |

Always run `pnpm lint:fhe` (this skill's bundled AST linter) on any
modified `.sol` file before declaring work complete. If issues surface, run
`pnpm fix:fhe` for auto-fix where possible (8 of 22 rules).

</decision_tree>

<self_check_protocol>

Before declaring any FHEVM contract complete, walk this 8-item checklist:

1. Every storage write of an encrypted handle is followed by `FHE.allowThis`?
2. Every encrypted return value or per-user handle has `FHE.allow` (or `allowTransient`)?
3. No `if` / `require` / ternary / `&&` / `||` operates on an encrypted value?
4. Every `FHE.mul` / `FHE.sub` that could wrap is guarded with `FHE.select`?
5. No `TFHE.*` import remains? No synchronous `.decrypt()` call?
6. Async decryption callback deletes its request record **before** any external call (replay defense)?
7. `FHE.fromExternal(externalEuintXX, inputProof)` is called on every external input, and the function does **not** validate the input came from the original encrypter (or it explicitly handles third-party caller risk per `references/06-input-proofs.md`)?
8. `pnpm lint:fhe` reports zero errors on the modified files? `forge test` (or `npx hardhat test`) passes?

If any check fails → fix before responding to the user with "done."

</self_check_protocol>

<encrypted_types_quickref>

| Type                          | Use for                                                                         | Bit-width |
| ----------------------------- | ------------------------------------------------------------------------------- | --------- |
| `ebool`                       | Boolean flags, comparison results, gates fed to `FHE.select`                    | 1         |
| `euint8`                      | Small flags, percentage fields, one-byte enums                                  | 8         |
| `euint16`                     | Counters, small ID spaces                                                       | 16        |
| `euint32`                     | Sub-billion integers                                                            | 32        |
| `euint64`                     | **Default for token balances and amounts** (matches ERC-7984)                   | 64        |
| `euint128`                    | Large monetary aggregates, BPS math                                             | 128       |
| `euint256`                    | Cryptographic-grade large numbers — **avoid for anything else** (4–6× more HCU) | 256       |
| `eaddress` (alias `euint160`) | Encrypted addresses (sealed-bid winner)                                         | 160       |
| `externalEuintXX`             | Wire-format encrypted input — convert immediately via `FHE.fromExternal`        | varies    |

Pick the **smallest** type that fits. HCU cost scales superlinearly with width.

</encrypted_types_quickref>

<operations_quickref>

```solidity
// Arithmetic (UNCHECKED — guard with FHE.select)
FHE.add(a, b)   FHE.sub(a, b)   FHE.mul(a, b)
FHE.neg(a)      FHE.min(a, b)   FHE.max(a, b)
// Plaintext divisor only — encrypted divisor not supported
FHE.div(a, plaintextUint)   FHE.rem(a, plaintextUint)

// Bitwise
FHE.and(a, b)   FHE.or(a, b)    FHE.xor(a, b)   FHE.not(a)
FHE.shr(a, shift)   FHE.shl(a, shift)
FHE.rotr(a, shift)  FHE.rotl(a, shift)

// Comparison → ebool
FHE.eq(a, b)    FHE.ne(a, b)
FHE.lt(a, b)    FHE.le(a, b)
FHE.gt(a, b)    FHE.ge(a, b)

// Conditional
FHE.select(ebool cond, euintX a, euintX b) → euintX

// Casts and constants
FHE.asEuintXX(plaintextUint)
FHE.asEuintXX(externalEuintXX, inputProof)  // legacy spelling — prefer FHE.fromExternal
FHE.fromExternal(externalEuintXX, inputProof)

// Randomness
FHE.randEuintXX()           FHE.randEbool()
FHE.randBounded(upperBound)
```

Full HCU cost table: `references/02-operations-table.md`. Tx limit: **20M HCU**;
sequential depth limit: **5M HCU**.

</operations_quickref>

<acl_quickref>

```solidity
FHE.allowThis(handle);                    // Required after every storage write
FHE.allow(handle, user);                  // Persistent grant — use sparingly
FHE.allowTransient(handle, helper);       // Tx-scope grant (EIP-1153) — preferred for helper calls
FHE.makePubliclyDecryptable(handle);      // IRREVERSIBLE — anyone can decrypt forever
FHE.isSenderAllowed(handle);              // Check — use as require() before processing input
FHE.isAllowed(handle, addr);              // Check for arbitrary address
FHE.checkSignatures(plaintext, sigs);     // Verify relayer-signed decryption in callback
FHE.cleanTransientStorage();              // Wipe transient ACL — call between user ops in AA wallet
```

Decision flow:

- Storage write of encrypted handle → `FHE.allowThis(handle)` (always)
- Returning encrypted handle to caller → `FHE.allow(handle, msg.sender)`
- Passing handle to a helper contract that needs it for one call →
  `FHE.allowTransient(handle, helper)` (NOT `allow`)
- Receiving an encrypted handle that another contract granted you → check
  `require(FHE.isSenderAllowed(handle))` first
- Result is genuinely public (auction outcome after finality, vote tally) →
  `FHE.makePubliclyDecryptable(handle)` — irreversible, audit twice

Full decision tree + lateral-leak scenarios: `references/03-acl-decision-tree.md`

</acl_quickref>

<async_decryption_pattern>

Modern v0.11 pattern. Three pieces: **request**, **relayer signs off-chain**,
**callback verifies**.

```solidity
mapping(uint256 requestId => address requester) private _pendingDecrypt;
uint256 private _nextRequestId;

function requestRevealMyBalance() external {
    euint64 balance = _balances[msg.sender];
    require(FHE.isSenderAllowed(balance), "no access");
    FHE.makePubliclyDecryptable(balance);  // or allow(balance, address(this))
    uint256 id = ++_nextRequestId;
    _pendingDecrypt[id] = msg.sender;
    emit DecryptionRequested(id, FHE.toBytes32(balance));
}

function fulfillReveal(
    uint256 requestId,
    uint256[] calldata cleartexts,
    bytes calldata decryptionProof
) external {
    address requester = _pendingDecrypt[requestId];
    require(requester != address(0), "unknown id");
    delete _pendingDecrypt[requestId];   // ← REPLAY DEFENSE: delete BEFORE effects

    // FHE.checkSignatures takes (handles[], abi.encode(cleartexts), proof)
    bytes32[] memory handles = new bytes32[](1);
    handles[0] = _expectedHandle[requestId];
    FHE.checkSignatures(handles, abi.encode(cleartexts), decryptionProof);

    emit Revealed(requester, uint64(cleartexts[0]));
}
```

**Three classes of bug to avoid** (full discussion in `references/05-async-decryption.md`):

1. Skipping the `delete` — relayer can replay the callback, drain funds.
2. Using the ciphertext handle as the request ID — handles can collide / be reused.
3. Disclosing winner immediately on time-lock expiry — reorgs can flip outcome
   after losers decrypt. Add a finality delay (`+12 blocks` on Sepolia, `+64`
   on mainnet) between request and disclosure.

</async_decryption_pattern>

<input_proofs_pattern>

Frontend builds an encrypted input bound to **(contract address, user address)**.
Contract converts to internal handle via `FHE.fromExternal`.

```solidity
function deposit(externalEuint64 encAmount, bytes calldata inputProof) external {
    euint64 amount = FHE.fromExternal(encAmount, inputProof);
    _balances[msg.sender] = FHE.add(_balances[msg.sender], amount);
    FHE.allowThis(_balances[msg.sender]);
    FHE.allow(_balances[msg.sender], msg.sender);
}
```

```ts
// Frontend (React, @zama-fhe/react-sdk v3)
const enc = await encrypt.mutateAsync({
  values: [{ value: BigInt(amount), type: "euint64" }],
  contractAddress: token.address,
  userAddress: address, // binds proof to caller
});
await writeContractAsync({
  address: token.address,
  abi: token.abi,
  functionName: "deposit",
  args: [bytesToHex(enc.handles[0]!), bytesToHex(enc.inputProof)],
  gas: 15_000_000n,
});
```

**Third-party caller risk** (a relayer or contract submits Alice's encrypted
input on her behalf): `FHE.fromExternal` validates the proof but the binding
is to the encrypter's address, not `msg.sender`. If the contract trusts
`msg.sender = pledger`, an attacker can re-submit Alice's tuple. Mitigations
in `references/06-input-proofs.md`.

</input_proofs_pattern>

<testing_quickref>

**Foundry (PRIMARY)** — `forge-fhevm` provides `FhevmTest` base + helpers:

```solidity
import {FhevmTest} from "forge-fhevm/FhevmTest.sol";

contract MyTest is FhevmTest {
    address alice;
    function setUp() public override {
        super.setUp();              // boots cleartext FHEVM host
        alice = vm.addr(0xA11CE);
    }
    function test_deposit() public {
        (externalEuint64 enc, bytes memory proof) = encryptUint64(1000, alice, address(token));
        vm.prank(alice);
        token.deposit(enc, proof);
        bytes memory sig = signUserDecrypt(0xA11CE, address(token));
        uint256 plain = userDecrypt(euint64.unwrap(token.balanceOf(alice)), alice, address(token), sig);
        assertEq(plain, 1000);
    }
    function test_asyncReveal() public {
        vault.requestWithdraw();
        bytes32[] memory hs = new bytes32[](1); hs[0] = vault.pendingHandle();
        (uint256[] memory cleartexts, bytes memory proof) = publicDecrypt(hs);
        vault.fulfillWithdraw(vault.lastReqId(), cleartexts, proof);  // manual relayer
    }
}
```

forge-fhevm has **no `awaitDecryptionOracle`** (that's Hardhat-only) — drive
the callback manually via `publicDecrypt(handles[])`, which returns the
cleartexts AND the KMS-signed proof.

**Hardhat (SECONDARY)** — `@fhevm/hardhat-plugin` exposes:

```ts
const enc = await fhevm.createEncryptedInput(token.address, alice.address).add64(1000n).encrypt();
await token.connect(alice).deposit(enc.handles[0], enc.inputProof);
const plain = await fhevm.userDecryptEuint(handle, alice);
await fhevm.awaitDecryptionOracle(); // Hardhat auto-drives async callbacks
```

Full guide (mock vs local-node vs sepolia mode, silent-failure path tests):
`references/07-testing-frameworks.md`

</testing_quickref>

<frontend_quickref>

Stack: `@zama-fhe/react-sdk` v3 hooks + wagmi. Wrap your tree in
`ZamaProvider` with the relayer adapter (`RelayerCleartext` for local anvil,
`RelayerWeb` for Sepolia).

Key hooks:

```ts
const encrypt = useEncrypt(); // build externalEuintXX + proof
const decrypt = useUserDecrypt({ handles: [{ handle, contractAddress }] });
const { mutate: allow } = useAllow(); // EIP-712 keypair grant
const { data: isAllowed } = useIsAllowed({ contractAddresses: [c] }); // gates decrypt
```

Anti-patterns (full list in `references/08-relayer-sdk-frontend.md`):

- `createInstance` on every render (do it once at provider level).
- Persisting EIP-712 signature in `localStorage` (use in-memory cache).
- Putting decrypted plaintext in a URL / route param after decryption.

</frontend_quickref>

<top_anti_patterns>

The 10 most common AI failure modes (full 22-rule catalog in
`references/04-anti-patterns-catalog.md` — bundled linter rule IDs in brackets):

1. **[AP-001]** `if (FHE.gt(a, b)) { x = a; } else { x = b; }` → use
   `x = FHE.select(FHE.gt(a, b), a, b);`
2. **[AP-002]** `import "fhevm/lib/TFHE.sol";` (deprecated v0.7) →
   `import {FHE} from "@fhevm/solidity/lib/FHE.sol";`
3. **[AP-003]** `uint256 v = handle.decrypt();` (sync, removed) → request +
   callback flow (see `<async_decryption_pattern>`).
4. **[AP-004]** `_balance = FHE.add(_balance, x);` with no `FHE.allowThis(_balance)`.
5. **[AP-005]** `uint64(handle)` direct cast — handles are opaque, never castable.
6. **[AP-006]** Skipping `FHE.fromExternal` — using `externalEuintXX` directly in arithmetic.
7. **[AP-007]** `euint256 balance` for a token balance (4–6× HCU vs `euint64`).
8. **[AP-008]** `FHE.div(a, b)` where `b` is encrypted — only plaintext divisors.
9. **[AP-009]** `FHE.mul(amount, basisPoints)` with no overflow guard.
10. **[AP-010]** Async callback that doesn't `delete _pending[id]` before effects.
11. **[AP-023]** `FHE.makePubliclyDecryptable(handle)` where `handle` was never
    assigned — the zero handle `bytes32(0)` is a sentinel; KMS ignores it,
    callback never fires, contract locks. Guard with `FHE.isInitialized` or
    seed the slot in the constructor.

The remaining 12 cover: returning encrypted from `view` fns, persistent allow
to helpers, hashing `(value, proof)` for replay defense, `createInstance`
per render, EIP-712 sig in localStorage, plaintext in URL post-decrypt,
ciphertext handle as request ID, silent failure on auction bid (OZ Fabry),
disclosing winner without finality delay, AA transient-storage leak,
3rd-party-caller external-encryption replay, arbitrary `execute(target,data)`
allowing ACL grant via untrusted target.

</top_anti_patterns>

<reference_index>

- `references/01-types-cheatsheet.md` — every encrypted type, when to use, when NOT to
- `references/02-operations-table.md` — full FHE op table + HCU costs by bit-width
- `references/03-acl-decision-tree.md` — `allow` / `allowThis` / `allowTransient` / `makePubliclyDecryptable`
- `references/04-anti-patterns-catalog.md` — all 22 anti-patterns with bad/good code
- `references/05-async-decryption.md` — request→sign→callback pattern, replay defense, finality delay
- `references/06-input-proofs.md` — `externalEuintXX` + `inputProof`, frontend binding, 3rd-party risk
- `references/07-testing-frameworks.md` — Foundry/forge-fhevm primary, Hardhat secondary
- `references/08-relayer-sdk-frontend.md` — `@zama-fhe/sdk` + `react-sdk` v3 hooks
- `references/09-security-checklist.md` — OpenZeppelin Fabry security checklist, internalized
- `references/10-recipes/` — 6 production-grade recipes:
  - `confidential-erc7984-token.md`
  - `sealed-bid-auction.md`
  - `confidential-vote.md`
  - `encrypted-oracle.md`
  - `confidential-dca-engine.md`
  - `confidential-group-buy.md` ← used in the demo

Bundled tools: `tools/fhe-lint.mjs` (AST linter, 22 rules), `tools/fhe-doctor.mjs`
(auto-fix, 8 rules), `tools/fhe-eval.mjs` (14-prompt eval suite),
`mcp-server/` (MCP tools: `lookup_fhe_op`, `validate_snippet`, `suggest_fix`,
`compile_test`).

</reference_index>
