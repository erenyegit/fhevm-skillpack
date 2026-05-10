# Recipe — Encrypted oracle (private price feed)

**Goal:** A trusted oracle posts an encrypted price. Subscribers (paid)
can decrypt; non-subscribers see only the handle.

## Key FHE primitives
- `euint64` price storage
- Per-subscriber `FHE.allow(price, subscriber)`
- Oracle-only writer

## Contract
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract EncryptedOracle is ZamaEthereumConfig {
    address public immutable oracle;
    uint256 public price = 0;            // public: TIMESTAMP of last update
    euint64 private _encPrice;
    mapping(address => uint256) public subscriptionExpiry;
    uint256 public constant MONTH = 30 days;
    uint256 public constant FEE  = 0.01 ether;

    constructor(address _o) { oracle = _o; }

    function publish(externalEuint64 encNew, bytes calldata proof) external {
        require(msg.sender == oracle, "only oracle");
        _encPrice = FHE.fromExternal(encNew, proof);
        price = block.timestamp;
        FHE.allowThis(_encPrice);
        // Re-grant existing subs
        // (in production: maintain enumerable set; for brevity omitted)
    }

    function subscribe() external payable {
        require(msg.value >= FEE, "fee");
        uint256 newExpiry = (subscriptionExpiry[msg.sender] > block.timestamp
            ? subscriptionExpiry[msg.sender] : block.timestamp) + MONTH;
        subscriptionExpiry[msg.sender] = newExpiry;
        FHE.allow(_encPrice, msg.sender);   // persistent until next rotation
    }

    function getPrice() external view returns (euint64) {
        require(subscriptionExpiry[msg.sender] >= block.timestamp, "not subscribed");
        return _encPrice;
    }
}
```

## Test
```solidity
function test_subscriberCanDecrypt_nonsubscriberCannot() public {
    vm.prank(oracle); oracle_.publish(...);
    vm.prank(alice); oracle_.subscribe{value: 0.01 ether}();
    // alice decrypt OK; bob decrypt revert
}
```

## Common pitfalls
- **Persistent ACL grant to subscribers.** Cleanup is hard — when their
  subscription lapses they can still decrypt the version they were granted.
  Mitigation: rotate `_encPrice` on every publish (cipher-text changes,
  old grants become useless).
- **`view` returning encrypted handle without prior allow:** use
  non-`view` `requestAccess` to grant fresh ACL on each subscription tick.
- **Plaintext price in `price` variable:** here `price` is the timestamp;
  if used as the plaintext value the contract would defeat its own purpose.
