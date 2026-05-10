# 07 — Testing frameworks (Foundry primary, Hardhat secondary)

## Contents
- Foundry / forge-fhevm setup
- Foundry test helpers
- Encrypted-input creation in Foundry
- User decryption in Foundry
- Async decryption in Foundry (mock vs sepolia fork)
- Silent-failure path test (OZ Fabry)
- Hardhat / `@fhevm/hardhat-plugin` (secondary)

---

## Foundry / forge-fhevm (PRIMARY)

`forge-fhevm` is the Foundry plugin for FHEVM. It boots a **cleartext FHEVM
host** in `setUp()` that mirrors every encrypted operation against an
on-chain plaintext mapping. This means tests run at full Foundry speed
without spinning up a relayer.

### Installation (already in the template)

```
[dependencies]
forge-fhevm = { version = "eba2324", git = "https://github.com/zama-ai/forge-fhevm.git", rev = "eba2324" }
"@fhevm-solidity" = "0.11.1"
"@encrypted-types" = "0.0.4"
```

```
@fhevm/solidity/=dependencies/@fhevm-solidity-0.11.1/
forge-fhevm/=dependencies/forge-fhevm-eba2324/src/
encrypted-types/=dependencies/@encrypted-types-0.0.4/
```

Run `pnpm contracts:install` then `pnpm contracts:test`.

### Minimal test skeleton

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FhevmTest} from "forge-fhevm/FhevmTest.sol";
import {euint64, externalEuint64} from "encrypted-types/EncryptedTypes.sol";
import {MyToken} from "../src/MyToken.sol";

contract MyTokenTest is FhevmTest {
    MyToken token;
    address alice;
    uint256 internal constant ALICE_PK = 0xA11CE;

    function setUp() public override {
        super.setUp();             // boots cleartext FHEVM host
        token = new MyToken();
        alice = vm.addr(ALICE_PK);
    }

    function test_deposit() public {
        // 1. Encrypt input (helper from FhevmTest)
        (externalEuint64 enc, bytes memory proof) =
            encryptUint64(1000, alice, address(token));

        // 2. Call under prank
        vm.prank(alice);
        token.deposit(enc, proof);

        // 3. Decrypt via user-decrypt flow
        bytes memory sig = signUserDecrypt(ALICE_PK, address(token));
        uint256 plain = userDecrypt(
            euint64.unwrap(token.balanceOf(alice)),
            alice, address(token), sig
        );
        assertEq(plain, 1000);
    }
}
```

### Helper API (inherited from `FhevmTest`)

| Helper | Purpose |
|---|---|
| `encryptUintXX(value, encrypter, contract)` → `(externalEuintXX, bytes)` | Build encrypted input |
| `encryptAddress(addr, encrypter, contract)` | Encrypted-address input |
| `encryptBool(bool, encrypter, contract)` | Encrypted-bool input |
| `signUserDecrypt(privateKey, contract)` → `bytes` | EIP-712 signature for user decryption |
| `userDecrypt(handleBytes32, user, contract, sig)` → `uint256` | Decrypt handle on user's behalf |
| `publicDecrypt(handleBytes32)` → `uint256` | Decrypt a `makePubliclyDecryptable` handle |
| `awaitDecryptionOracle()` | Drive a pending async-decryption callback to completion |

### Async-decryption test pattern

```solidity
function test_asyncReveal() public {
    vm.prank(alice);
    vault.requestWithdraw();             // emits WithdrawRequested

    awaitDecryptionOracle();             // simulates KMS quorum + callback

    // assert effects
    assertEq(alice.balance, expected);
}
```

`awaitDecryptionOracle()` finds pending decryption requests recorded by the
forge-fhevm host, fetches their cleartext from the plaintext mirror, and
calls the contract's callback function with the right signature shape.

### Silent-failure path test (OZ Fabry — AP-018)

```solidity
function test_bidWithInsufficientBalance_doesNotAdvanceWinner() public {
    // Alice has 50 cWETH, tries to bid 1000
    (externalEuint64 enc, bytes memory proof) =
        encryptUint64(1000, alice, address(auction));

    vm.prank(alice);
    auction.bid(enc, proof);

    // Auction must not have advanced the highest bid (transfer of 1000 failed
    // silently and returned 0).
    bytes memory sig = signUserDecrypt(KMS_PK, address(auction));
    uint256 highest = userDecrypt(
        euint64.unwrap(auction.getHighestBid()),
        kmsAddress, address(auction), sig
    );
    assertEq(highest, 0, "silent transfer fail must not crown alice");
}
```

### Fork testing against Sepolia

```toml
[rpc_endpoints]
sepolia = "${SEPOLIA_RPC_URL}"
```

```bash
forge test --fork-url sepolia --match-test test_realRelayer -vvv
```

In fork mode the real FHEVM host on Sepolia is used; encryption + decryption
hit the live relayer. Slower; use sparingly for confidence checks.

---

## Hardhat / `@fhevm/hardhat-plugin` (SECONDARY)

If a project uses Hardhat instead of Foundry, the equivalent API is:

```ts
import { fhevm } from "hardhat";

const input = fhevm.createEncryptedInput(token.address, alice.address);
input.add64(1000n);
const enc = await input.encrypt();
await token.connect(alice).deposit(enc.handles[0], enc.inputProof);

const plain = await fhevm.userDecryptEuint(64, handle, alice);
// async flows:
await fhevm.awaitDecryptionOracle();
```

Three modes:
- `network: mock` — cleartext mock, fastest.
- `network: localhost` — local node with mock host, useful for frontend tests.
- `network: sepolia` — real relayer, real KMS, slowest.

Hardhat config snippet:
```ts
// hardhat.config.ts
import "@fhevm/hardhat-plugin";
export default { solidity: "0.8.27" };
```

The same `@fhevm/solidity` library is used under both stacks; only the
JS-side test helpers differ.
