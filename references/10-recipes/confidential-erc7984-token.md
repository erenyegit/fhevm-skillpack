# Recipe — Confidential ERC-7984 token

**Goal:** A confidential ERC-20-shaped token where balances and transfer
amounts are encrypted with `euint64`. Compatible with the Zama-led
ERC-7984 confidential-token spec and OpenZeppelin's
`@openzeppelin/confidential-contracts` library.

## Key FHE primitives
- `euint64` for balance, `externalEuint64` for transfer amount inputs
- `FHE.fromExternal` on every input
- `FHE.allowThis` on every storage write, `FHE.allow` to per-user balance
- `FHE.select` to gate transfer on sufficient balance

## Contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract Confidential7984 is ZamaEthereumConfig {
    string  public name     = "Confidential USD";
    string  public symbol   = "cUSD";
    uint8   public decimals = 6;

    mapping(address => euint64) private _balances;

    event ConfidentialTransfer(address indexed from, address indexed to, bytes32 amountHandle);

    function mint(address to, externalEuint64 encAmount, bytes calldata proof) external {
        euint64 amount = FHE.fromExternal(encAmount, proof);
        _balances[to] = FHE.add(_balances[to], amount);
        FHE.allowThis(_balances[to]);
        FHE.allow(_balances[to], to);
        emit ConfidentialTransfer(address(0), to, euint64.unwrap(amount));
    }

    function balanceOf(address a) external view returns (euint64) {
        return _balances[a];
    }

    function confidentialTransfer(
        address to,
        externalEuint64 encAmount,
        bytes calldata proof
    ) external returns (euint64 transferred) {
        euint64 amount = FHE.fromExternal(encAmount, proof);
        euint64 fromBal = _balances[msg.sender];
        ebool sufficient = FHE.ge(fromBal, amount);
        // Transfer amount = amount if sufficient, else 0  (silent failure)
        transferred = FHE.select(sufficient, amount, FHE.asEuint64(0));
        _balances[msg.sender] = FHE.sub(fromBal, transferred);
        _balances[to]         = FHE.add(_balances[to], transferred);

        FHE.allowThis(_balances[msg.sender]);
        FHE.allow(_balances[msg.sender], msg.sender);
        FHE.allowThis(_balances[to]);
        FHE.allow(_balances[to], to);
        FHE.allowTransient(transferred, msg.sender);  // caller may inspect

        emit ConfidentialTransfer(msg.sender, to, euint64.unwrap(transferred));
    }
}
```

## Test (Foundry)

```solidity
function test_transferRespectsBalance() public {
    (externalEuint64 enc100, bytes memory p1) = encryptUint64(100, alice, address(token));
    vm.prank(alice); token.mint(alice, enc100, p1);

    (externalEuint64 enc500, bytes memory p2) = encryptUint64(500, alice, address(token));
    vm.prank(alice); token.confidentialTransfer(bob, enc500, p2);    // silent fail

    bytes memory sig = signUserDecrypt(BOB_PK, address(token));
    uint256 bobBal = userDecrypt(euint64.unwrap(token.balanceOf(bob)), bob, address(token), sig);
    assertEq(bobBal, 0);  // silent-failure path: bob got 0
}
```

## Frontend snippet

```tsx
const enc = await encrypt({
  values: [{ value: amount, type: "euint64" }],
  contractAddress: token.address, userAddress: address,
});
await writeContractAsync({
  address: token.address, abi: token.abi,
  functionName: "confidentialTransfer",
  args: [recipient, bytesToHex(enc.handles[0]!), bytesToHex(enc.inputProof)],
  gas: 15_000_000n,
});
```

## Common pitfalls
- **AP-018 — silent failure ignored.** Callers (e.g., auctions) must read
  the returned `transferred` handle and base their state on it, not on
  `amount`. Otherwise a bidder with 0 balance can "bid" billions.
- **AP-007 — `euint256` for balances.** Always `euint64`.
- **AP-004 — missing `allowThis` on the recipient's new balance.** Catches
  many "transfer worked once then breaks" bugs.
- Don't use `FHE.makePubliclyDecryptable` on `_balances`. Even a one-off
  reveal makes the value public to the entire chain forever.
