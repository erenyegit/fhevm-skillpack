# Recipe — Confidential DCA engine (private dollar-cost averaging)

**Goal:** A user deposits encrypted USDC, sets an encrypted per-tick
amount, and a keeper executes swaps over time. Neither the per-tick
amount nor the total notional is observable on-chain.

## Key FHE primitives
- `euint64` deposit balance + `euint64` tick size
- `FHE.select` to gate the per-tick swap on sufficient balance
- `FHE.allowTransient` on the swap-amount handle to the DEX adapter
- Keeper triggers ticks; user only sees aggregate

## Contract sketch

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

interface IConfidentialDexAdapter {
    function swapExactCUSDForCETH(euint64 amountIn) external returns (euint64 amountOut);
}

contract ConfidentialDCA is ZamaEthereumConfig {
    IConfidentialDexAdapter public immutable dex;
    address public immutable owner;
    address public keeper;

    euint64 private _cusdBalance;
    euint64 private _cethBalance;
    euint64 private _tickSize;
    uint256 public lastTick;
    uint256 public constant TICK_INTERVAL = 1 days;

    constructor(IConfidentialDexAdapter _dex, address _keeper) {
        owner = msg.sender; dex = _dex; keeper = _keeper;
    }

    function configure(externalEuint64 encDeposit, externalEuint64 encTick, bytes calldata proof) external {
        require(msg.sender == owner, "only owner");
        euint64 deposit = FHE.fromExternal(encDeposit, proof);
        euint64 tick    = FHE.fromExternal(encTick, proof);
        _cusdBalance = FHE.add(_cusdBalance, deposit);
        _tickSize    = tick;
        FHE.allowThis(_cusdBalance);
        FHE.allowThis(_tickSize);
        FHE.allow(_cusdBalance, owner);
        FHE.allow(_tickSize, owner);
    }

    function tick() external {
        require(msg.sender == keeper, "only keeper");
        require(block.timestamp >= lastTick + TICK_INTERVAL, "too soon");
        lastTick = block.timestamp;

        ebool sufficient = FHE.ge(_cusdBalance, _tickSize);
        euint64 amountIn = FHE.select(sufficient, _tickSize, FHE.asEuint64(0));

        FHE.allowTransient(amountIn, address(dex));      // tx-scope only
        euint64 amountOut = dex.swapExactCUSDForCETH(amountIn);

        _cusdBalance = FHE.sub(_cusdBalance, amountIn);
        _cethBalance = FHE.add(_cethBalance, amountOut);
        FHE.allowThis(_cusdBalance);
        FHE.allowThis(_cethBalance);
        FHE.allow(_cusdBalance, owner);
        FHE.allow(_cethBalance, owner);
    }
}
```

## Common pitfalls
- **Keeper learns the tick size** if the contract reveals when balance hits
  zero. Mitigation: keep ticking with a 0 amount via `select` — pattern
  remains constant regardless of remaining funds.
- **Persistent allow to DEX** (AP-012). Use `allowTransient`.
- **Overflow on `add(_cethBalance, amountOut)`** if running for years.
  Apply AP-009 cap.
