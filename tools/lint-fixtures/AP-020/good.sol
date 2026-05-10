// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64, ebool, eaddress, externalEaddress, externalEuint8, euint8, euint32, euint128, euint256} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
contract Fixture is ZamaEthereumConfig {
    function validateUserOp(bytes calldata op) external {
        euint64 dummy;
        FHE.allowTransient(dummy, address(this));
        FHE.cleanTransientStorage();
        op;
    }
}
