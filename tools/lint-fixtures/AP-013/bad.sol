// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64, ebool, eaddress, externalEaddress, externalEuint8, euint8, euint32, euint128, euint256} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
contract Fixture is ZamaEthereumConfig {
    mapping(bytes32 => bool) used;
    function f(externalEuint64 enc, bytes calldata proof) external {
        bytes32 k = keccak256(abi.encode(enc, proof));
        require(!used[k], "replay");
        used[k] = true;
    }
}
