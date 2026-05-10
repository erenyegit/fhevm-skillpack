// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64, ebool, eaddress, externalEaddress, externalEuint8, euint8, euint32, euint128, euint256} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
contract Fixture is ZamaEthereumConfig {
    uint256 public constant END = 1000;
    uint256 _scheduled;
    uint256 constant FINALITY = 12;
    euint64 _bid;
    function scheduleReveal() external { require(block.timestamp > END); _scheduled = block.number; }
    function reveal() external {
        require(block.number >= _scheduled + FINALITY, "wait");
        FHE.makePubliclyDecryptable(_bid);
    }
}
