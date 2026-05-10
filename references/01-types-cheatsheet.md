# 01 — Encrypted types cheatsheet

## Contents
- Type table with selection rules
- HCU cost intuition by width
- `externalEuintXX` lifecycle
- Anti-patterns

## Type table

| Type | Bit-width | Primary use | Avoid for |
|---|---|---|---|
| `ebool` | 1 | Comparison results, branching gates fed to `FHE.select` | Storing bit flags in tight bitmaps — use `euint8` |
| `euint8` | 8 | Small enums, percentages 0–100, single-byte flags | Token balances (will overflow) |
| `euint16` | 16 | Counters, vote tallies (<65k voters), small ID spaces | Money amounts |
| `euint32` | 32 | Sub-billion counters, the stock `FHECounter.sol` example, simple voting | Token amounts unless 32-bit truncation is acceptable |
| `euint64` | 64 | **Default for token balances, money amounts** (matches ERC-7984 spec) | Bitmap fields |
| `euint128` | 128 | BPS math intermediates (`amount × 10_000`), large monetary aggregates | Anywhere `euint64` fits — 2× HCU |
| `euint256` | 256 | Cryptographic-grade values only (e.g., commitments) | **Anything else — 4–6× HCU cost vs euint64** |
| `eaddress` (alias of `euint160`) | 160 | Encrypted addresses (sealed-bid winner, blind beneficiary) | When the address is public anyway |

`externalEuintXX` (e.g., `externalEuint64`) is the **wire-format** type for
inputs flowing from frontend to contract. It is NOT operable — convert
immediately:

```solidity
function f(externalEuint64 enc, bytes calldata proof) external {
    euint64 amount = FHE.fromExternal(enc, proof);  // ← always first line
    // ... now use `amount`
}
```

## Bit-width selection rule

> Pick the smallest type whose plaintext range covers your domain. HCU scales
> superlinearly: `euint256` `select` is roughly 2× the cost of `euint64`,
> `mul` is 5×+. ERC-7984 uses `euint64` for balances precisely because
> 18 446 744 trillion (max uint64) is enough for any realistic token.

For a token with 6 decimals and a 100M total supply: `100_000_000 × 10^6 =
10^14`, well under `2^64 ≈ 1.8×10^19`. `euint64` is correct.

For BPS-multiplied math (`amount × 10_000 / 10_000`):
- Use `euint128` for the intermediate after multiplication, then narrow back
  to `euint64` after the division (cast via `FHE.asEuint64`).

## `eaddress` notes

`eaddress` is `euint160` under the hood. Comparison cost is between `euint128`
and `euint256`. Use for:
- Sealed-bid auction winners (revealed only at the end via `makePubliclyDecryptable`)
- Confidential withdrawal beneficiary
- Blind voting delegate

Do not use for `msg.sender` checks — `msg.sender` is plaintext and ACL is
keyed on plaintext addresses.

## Anti-patterns

- **AP-007: `euint256` for balances.** 4–6× the cost. Linter flags any `euint256`
  storage variable named `balance`, `amount`, `total`, `supply`. Fix: change
  to `euint64`.
- **`euint8` for token balances.** Underflows or wraps on the first non-trivial
  transfer. Will pass tests with tiny amounts and fail in production. Linter
  warns when `euint8` is used in a function named `transfer`/`mint`/`deposit`.
- **`ebool[]` arrays.** Dynamic arrays of encrypted booleans are extremely
  expensive to read. Pack into `euint64` bitmaps where possible (then `FHE.and`
  / `FHE.shr` to extract a bit).
- **Storing `externalEuintXX` directly.** Always convert via `FHE.fromExternal`
  on entry; never put the external wire type in storage.

## Casts

```solidity
// Plaintext → encrypted (cheap, 32 HCU)
euint64 a = FHE.asEuint64(uint64(42));

// External → internal (validates proof, expensive)
euint64 b = FHE.fromExternal(extInput, proof);

// Narrow / widen (cheap, 32 HCU)
euint128 wide = FHE.asEuint128(b);
euint64 narrow = FHE.asEuint64(wide);   // truncates high bits silently
```

Cast cost is 32 HCU regardless of direction; the expensive thing is the
underlying ciphertext operation, not the cast itself.
