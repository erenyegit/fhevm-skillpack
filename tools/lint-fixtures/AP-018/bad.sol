// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64, ebool, eaddress, externalEaddress, externalEuint8, euint8, euint32, euint128, euint256} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
contract Fixture is ZamaEthereumConfig {
    }
interface IT { function confidentialTransferFrom(address,address,externalEuint64,bytes calldata) external returns (euint64); }
    address tokenAddr;
    euint64 _highestBid;
    function bid(externalEuint64 enc, bytes calldata proof) external {
        IT(tokenAddr).confidentialTransferFrom(msg.sender, address(this), enc, proof);
        euint64 a = FHE.fromExternal(enc, proof);
        ebool isHigher = FHE.gt(a, _highestBid);
        _highestBid = FHE.select(isHigher, a, _highestBid);
        FHE.allowThis(_highestBid);
    }
}
