// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64, ebool, eaddress, externalEaddress, externalEuint8, euint8, euint32, euint128, euint256} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
contract Fixture is ZamaEthereumConfig {
    mapping(address => euint64) _balances;
    function deposit(externalEuint64 enc, externalEaddress encSender, bytes calldata proof) external {
        euint64 a = FHE.fromExternal(enc, proof);
        eaddress claimed = FHE.fromExternal(encSender, proof);
        ebool ok = FHE.eq(claimed, FHE.asEaddress(msg.sender));
        _balances[msg.sender] = FHE.select(ok,
            FHE.add(_balances[msg.sender], a),
            _balances[msg.sender]
        );
        FHE.allowThis(_balances[msg.sender]);
    }
}
