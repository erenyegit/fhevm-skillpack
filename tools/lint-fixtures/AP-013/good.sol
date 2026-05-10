// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64, ebool, eaddress, externalEaddress, externalEuint8, euint8, euint32, euint128, euint256} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
contract Fixture is ZamaEthereumConfig {
    mapping(address => uint256) nonces;
    function f(externalEuint64 enc, bytes calldata proof, uint256 nonce) external {
        require(nonce > nonces[msg.sender], "stale");
        nonces[msg.sender] = nonce;
        euint64 a = FHE.fromExternal(enc, proof);
        a;
    }
}
