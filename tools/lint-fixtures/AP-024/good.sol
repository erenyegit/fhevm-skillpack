// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64, ebool, eaddress, externalEaddress, externalEuint8, euint8, euint32, euint128, euint256} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
contract Fixture is ZamaEthereumConfig {
    euint64 private _total;
    uint256 public scheduledRevealBlock;
    function pledge(externalEuint64 enc, bytes calldata proof) external {
        require(scheduledRevealBlock == 0, "scheduled");
        euint64 a = FHE.fromExternal(enc, proof);
        _total = FHE.add(_total, a);
        FHE.allowThis(_total);
    }
    function scheduleReveal() external { scheduledRevealBlock = block.number; }
    function reveal() external {
        require(block.number >= scheduledRevealBlock + 12);
        FHE.makePubliclyDecryptable(_total);
    }
}
