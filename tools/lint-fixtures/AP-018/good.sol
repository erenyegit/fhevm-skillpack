// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64, ebool, eaddress, externalEaddress, externalEuint8, euint8, euint32, euint128, euint256} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
contract Fixture is ZamaEthereumConfig {
    }
interface IT2 { function confidentialTransferFrom(address,address,externalEuint64,bytes calldata) external returns (euint64); }
    address tokenAddr;
    euint64 _highestBid;
    function bid(externalEuint64 enc, bytes calldata proof) external {
        euint64 effective = IT2(tokenAddr).confidentialTransferFrom(msg.sender, address(this), enc, proof);
        ebool actuallyTransferred = FHE.gt(effective, FHE.asEuint64(0));
        ebool isHigher = FHE.gt(effective, _highestBid);
        ebool isBest   = FHE.and(actuallyTransferred, isHigher);
        _highestBid = FHE.select(isBest, effective, _highestBid);
        FHE.allowThis(_highestBid);
    }
}
