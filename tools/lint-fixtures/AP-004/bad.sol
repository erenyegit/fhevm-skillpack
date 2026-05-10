// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64, ebool, eaddress, externalEaddress, externalEuint8, euint8, euint32, euint128, euint256} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
contract Fixture is ZamaEthereumConfig {
    euint64 private _balance;
    function deposit(externalEuint64 enc, bytes calldata proof) external {
        euint64 amount = FHE.fromExternal(enc, proof);
        _balance = FHE.add(_balance, amount);
        // missing FHE.allowThis(_balance) in the next 6 lines
        emit Stuff();
        emit Stuff2();
    }
    event Stuff();
    event Stuff2();
}
