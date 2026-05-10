# 02 — FHE operations table + HCU costs

## Contents
- Tx-level HCU limits
- Operation table by category
- Per-width HCU cost matrix
- Cost-aware patterns

## Tx-level limits

- **Global complexity limit per tx:** 20 000 000 HCU
- **Sequential depth limit per tx:** 5 000 000 HCU

A reveal-balance flow on a `euint64` mapping uses ≈300k HCU. A confidential
swap (compare + select + two transfers) lands around 1–2M. Sealed-bid
auctions with a loop over N bids hit the depth limit fastest — design with
that in mind.

## Operation reference

### Arithmetic — UNCHECKED, wraps on overflow

| Op | Signature | Returns | Notes |
|---|---|---|---|
| `FHE.add` | `(euintX, euintX | uintX)` | `euintX` | Scalar overload accepts plaintext rhs |
| `FHE.sub` | `(euintX, euintX | uintX)` | `euintX` | Wraps to large positive on underflow |
| `FHE.mul` | `(euintX, euintX | uintX)` | `euintX` | Largest cost in arithmetic |
| `FHE.div` | `(euintX, uintX)` | `euintX` | **Plaintext divisor only** |
| `FHE.rem` | `(euintX, uintX)` | `euintX` | **Plaintext divisor only** |
| `FHE.neg` | `(euintX)` | `euintX` | Two's-complement negate |
| `FHE.min` | `(euintX, euintX)` | `euintX` | Encrypted-encrypted only |
| `FHE.max` | `(euintX, euintX)` | `euintX` | Encrypted-encrypted only |

### Bitwise

| Op | Signature | Returns |
|---|---|---|
| `FHE.and`, `FHE.or`, `FHE.xor` | `(euintX, euintX)` | `euintX` |
| `FHE.not` | `(euintX)` | `euintX` |
| `FHE.shr`, `FHE.shl` | `(euintX, uint8 | euint8)` | `euintX` — shift is mod bit-width |
| `FHE.rotr`, `FHE.rotl` | `(euintX, euintX)` | `euintX` |

### Comparison → `ebool`

| Op | Meaning |
|---|---|
| `FHE.eq` / `FHE.ne` | Equal / not equal |
| `FHE.lt` / `FHE.le` | Less than / less-or-equal |
| `FHE.gt` / `FHE.ge` | Greater than / greater-or-equal |

All comparison ops are commutative on cost across pair widths.

### Conditional

```solidity
FHE.select(ebool cond, euintX a, euintX b) → euintX
// cond ? a : b   — both branches are evaluated, no Solidity branching
```

### Casts & randomness

```solidity
FHE.asEuintXX(plaintext)
FHE.asEuintXX(externalEuintXX, proof)   // legacy; prefer FHE.fromExternal
FHE.fromExternal(externalEuintXX, proof)
FHE.randEuintXX()
FHE.randBounded(upperBoundPlaintext)
```

## HCU cost matrix (per op, rounded)

Numbers from the Zama HCU table. Format `non-scalar | scalar`.
"Scalar" means one operand is plaintext.

|         | euint8         | euint16        | euint32         | euint64           | euint128          | euint256        |
|---------|----------------|----------------|-----------------|-------------------|-------------------|-----------------|
| add/sub | 91k / 84k      | 93k / 93k      | 125k / 95k      | 162k / 133k       | 260k / 172k       | —               |
| mul     | 150k / 122k    | 222k / 193k    | 328k / 265k     | 596k / 365k       | 1.69M / 696k      | —               |
| div     | 210k           | 302k           | 438k            | 715k              | 1.23M             | —               |
| rem     | 440k           | 580k           | 792k            | 1.15M             | 1.94M             | —               |
| eq/ne   | 55k            | 84k / 55k      | 85k / 82k       | 120k / 83k        | 122k / 117k       | 152k / 117k     |
| lt/gt   | 63k / 52k      | 84k / 55k      | 118k / 83k      | 152k / 116k       | 218k / 149k       | —               |
| min/max | 121k / 84k     | 146k / 88k     | 182k / 117k     | 219k / 149k       | 290k / 180k       | —               |
| and/or  | 31k / 30k      | 31k / 30k      | 32k             | 34k               | 37k               | 38k             |
| xor     | 31k / 30k      | 31k / 30k      | 32k             | 34k               | 37k               | 39k             |
| not     | 9              | 16             | 32              | 63                | 130               | 130             |
| select  | 55k            | 55k            | 55k             | 55k               | 57k               | 108k            |
| neg     | 79k            | 93k            | 131k            | 131k              | 168k              | 269k            |
| rand    | 23k            | 23k            | 24k             | 24k               | 25k               | 30k             |
| shifts  | 31k–93k        | 31k–125k       | 32k–163k        | 34k–209k          | 37k–283k          | 38k–378k        |

Boolean ops on `ebool`: `and` 25k / `or` 24k / `xor` 22k / `not` 2 / `select` 55k.
Cast: 32 HCU. Trivial encrypt: 32 HCU.

## Cost-aware patterns

### Prefer scalar overloads
```solidity
// 365k HCU
euint64 fee = FHE.mul(amount, FHE.asEuint64(FEE_BPS));
// 596k HCU — wasteful
euint64 fee = FHE.mul(amount, _bpsHandle);
```

### Hoist invariants outside loops
A sealed-bid auction comparing N bids will hit the 5M depth limit at
N ≈ 20 with `euint64` `gt` + `select` per bid (≈200k each). Above that:
batch with off-chain merkle aggregation or split across multiple txs.

### `euint64` over `euint128`
Halves the cost for arithmetic. Only widen for the intermediate of a
`mul` that could exceed `2^64`.

### `select` is cheap
`select` is dramatically cheaper than computing both branches and
combining via `and`/`or`. Always prefer `select` for choice.

### Avoid `FHE.div` / `FHE.rem` where possible
Even with plaintext divisor, `div` is 4–8× the cost of `mul`. If the
divisor is a known power of two, use `FHE.shr` instead.

## Anti-pattern checks

- `FHE.div(euint, euint)` — second arg must be plaintext (linter AP-008).
- `FHE.mul(big, big)` without preceding overflow guard — flagged AP-009.
- Repeated `FHE.eq(_, FHE.asEuint64(0))` patterns — extract once.
