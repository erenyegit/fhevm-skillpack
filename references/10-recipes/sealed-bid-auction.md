# Recipe — Sealed-bid auction

**Goal:** Multiple bidders submit encrypted bids in a payment token (e.g.
the cUSD recipe). At auction end, the highest bid wins; only the winner's
identity and bid amount are revealed.

## Key FHE primitives
- `euint64` bids, `eaddress` winner
- `FHE.gt` + `FHE.select` to update winner / max
- `FHE.makePubliclyDecryptable` with **two-step finality delay** (AP-019)
- Effective-transferred-amount check (AP-018)

## Contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, eaddress, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

interface IConfidentialToken {
    function confidentialTransferFrom(address from, address to, externalEuint64 enc, bytes calldata proof)
        external returns (euint64 transferred);
}

contract SealedBidAuction is ZamaEthereumConfig {
    IConfidentialToken public immutable token;
    uint256 public immutable endTime;
    uint256 private _scheduledBlock;
    uint256 private constant FINALITY_BLOCKS = 12;

    euint64  private _highestBid;
    eaddress private _highestBidder;

    constructor(IConfidentialToken _t, uint256 _end) { token = _t; endTime = _end; }

    function bid(externalEuint64 encAmount, bytes calldata proof) external {
        require(block.timestamp < endTime, "ended");
        euint64 effective = token.confidentialTransferFrom(msg.sender, address(this), encAmount, proof);

        ebool actuallyTransferred = FHE.gt(effective, FHE.asEuint64(0));
        ebool isHigher = FHE.gt(effective, _highestBid);
        ebool isBest   = FHE.and(actuallyTransferred, isHigher);

        _highestBid    = FHE.select(isBest, effective, _highestBid);
        _highestBidder = FHE.select(isBest, FHE.asEaddress(msg.sender), _highestBidder);

        FHE.allowThis(_highestBid);
        FHE.allowThis(_highestBidder);
    }

    function scheduleReveal() external {
        require(block.timestamp >= endTime, "ongoing");
        require(_scheduledBlock == 0, "scheduled");
        _scheduledBlock = block.number;
    }

    function reveal() external {
        require(_scheduledBlock != 0, "not scheduled");
        require(block.number >= _scheduledBlock + FINALITY_BLOCKS, "wait finality");
        FHE.makePubliclyDecryptable(_highestBid);
        FHE.makePubliclyDecryptable(_highestBidder);
    }

    function getWinner() external view returns (eaddress, euint64) {
        return (_highestBidder, _highestBid);
    }
}
```

## Test snippets

```solidity
function test_silentlyFailedBidDoesNotWin() public {
    // Bob has 100 cUSD, bids 1000 — transfer fails silently
    (externalEuint64 enc, bytes memory p) = encryptUint64(1000, bob, address(auction));
    vm.prank(bob); auction.bid(enc, p);

    // Alice has 200, bids 200
    (externalEuint64 enc2, bytes memory p2) = encryptUint64(200, alice, address(auction));
    vm.prank(alice); auction.bid(enc2, p2);

    vm.warp(endTime + 1); auction.scheduleReveal();
    vm.roll(block.number + 12); auction.reveal();

    uint256 bid = publicDecrypt(euint64.unwrap(auction.getHighestBid()));
    assertEq(bid, 200, "alice wins, not bob");
}
```

## Common pitfalls
- **AP-018:** `bid` ignored the silent failure → bob with 0 balance "wins"
  by claiming 1000.
- **AP-019:** revealing immediately on `block.timestamp >= endTime` lets a
  losing bidder decrypt before reorg, learn the winning amount, then
  re-bid in the canonical chain.
- **AP-009:** if you allow plaintext bid increments multiplied by encrypted
  amounts, guard the `mul`.
