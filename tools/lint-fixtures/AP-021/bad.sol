// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64, ebool, eaddress, externalEaddress, externalEuint8, euint8, euint32, euint128, euint256} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
contract Fixture is ZamaEthereumConfig {
    mapping(address => euint64) _balances;
    function deposit(externalEuint64 enc, bytes calldata proof) external {
        euint64 a = FHE.fromExternal(enc, proof);
        _balances[msg.sender] = FHE.add(_balances[msg.sender], a);
        FHE.allowThis(_balances[msg.sender]);
    }
}
