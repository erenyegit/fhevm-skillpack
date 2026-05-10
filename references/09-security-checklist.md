# 09 — Security checklist (OpenZeppelin Fabry guide, internalized)

This list is the audit checklist applied before any FHEVM contract ships.
Each rule maps to one or more anti-patterns in
`references/04-anti-patterns-catalog.md`. The linter (`pnpm lint:fhe`)
mechanically checks the items marked **[L]**.

## Contents
1. Arithmetic safety
2. Authorization on every input
3. Persistent ACL grants minimized
4. Async callback replay defense
5. Silent-failure detection
6. Reveal with finality delay
7. AA transient cleanup
8. Third-party caller binding
9. Arbitrary external calls forbidden
10. Delegatecall audited
11. Decryption only when needed
12. No plaintext leaks in events/URLs

---

## 1. Arithmetic safety **[L: AP-009]**
Every `FHE.mul`, `FHE.sub`, multi-step BPS calc has an explicit
overflow/underflow guard via `FHE.gt/lt` + `FHE.select`. Fee numerators
have a `MAX_SAFE_AMOUNT = type(uintW).max / FEE_BPS` cap.

## 2. Authorization on every input **[L: AP-006, partial AP-021]**
Every external function that consumes an `externalEuintXX` calls
`FHE.fromExternal` first. Every function that consumes an internal handle
from `msg.sender` does `require(FHE.isSenderAllowed(handle))`.

## 3. Persistent ACL grants minimized **[L: AP-012]**
`FHE.allow` is reserved for return-to-caller and contract-self. Helper
contracts get `FHE.allowTransient`. Audit each persistent grant: can the
grantee leak laterally?

## 4. Async callback replay defense **[L: AP-010, AP-017]**
- Callback function first reads the request record, then `delete`s it,
  then calls `FHE.checkSignatures`, then external effects.
- Request IDs are monotonic counters, never ciphertext handle bytes.

## 5. Silent-failure detection **[L: AP-018]**
Functions that depend on the *effective* outcome of an encrypted transfer
(e.g., auction bids) read the actual transferred amount returned by the
token contract and base their state updates on it — not on the
caller-requested amount.

## 6. Reveal with finality delay **[L: AP-019]**
Any `FHE.makePubliclyDecryptable` triggered by external action goes
through a two-step ritual: `scheduleReveal()` saves a block number;
`reveal()` requires `block.number >= scheduled + FINALITY_BLOCKS`.

Sepolia `FINALITY_BLOCKS = 12`; mainnet `64`.

## 7. AA transient cleanup **[L: AP-020]**
ERC-4337 wallets and bundlers call `FHE.cleanTransientStorage()` at the
end of every user operation handler. EOA contracts that don't expect AA
context can skip.

## 8. Third-party caller binding **[L: AP-021]**
If the contract's logic depends on `msg.sender = encrypter`, the encrypted
input is bound to caller via one of:
- Frontend also encrypts `msg.sender` as an `eaddress`, contract compares
  via `FHE.eq` and `FHE.select`-gates the state change.
- Per-user EOA signature over `(amount, nonce, contractAddr)`, validated
  via `ecrecover`.
- Single-shot proof consumption via `mapping(bytes32 proofHash => bool)`.

## 9. Arbitrary external calls forbidden **[L: AP-022]**
No `execute(address, bytes)` / `multicall(bytes[])` allowed in
confidential contracts. If genuinely needed, whitelist targets and
selectors.

## 10. Delegatecall audited
Any `delegatecall` from a confidential contract is audited line-by-line.
Caller storage is shared; a malicious implementation can grant ACL.

## 11. Decryption only when needed
- `FHE.makePubliclyDecryptable` is irreversible — confirm the value is
  genuinely public.
- Prefer `FHE.allow(handle, specificUser)` if only one user should learn it.

## 12. No plaintext leaks
- Don't emit decrypted plaintext in events.
- Don't return decrypted values from public functions if the same value
  could leak via balance side-channels.
- Frontend: no plaintext in URL/query params, no plaintext in localStorage.

---

## Bonus: HCU budgeting

Run `forge test --gas-report` and confirm no single function exceeds
~12M gas (margin below Sepolia block limit). For HCU-heavy flows,
estimate ahead of time using the cost matrix in
`references/02-operations-table.md`.

## Pre-deploy sweep

```bash
pnpm lint:fhe                  # AST linter, 22 rules
pnpm fix:fhe -- --dry          # auto-fix preview
pnpm contracts:test            # forge test -vv
pnpm contracts:test --gas-report
forge test --fork-url sepolia --match-test test_realRelayer  # optional
```

A clean lint + green tests + a gas-budget sanity check is the minimum bar
before requesting external audit.
