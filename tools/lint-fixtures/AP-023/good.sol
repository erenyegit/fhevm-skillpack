// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64, ebool, eaddress, externalEaddress, externalEuint8, euint8, euint32, euint128, euint256} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
contract Fixture is ZamaEthereumConfig {
    euint64 private _total;
    constructor() {
        _total = FHE.asEuint64(0);
        FHE.allowThis(_total);
    }
    function add(externalEuint64 enc, bytes calldata proof) external {
        euint64 amt = FHE.fromExternal(enc, proof);
        _total = FHE.add(_total, amt);
        FHE.allowThis(_total);
    }
    function reveal() external {
        require(FHE.isInitialized(_total), "no ct");
        FHE.makePubliclyDecryptable(_total);
    }
}
