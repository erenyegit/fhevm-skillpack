// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64, ebool, eaddress, externalEaddress, externalEuint8, euint8, euint32, euint128, euint256} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
contract Fixture is ZamaEthereumConfig {
    uint64 constant MAX = type(uint64).max / 10000;
    function good(euint64 a) external pure returns (euint64) {
        ebool tooBig = FHE.gt(a, FHE.asEuint64(MAX));
        euint64 capped = FHE.select(tooBig, FHE.asEuint64(MAX), a);
        return FHE.mul(capped, FHE.asEuint64(10000));
    }
}
